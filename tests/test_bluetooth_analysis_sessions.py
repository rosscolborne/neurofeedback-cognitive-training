"""HTTP-level tests for the Bluetooth analysis-session endpoints added in
`brainflow_service/analysis.py` -- `/headset-fit/sessions/{id}/analyze-window`
These are the Bluetooth counterpart of
`BrainFlowSession`'s per-session smoothing, already exercised for a direct
BrainFlow connection by `test_brainflow_pipeline.py`'s synthetic-board
tests: the point of this file is to show a Bluetooth connection now gets
the exact same kind of stateful, smoothed scores that a BrainFlow session's
stream does, instead of the single-window scores the old stateless
`/analyze-window` endpoint was limited to.

No `pytest.importorskip("brainflow")` guard is needed -- `analyze_window`
computes focus/relax scores from band powers via `dsp.py`'s numpy FFT
fallback when BrainFlow's own PSD/classifier calls aren't available, so
these tests run the same way either way.
"""

from __future__ import annotations

import math

import pytest

from brainflow_service.app import app


def _sine_window(
    *, amplitude: float, freq_hz: float, sample_rate: int, seconds: float, channels: int,
) -> list[list[float]]:
    count = int(sample_rate * seconds)
    return [
        [amplitude * math.sin(2 * math.pi * freq_hz * (i / sample_rate))] * channels
        for i in range(count)
    ]


def _create_session(client) -> str:
    created = client.post("/headset-fit/sessions")
    assert created.status_code == 200
    return created.json()["fitSessionId"]


def test_analyze_window_returns_smoothed_features() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    session_id = _create_session(client)

    samples = _sine_window(amplitude=15, freq_hz=10, sample_rate=256, seconds=2, channels=4)
    response = client.post(
        f"/headset-fit/sessions/{session_id}/analyze-window",
        json={"sampleRateHz": 256, "samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )

    assert response.status_code == 200
    body = response.json()
    features = body["features"]
    assert features is not None
    assert features["bandPowers"] is not None
    assert 0 <= features["focusScore"] <= 100
    assert 0 <= features["relaxScore"] <= 100
    assert -1 <= features["valence"] <= 1
    assert -1 <= features["arousal"] <= 1
    assert isinstance(features["stateLabel"], str)

    quality = body["quality"]
    assert quality["state"] in ("poor", "adjusting", "good", "ready")
    assert len(quality["channels"]) == 4

def test_analyze_window_smooths_across_calls_instead_of_resetting() -> None:
    # Mirrors `test_stability_accumulates_across_calls_on_the_same_session`
    # in test_headset_fit_sessions.py, but for score smoothing: a fresh
    # per-call provider (the old stateless `/analyze-window`) jumps
    # straight to each window's raw score, while this session-scoped
    # endpoint should only move partway there -- the same slow EMA a
    # BrainFlow session's stream applies.
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    session_id = _create_session(client)

    low_focus_window = _sine_window(amplitude=6, freq_hz=4, sample_rate=256, seconds=2, channels=4)
    high_focus_window = _sine_window(amplitude=40, freq_hz=25, sample_rate=256, seconds=2, channels=4)
    channel_ids = ["TP9", "AF7", "AF8", "TP10"]

    def analyze(samples: list[list[float]]) -> float:
        response = client.post(
            f"/headset-fit/sessions/{session_id}/analyze-window",
            json={"sampleRateHz": 256, "samples": samples, "channelIds": channel_ids},
        )
        assert response.status_code == 200
        return response.json()["features"]["focusScore"]

    first_score = analyze(low_focus_window)
    second_score = analyze(high_focus_window)
    # One more identical high-focus window should move further in the same
    # direction, since the EMA hasn't caught up to it yet either.
    third_score = analyze(high_focus_window)

    assert second_score > first_score
    assert third_score > second_score

    # A fresh call to the stateless endpoint gives this window's raw score
    # outright -- the session-scoped endpoint should still be well short of
    # that after just one smoothing step.
    stateless_response = client.post(
        "/analyze-window",
        json={"sampleRateHz": 256, "samples": high_focus_window},
    )
    raw_high_focus_score = stateless_response.json()["features"]["focusScore"]
    assert second_score < raw_high_focus_score


def test_analyze_window_404_for_unknown_session() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    samples = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    response = TestClient(app).post(
        "/headset-fit/sessions/does-not-exist/analyze-window",
        json={"sampleRateHz": 256, "samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )

    assert response.status_code == 404
