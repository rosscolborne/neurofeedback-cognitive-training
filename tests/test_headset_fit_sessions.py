"""HTTP-level tests for the `/headset-fit/sessions` endpoints -- the
function an arbitrary front end (not just this app's bundled Bluetooth
provider) calls to get the same fit-quality verdict this app shows, for
raw Muse Athena EEG it collected itself over Bluetooth.

These don't need BrainFlow or real hardware: `HeadsetFitSessionStore` and
`HeuristicHeadsetFitProvider` are pure Python, so unlike
`test_brainflow_pipeline.py`'s `/analyze-window` tests, no
`pytest.importorskip("brainflow")` is needed here -- only `httpx`, for
`TestClient`.
"""

from __future__ import annotations

import math

import pytest

from brainflow_service.app import app


def _sine_window(*, amplitude: float, freq_hz: float, sample_rate: int, seconds: float, channels: int) -> list[list[float]]:
    count = int(sample_rate * seconds)
    return [[amplitude * math.sin(2 * math.pi * freq_hz * (i / sample_rate))] * channels for i in range(count)]


def test_session_lifecycle_create_assess_delete() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)

    created = client.post("/headset-fit/sessions")
    assert created.status_code == 200
    fit_session_id = created.json()["fitSessionId"]
    assert fit_session_id

    samples = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    assessed = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={"samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )
    assert assessed.status_code == 200
    body = assessed.json()
    assert body["state"] in ("poor", "adjusting", "good", "ready")
    assert len(body["channels"]) == 4

    deleted = client.delete(f"/headset-fit/sessions/{fit_session_id}")
    assert deleted.status_code == 200

    after_delete = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={"samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )
    assert after_delete.status_code == 404


def test_assess_unknown_session_is_404() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    samples = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    response = TestClient(app).post(
        "/headset-fit/sessions/does-not-exist/assess",
        json={"samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )

    assert response.status_code == 404


def test_delete_unknown_session_is_idempotent() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    response = TestClient(app).delete("/headset-fit/sessions/does-not-exist")

    assert response.status_code == 200


def test_assess_drops_aux_channels_sent_by_the_caller() -> None:
    # A caller that doesn't know to pre-filter AUX1-4 (an "arbitrary front
    # end", per the endpoint's purpose) still only gets the 4 real
    # electrodes back -- the server does the filtering, not the client.
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    fit_session_id = client.post("/headset-fit/sessions").json()["fitSessionId"]

    electrodes = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    aux = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    samples = [e + a for e, a in zip(electrodes, aux)]

    response = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={
            "samples": samples,
            "channelIds": ["TP9", "AF7", "AF8", "TP10", "AUX1", "AUX2", "AUX3", "AUX4"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["channels"]) == 4
    assert {c["channel"]["id"] for c in body["channels"]} == {"tp9", "af7", "af8", "tp10"}


def test_assess_rejects_mismatched_row_length() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    fit_session_id = client.post("/headset-fit/sessions").json()["fitSessionId"]

    response = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={"samples": [[1.0, 2.0, 3.0]], "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    )

    assert response.status_code == 400


def test_stability_accumulates_across_calls_on_the_same_session() -> None:
    # Mirrors `test_stability_timer_reaches_ready_after_required_duration`
    # in test_headset_fit.py, but through the HTTP session endpoints -- the
    # whole point of a session id is that `stableForMs` persists across
    # separate `/assess` calls the way a fresh-per-call provider (the old
    # `/analyze-window` behavior) never could.
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    client = TestClient(app)
    fit_session_id = client.post("/headset-fit/sessions").json()["fitSessionId"]
    samples = _sine_window(amplitude=10, freq_hz=10, sample_rate=256, seconds=1, channels=4)

    first = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={"samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    ).json()
    second = client.post(
        f"/headset-fit/sessions/{fit_session_id}/assess",
        json={"samples": samples, "channelIds": ["TP9", "AF7", "AF8", "TP10"]},
    ).json()

    assert first["state"] == "good"
    assert second["stableForMs"] > first["stableForMs"]
