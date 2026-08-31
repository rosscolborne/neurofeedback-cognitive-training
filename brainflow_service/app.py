from __future__ import annotations

import os
import time
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .analysis import AnalysisSessionStore
from .analysis import analyze_window as analyze_eeg_window
from .config import DEFAULT_PROCESSING, DEVICE_CONFIGS
from .dsp import (
    extract_band_power_features,
    extract_brainflow_mindfulness,
    extract_brainflow_restfulness,
    preprocess_eeg_window,
)
from .affective_state import compute_raw_affective_sample
from .headset_fit import (
    HeuristicHeadsetFitProvider,
    select_scalp_electrode_indices,
    to_signal_quality_metadata,
)
from .metrics import compute_neurofeedback_scores, normalize_brainflow_score
from .models import (
    SignalChannel,
    SignalFeatures,
    SignalQualityMetadata,
    TrainingMetricSampleModel,
)
from .runtime import SessionStore, sse_event


class StartSessionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    device_id: str = Field(alias="deviceId")
    mac_address: str | None = Field(default=None, alias="macAddress")
    serial_number: str | None = Field(default=None, alias="serialNumber")
    protocol: str = "theta-beta-ratio"
    threshold: float = 1.85


class StartSessionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    state: Literal["connected"]
    device_info: dict = Field(alias="deviceInfo")


class AnalyzeWindowRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sample_rate_hz: float = Field(alias="sampleRateHz")
    samples: list[list[float]]


class AnalyzeWindowResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    features: SignalFeatures | None
    quality: SignalQualityMetadata | None = None


class StartHeadsetFitSessionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fit_session_id: str = Field(alias="fitSessionId")


class AssessHeadsetFitRequest(BaseModel):
    """One analyzed window of raw Muse Athena EEG, collected over
    Bluetooth by any front end. `channel_ids` must be one label per column
    of `samples` (e.g. `["TP9", "AF7", "AF8", "TP10"]`, or that plus
    `AUX1`-`AUX4` for the raw 8-channel Athena stream) -- non-electrode
    channels are dropped server-side, see `select_scalp_electrode_indices`."""

    model_config = ConfigDict(populate_by_name=True)

    samples: list[list[float]]
    channel_ids: list[str] = Field(alias="channelIds")


class AnalyzeSessionWindowRequest(BaseModel):
    """Same shape as `AssessHeadsetFitRequest` plus the sample rate --
    everything `analyze_window` needs for one window of a Bluetooth
    session. See `POST /headset-fit/sessions/{id}/analyze-window`."""

    model_config = ConfigDict(populate_by_name=True)

    sample_rate_hz: float = Field(alias="sampleRateHz")
    samples: list[list[float]]
    channel_ids: list[str] = Field(alias="channelIds")
    protocol: str = "theta-beta-ratio"
    threshold: float = 1.85


class AnalyzeSessionWindowResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    features: SignalFeatures | None
    quality: SignalQualityMetadata
    training: TrainingMetricSampleModel | None = None


app = FastAPI(title="Neurasticity BrainFlow Service")
store = SessionStore()
analysis_session_store = AnalysisSessionStore()

# Additional origins (comma-separated) that may call this service, on top of
# the bundled app's own localhost dev ports. Set this so a different
# front-end -- served from another host/port -- can reach the API, e.g.:
#   EEG_BRAINFLOW_CORS_ORIGINS=https://my-other-frontend.example.com
_extra_cors_origins = [
    origin.strip()
    for origin in os.environ.get("EEG_BRAINFLOW_CORS_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/devices")
def devices() -> list[dict[str, str]]:
    return [
        {
            "id": config.id,
            "label": config.label,
            "mode": config.mode,
            "boardId": config.board_id_name,
        }
        for config in DEVICE_CONFIGS.values()
    ]


@app.post("/analyze-window")
def analyze_window(request: AnalyzeWindowRequest) -> AnalyzeWindowResponse:
    sample_rate = int(round(request.sample_rate_hz))
    if sample_rate <= 0:
        raise HTTPException(status_code=400, detail="sampleRateHz must be positive.")
    if not request.samples:
        raise HTTPException(status_code=400, detail="samples must not be empty.")

    window = np.asarray(request.samples, dtype=float).T
    if window.ndim != 2 or window.shape[0] == 0 or window.shape[1] == 0:
        raise HTTPException(status_code=400, detail="samples must be row-major EEG values.")
    if not np.isfinite(window).all():
        raise HTTPException(status_code=400, detail="samples contain non-finite values.")

    # No device metadata is available here (no channel labels), so the
    # per-side "adjust left/right" blocker in headset_fit.py never fires for
    # this endpoint -- that heuristic keys off Muse channel ids (tp9/af7/
    # tp10/af8), which generic channel placeholders don't have.
    channels = [
        SignalChannel(id=f"channel_{index + 1}", label=f"Channel {index + 1}", unit="uV", index=index)
        for index in range(window.shape[0])
    ]
    fit_snapshot = HeuristicHeadsetFitProvider().update(channels=channels, samples=request.samples)
    quality = to_signal_quality_metadata(fit_snapshot)

    processed = preprocess_eeg_window(window, sample_rate, DEFAULT_PROCESSING)
    band_powers = extract_band_power_features(processed, sample_rate)
    brainflow_mindfulness = extract_brainflow_mindfulness(window, sample_rate)
    brainflow_restfulness = extract_brainflow_restfulness(window, sample_rate)
    features = None
    if band_powers or brainflow_mindfulness is not None or brainflow_restfulness is not None:
        if fit_snapshot.excessive_artifact:
            # Mirrors AffectiveStateProvider/HeuristicAttentionProvider's
            # quality gate: raw band powers and BrainFlow's ML outputs are
            # still reported, but the derived/smoothed scores are withheld
            # since they aren't reliable for a window this noisy.
            features = SignalFeatures(
                bandPowers=band_powers,
                brainflowConcentration=brainflow_mindfulness,
                brainflowRestfulness=brainflow_restfulness,
            )
        else:
            # This endpoint is stateless (no session to smooth across), so
            # these are single-window scores -- callers streaming a session
            # should use `/sessions/{id}/stream` instead, which returns the
            # same finished scores with the bundled app's EMA smoothing
            # applied.
            theta_power = band_powers.absolute.get("theta", 0.0) if band_powers else 0.0
            alpha_power = band_powers.absolute.get("alpha", 0.0) if band_powers else 0.0
            beta_power = band_powers.absolute.get("beta", 0.0) if band_powers else 0.0
            gamma_power = band_powers.absolute.get("gamma", 0.0) if band_powers else 0.0
            neurofeedback = compute_neurofeedback_scores(
                theta_power=theta_power,
                alpha_power=alpha_power,
                beta_power=beta_power,
            )
            # No session here, so no smoothing/calibration to apply --
            # valence and arousal equal their raw values.
            raw_affective = compute_raw_affective_sample(theta_power, alpha_power, beta_power, gamma_power)
            features = SignalFeatures(
                bandPowers=band_powers,
                brainflowConcentration=brainflow_mindfulness,
                brainflowRestfulness=brainflow_restfulness,
                mindfulnessScore=normalize_brainflow_score(brainflow_mindfulness),
                restfulnessScore=normalize_brainflow_score(brainflow_restfulness),
                focusScore=neurofeedback.focus_score,
                relaxScore=neurofeedback.relax_score,
                valence=raw_affective.valence if raw_affective else None,
                arousal=raw_affective.arousal if raw_affective else None,
                rawValence=raw_affective.valence if raw_affective else None,
                rawArousal=raw_affective.arousal if raw_affective else None,
                stateLabel=raw_affective.label if raw_affective else None,
                confidence=raw_affective.confidence if raw_affective else None,
            )

    return AnalyzeWindowResponse(features=features, quality=quality).model_dump(by_alias=True)


@app.post("/headset-fit/sessions")
def start_headset_fit_session() -> StartHeadsetFitSessionResponse:
    """Starts a stateful analysis session for one Bluetooth connection --
    headset fit, plus (via `.../analyze-window` below) the same smoothed
    mindfulness/restfulness/focus/relax/valence/arousal scores a direct
    BrainFlow connection gets from its own
    `BrainFlowSession`, all from `analysis.AnalysisProviders`. Call this
    once per connection, then POST each analyzed window's samples to
    `/headset-fit/sessions/{fitSessionId}/analyze-window` (or, for fit
    only, `.../assess`) -- this is what lets an arbitrary front end (not
    just this app's bundled provider) get the exact same scores this app
    shows, for EEG it collected itself over Bluetooth from a Muse Athena."""
    return StartHeadsetFitSessionResponse(fitSessionId=analysis_session_store.create())


@app.post("/headset-fit/sessions/{fit_session_id}/assess")
def assess_headset_fit(fit_session_id: str, request: AssessHeadsetFitRequest) -> SignalQualityMetadata:
    if not request.samples:
        raise HTTPException(status_code=400, detail="samples must not be empty.")
    if not request.channel_ids:
        raise HTTPException(status_code=400, detail="channelIds must not be empty.")
    if any(len(row) != len(request.channel_ids) for row in request.samples):
        raise HTTPException(
            status_code=400,
            detail="each row in samples must have exactly one value per channelId.",
        )

    session = _get_analysis_session_or_404(fit_session_id)

    # Drop AUX/non-electrode channels before scoring -- see
    # `select_scalp_electrode_indices`. This runs regardless of whether the
    # caller already filtered its own channels, so a front end that sends
    # the full raw Athena stream (electrodes + AUX1-4) gets the same
    # result as one that pre-filters, same as this app's own provider.
    electrode_indices = select_scalp_electrode_indices(request.channel_ids)
    channels = [
        SignalChannel(
            id=request.channel_ids[index].lower(),
            label=request.channel_ids[index],
            unit="uV",
            index=index,
        )
        for index in electrode_indices
    ]
    samples = [[row[index] for index in electrode_indices] for row in request.samples]

    snapshot = session.headset_fit.update(channels=channels, samples=samples)
    return to_signal_quality_metadata(snapshot)


@app.post("/headset-fit/sessions/{fit_session_id}/analyze-window")
def analyze_session_window(
    fit_session_id: str, request: AnalyzeSessionWindowRequest,
) -> AnalyzeSessionWindowResponse:
    """The Bluetooth counterpart of `/sessions/{id}/stream`: runs this
    session's window through the same `analyze_window` pipeline a direct
    BrainFlow connection's `BrainFlowSession` uses, so the two transports'
    headset fit and smoothing are identical rather than two separate
    implementations. Supersedes calling
    the stateless `/analyze-window` and `.../assess` separately -- one
    session-scoped call now does both, with real smoothing instead of
    single-window scores."""
    sample_rate = int(round(request.sample_rate_hz))
    if sample_rate <= 0:
        raise HTTPException(status_code=400, detail="sampleRateHz must be positive.")
    if not request.samples:
        raise HTTPException(status_code=400, detail="samples must not be empty.")
    if not request.channel_ids:
        raise HTTPException(status_code=400, detail="channelIds must not be empty.")
    if any(len(row) != len(request.channel_ids) for row in request.samples):
        raise HTTPException(
            status_code=400,
            detail="each row in samples must have exactly one value per channelId.",
        )

    session = _get_analysis_session_or_404(fit_session_id)

    electrode_indices = select_scalp_electrode_indices(request.channel_ids)
    channels = [
        SignalChannel(
            id=request.channel_ids[index].lower(),
            label=request.channel_ids[index],
            unit="uV",
            index=index,
        )
        for index in electrode_indices
    ]
    eeg_samples = [[row[index] for index in electrode_indices] for row in request.samples]

    window = np.asarray(eeg_samples, dtype=float).T
    if window.ndim != 2 or window.shape[0] == 0 or window.shape[1] == 0:
        raise HTTPException(status_code=400, detail="samples must be row-major EEG values.")
    if not np.isfinite(window).all():
        raise HTTPException(status_code=400, detail="samples contain non-finite values.")

    result = analyze_eeg_window(
        providers=session,
        channels=channels,
        eeg_samples=eeg_samples,
        raw_window=window,
        sample_rate=sample_rate,
        protocol=request.protocol,
        threshold=request.threshold,
    )
    return AnalyzeSessionWindowResponse(
        features=result.features, quality=result.quality, training=result.training,
    )


@app.delete("/headset-fit/sessions/{fit_session_id}")
def stop_headset_fit_session(fit_session_id: str) -> dict[str, str]:
    analysis_session_store.stop(fit_session_id)
    return {"state": "stopped"}


def _get_analysis_session_or_404(fit_session_id: str):
    try:
        return analysis_session_store.get(fit_session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown headset-fit session.") from exc


@app.post("/sessions")
def start_session(request: StartSessionRequest) -> StartSessionResponse:
    if request.device_id not in DEVICE_CONFIGS:
        raise HTTPException(status_code=404, detail="Unknown BrainFlow device.")
    config = DEVICE_CONFIGS[request.device_id]

    session = None
    device_info = None
    last_error: Exception | None = None
    for attempt in range(1, config.startup_attempts + 1):
        session = store.create(
            request.device_id,
            mac_address=request.mac_address,
            serial_number=request.serial_number,
            protocol=request.protocol,
            threshold=request.threshold,
        )
        try:
            device_info = session.prepare()
            session.start()
            break
        except Exception as exc:
            last_error = exc
            store.stop(session.id)
            session = None
            if attempt < config.startup_attempts:
                time.sleep(config.startup_retry_delay_seconds)

    if not session or not device_info:
        detail = str(last_error) if last_error else "Unable to start BrainFlow session."
        raise HTTPException(status_code=500, detail=detail)

    return StartSessionResponse(
        sessionId=session.id,
        state="connected",
        deviceInfo=device_info.model_dump(by_alias=True),
    )


def _get_session_or_404(session_id: str):
    try:
        return store.get(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown BrainFlow session.") from exc


@app.get("/sessions/{session_id}/stream")
async def stream_session(session_id: str) -> StreamingResponse:
    session = _get_session_or_404(session_id)

    async def events():
        yield sse_event("state", {"state": "streaming"})
        try:
            async for frame in session.frames():
                yield sse_event("signalFrame", frame)
        except Exception as exc:
            yield sse_event("error", {"message": str(exc)})
        finally:
            store.stop(session_id)
            yield sse_event("state", {"state": "disconnected"})

    return StreamingResponse(events(), media_type="text/event-stream")


@app.delete("/sessions/{session_id}")
def stop_session(session_id: str) -> dict[str, str]:
    store.stop(session_id)
    return {"state": "disconnected"}
