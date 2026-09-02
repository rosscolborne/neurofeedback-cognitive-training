from __future__ import annotations

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
    extract_interhemispheric_coherence,
    preprocess_eeg_window,
)
from .affective_state import FitQualityHint
from .headset_fit import (
    HeuristicHeadsetFitProvider,
    select_scalp_electrode_indices,
    to_signal_quality_metadata,
)
from .metrics import MetricCalculator, MetricInput
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


class ProtocolConfigurationRequest(BaseModel):
    protocol: str
    threshold: float


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


class StartMetricCalibrationRequest(BaseModel):
    """Omit metrics to calibrate every available derived metric."""
    model_config = ConfigDict(populate_by_name=True)
    metrics: list[str] | None = None


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # This API uses no browser cookies or authorization headers, so credentials
    # are unnecessary. Leaving them disabled makes the public Render API usable
    # from the Vercel frontend with a wildcard origin.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    """A human-friendly landing response for the public Render service URL."""
    return {
        "service": "Neurasticity BrainFlow Service",
        "status": "ok",
        "health": "/health",
    }


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
        # A fresh calculator intentionally makes this endpoint a one-window
        # snapshot while still using precisely the same metric definitions.
        coherence = extract_interhemispheric_coherence(processed, sample_rate, [c.id for c in channels])
        snapshot = MetricCalculator().push(MetricInput(
            absolute_bands=band_powers.absolute if band_powers else {},
            interhemispheric_coherence=coherence,
            raw_mindfulness=brainflow_mindfulness,
            raw_restfulness=brainflow_restfulness,
            protocol="theta-beta-ratio",
            threshold=1.85,
            reliable=not fit_snapshot.excessive_artifact,
            fit=FitQualityHint(ready=fit_snapshot.ready, state=fit_snapshot.state),
        ))
        if band_powers:
            band_powers = band_powers.model_copy(update={"absolute": snapshot.absolute_bands, "relative": snapshot.relative_bands, "ratios": snapshot.ratios})
        affective, feedback = snapshot.affective_state, snapshot.protocol_feedback
        features = SignalFeatures(
            bandPowers=band_powers,
            brainflowConcentration=brainflow_mindfulness,
            brainflowRestfulness=brainflow_restfulness,
            mindfulnessScore=snapshot.brainflow_scores.mindfulness_score,
            restfulnessScore=snapshot.brainflow_scores.restfulness_score,
            valence=affective.valence if affective else None,
            arousal=affective.arousal if affective else None,
            stateLabel=affective.label if affective else None,
            confidence=affective.confidence if affective else None,
            interhemisphericCoherence=snapshot.interhemispheric_coherence,
            primaryMetricName=feedback.metric_name,
            primaryMetricValue=feedback.value,
            inZone=feedback.in_zone,
            zoneScore=feedback.zone_score,
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


@app.post("/headset-fit/sessions/{fit_session_id}/metrics/calibration")
def start_fit_metric_calibration(fit_session_id: str, request: StartMetricCalibrationRequest | None = None) -> dict[str, str]:
    _get_analysis_session_or_404(fit_session_id).metrics.start_calibration(None if request is None else set(request.metrics or []))
    return {"state": "collecting"}


@app.delete("/headset-fit/sessions/{fit_session_id}/metrics/calibration")
def reset_fit_metric_calibration(fit_session_id: str) -> dict[str, str]:
    _get_analysis_session_or_404(fit_session_id).metrics.reset_calibration()
    return {"state": "off"}


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


@app.put("/sessions/{session_id}/protocol")
def update_session_protocol(
    session_id: str, request: ProtocolConfigurationRequest,
) -> dict[str, float | str]:
    """Apply Debug Console protocol changes to a running BrainFlow session."""
    session = _get_session_or_404(session_id)
    session.protocol = request.protocol
    session.threshold = request.threshold
    return {"protocol": session.protocol, "threshold": session.threshold}


@app.post("/sessions/{session_id}/metrics/calibration")
def start_session_metric_calibration(session_id: str, request: StartMetricCalibrationRequest | None = None) -> dict[str, str]:
    _get_session_or_404(session_id).start_metric_calibration(None if request is None else set(request.metrics or []))
    return {"state": "collecting"}


@app.delete("/sessions/{session_id}/metrics/calibration")
def reset_session_metric_calibration(session_id: str) -> dict[str, str]:
    _get_session_or_404(session_id).reset_metric_calibration()
    return {"state": "off"}
