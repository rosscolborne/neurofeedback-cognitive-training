from __future__ import annotations

import math
import subprocess
import sys

import numpy as np
import pytest

from brainflow_service.config import DEFAULT_PROCESSING, DEVICE_CONFIGS
from brainflow_service.dsp import (
    build_eeg_window,
    extract_band_power_features,
    extract_brainflow_mindfulness,
    extract_brainflow_restfulness,
    preprocess_eeg_window,
)
from brainflow_service.app import app
from brainflow_service.models import SignalFeatures
from brainflow_service.runtime import BrainFlowSession


def sine_window(freq_hz: float = 10.0, sample_rate: int = 256, seconds: float = 2.0) -> np.ndarray:
    t = np.arange(int(sample_rate * seconds)) / sample_rate
    signal = np.sin(2 * math.pi * freq_hz * t) * 20.0
    return np.vstack([signal, signal * 0.9, signal * 1.1, signal])


def test_window_construction_extracts_eeg_rows() -> None:
    data = np.arange(6 * 100, dtype=float).reshape(6, 100)
    window = build_eeg_window(data, [1, 3], 20)

    assert window is not None
    assert window.shape == (2, 20)
    assert np.array_equal(window[0], data[1, -20:])
    assert np.array_equal(window[1], data[3, -20:])


def test_window_construction_rejects_insufficient_data() -> None:
    data = np.arange(6 * 10, dtype=float).reshape(6, 10)

    assert build_eeg_window(data, [1, 3], 20) is None


def test_window_construction_rejects_nan() -> None:
    data = np.arange(6 * 100, dtype=float).reshape(6, 100)
    data[1, 99] = np.nan

    assert build_eeg_window(data, [1], 20) is None


def test_preprocess_keeps_shape_and_finite_values() -> None:
    window = sine_window()
    processed = preprocess_eeg_window(window, 256, DEFAULT_PROCESSING)

    assert processed.shape == window.shape
    assert np.isfinite(processed).all()


def test_band_power_extracts_expected_bands() -> None:
    features = extract_band_power_features(sine_window(freq_hz=10), 256)

    assert features is not None
    assert features.method == "brainflow_welch_psd"
    assert features.absolute["alpha"] > features.absolute["theta"]
    assert features.absolute["alpha"] > features.absolute["beta"]
    assert "betaOverAlphaTheta" in features.ratios


def test_band_power_handles_exact_power_of_two_window() -> None:
    features = extract_band_power_features(sine_window(freq_hz=10, sample_rate=256, seconds=2), 256)

    assert features is not None
    assert features.window_seconds == 2


def test_invalid_feature_window_returns_none() -> None:
    assert extract_band_power_features(np.array([[1.0, float("inf")]]), 256) is None


def test_brainflow_mindfulness_extracts_bounded_score() -> None:
    pytest.importorskip("brainflow")

    score = extract_brainflow_mindfulness(sine_window(freq_hz=10, seconds=4), 256)

    assert score is not None
    assert 0 <= score <= 1


def test_brainflow_restfulness_extracts_bounded_score() -> None:
    pytest.importorskip("brainflow")

    score = extract_brainflow_restfulness(sine_window(freq_hz=10, seconds=4), 256)

    assert score is not None
    assert 0 <= score <= 1


def test_signal_features_serialize_for_frontend() -> None:
    features = SignalFeatures(brainflowConcentration=0.42, brainflowRestfulness=0.64)

    assert features.model_dump(by_alias=True)["brainflowConcentration"] == 0.42
    assert features.model_dump(by_alias=True)["brainflowRestfulness"] == 0.64


def test_analyze_window_returns_brainflow_restfulness_for_frontend() -> None:
    pytest.importorskip("brainflow")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    samples = sine_window(freq_hz=10, seconds=4).T.tolist()
    response = TestClient(app).post(
        "/analyze-window",
        json={"sampleRateHz": 256, "samples": samples},
    )

    assert response.status_code == 200
    features = response.json()["features"]
    assert features["brainflowConcentration"] is not None
    assert features["brainflowRestfulness"] is not None
    assert 0 <= features["brainflowRestfulness"] <= 1
    assert 0 <= features["mindfulnessScore"] <= 100
    assert 0 <= features["restfulnessScore"] <= 100
    assert 0 <= features["focusScore"] <= 100
    assert 0 <= features["relaxScore"] <= 100
    assert -1 <= features["valence"] <= 1
    assert -1 <= features["arousal"] <= 1
    assert features["valence"] == features["rawValence"]
    assert features["arousal"] == features["rawArousal"]
    assert isinstance(features["stateLabel"], str)
    assert 0 <= features["confidence"] <= 1
    assert features["calibrationActive"] is False

    quality = response.json()["quality"]
    assert quality["state"] in ("poor", "adjusting", "good", "ready")
    assert quality["ready"] is False  # a single window can never demonstrate sustained contact
    assert len(quality["channels"]) == 4


def test_analyze_window_withholds_derived_scores_for_noisy_window() -> None:
    pytest.importorskip("brainflow")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    # Alternating +/-5000 steps trip the excessive-artifact gate.
    samples = [[5000.0, 5000.0, 5000.0, 5000.0] if i % 2 == 0 else [-5000.0, -5000.0, -5000.0, -5000.0] for i in range(1024)]
    response = TestClient(app).post(
        "/analyze-window",
        json={"sampleRateHz": 256, "samples": samples},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["quality"]["excessiveArtifact"] is True
    features = body["features"]
    assert features["mindfulnessScore"] is None
    assert features["focusScore"] is None
    assert features["valence"] is None
    # Raw band powers are still reported even when derived scores are withheld.
    assert features["bandPowers"] is not None


def test_calibration_endpoints_round_trip_for_a_session() -> None:
    pytest.importorskip("brainflow")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    start_response = client.post(
        "/sessions",
        json={"deviceId": "brainflow-synthetic"},
    )
    assert start_response.status_code == 200
    session_id = start_response.json()["sessionId"]

    try:
        idle_state = client.get(f"/sessions/{session_id}/calibration").json()
        assert idle_state == {"status": "off", "progress": 0, "required": 24}

        started_state = client.post(f"/sessions/{session_id}/calibration/start").json()
        assert started_state["status"] == "collecting"

        reset_state = client.post(f"/sessions/{session_id}/calibration/reset").json()
        assert reset_state == {"status": "off", "progress": 0, "required": 24}

        # Training's baseline-relative calibration profile is separate from
        # the above and null until its baseline fills (exercised with a
        # live streaming session in
        # test_training_baseline_produces_scores_and_a_calibration_profile_once_filled).
        # Checked here, sharing this test's session, rather than in its own
        # test: BrainFlow's synthetic board can only successfully
        # start_stream() once per process, so a second `POST /sessions` in
        # the same pytest process reliably fails.
        profile_response = client.get(f"/sessions/{session_id}/training/calibration-profile")
        assert profile_response.status_code == 200
        assert profile_response.json() is None
    finally:
        client.delete(f"/sessions/{session_id}")


def test_calibration_endpoints_404_for_unknown_session() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    response = TestClient(app).get("/sessions/does-not-exist/calibration")

    assert response.status_code == 404


def test_brainflow_device_configs_include_live_and_synthetic() -> None:
    assert DEVICE_CONFIGS["brainflow-muse-athena"].board_id_name == "MUSE_S_ATHENA_BOARD"
    assert DEVICE_CONFIGS["brainflow-synthetic"].board_id_name == "SYNTHETIC_BOARD"


def test_synthetic_session_initializes_when_brainflow_is_available() -> None:
    pytest.importorskip("brainflow")

    session = BrainFlowSession(DEVICE_CONFIGS["brainflow-synthetic"])
    try:
        info = session.prepare()
        assert info.provider_name == "BrainFlow BoardShim"
        assert info.capabilities[0].kind == "eeg"
        assert len(info.capabilities[0].channels) > 0
    finally:
        session.stop()


def test_synthetic_board_to_features_end_to_end() -> None:
    pytest.importorskip("brainflow")

    script = """
import asyncio
from brainflow_service.config import DEVICE_CONFIGS
from brainflow_service.runtime import BrainFlowSession

async def collect_one_frame():
    session = BrainFlowSession(DEVICE_CONFIGS["brainflow-synthetic"])
    try:
        session.prepare()
        session.start()
        async for frame in session.frames():
            if frame.features and frame.features.band_powers:
                assert frame.sensor == "eeg"
                assert frame.features.band_powers.absolute["theta"] >= 0
                assert frame.features.band_powers.absolute["alpha"] >= 0
                assert frame.features.band_powers.absolute["beta"] >= 0
                assert frame.features.brainflow_concentration is not None
                assert 0 <= frame.features.brainflow_concentration <= 1
                assert frame.features.brainflow_restfulness is not None
                assert 0 <= frame.features.brainflow_restfulness <= 1
                assert frame.features.mindfulness_score is not None
                assert 0 <= frame.features.mindfulness_score <= 100
                assert frame.features.restfulness_score is not None
                assert 0 <= frame.features.restfulness_score <= 100
                assert 0 <= frame.features.focus_score <= 100
                assert 0 <= frame.features.relax_score <= 100
                assert frame.features.valence is not None
                assert -1 <= frame.features.valence <= 1
                assert frame.features.arousal is not None
                assert -1 <= frame.features.arousal <= 1
                assert frame.features.state_label is not None
                assert frame.features.confidence is not None
                assert 0 <= frame.features.confidence <= 1
                assert frame.quality is not None
                assert frame.quality.state in ("poor", "adjusting", "good", "ready")
                assert len(frame.quality.channels) == len(frame.channels)
                assert frame.training is not None
                assert isinstance(frame.training.raw_ratio, float)
                return
    finally:
        session.stop()
    raise AssertionError("No feature-bearing frame emitted")

asyncio.run(asyncio.wait_for(collect_one_frame(), timeout=5.0))
"""

    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr


def test_training_baseline_produces_scores_and_a_calibration_profile_once_filled() -> None:
    pytest.importorskip("brainflow")

    script = """
import asyncio
from brainflow_service.config import DEVICE_CONFIGS
from brainflow_service.runtime import BrainFlowSession

async def collect_until_baselined():
    session = BrainFlowSession(DEVICE_CONFIGS["brainflow-synthetic"])
    try:
        session.prepare()
        session.start()
        async for frame in session.frames():
            # displayed_score/focus_score/relax_score can turn non-null
            # earlier (as soon as their own baseline has >=4 samples with
            # real spread) -- the calibration profile specifically needs
            # the ratio baseline to fill completely (24 windows).
            profile = session.get_training_calibration_profile()
            if profile is not None:
                assert profile.algorithm_version == "median_mad_zscore_v1"
                assert profile.accepted_windows == 24
                assert frame.training is not None
                assert 0 <= frame.training.displayed_score <= 100
                assert 0 <= frame.training.focus_score <= 100
                assert 0 <= frame.training.relax_score <= 100
                return
    finally:
        session.stop()
    raise AssertionError("Training baseline never filled")

asyncio.run(asyncio.wait_for(collect_until_baselined(), timeout=15.0))
"""

    result = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr


def test_training_calibration_profile_endpoint_404_for_unknown_session() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    response = TestClient(app).get("/sessions/does-not-exist/training/calibration-profile")

    assert response.status_code == 404
