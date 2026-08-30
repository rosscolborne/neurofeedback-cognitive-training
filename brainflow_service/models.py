from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SignalChannel(BaseModel):
    id: str
    label: str
    unit: str
    index: int | None = None


class BandPowerFeatures(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    absolute: dict[str, float]
    relative: dict[str, float]
    ratios: dict[str, float]
    window_seconds: float = Field(alias="windowSeconds")
    method: Literal["brainflow_welch_psd"]


class SignalFeatures(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    band_powers: BandPowerFeatures | None = Field(default=None, alias="bandPowers")
    brainflow_concentration: float | None = Field(default=None, alias="brainflowConcentration")
    brainflow_restfulness: float | None = Field(default=None, alias="brainflowRestfulness")

    # Finished, display-ready 0-100 scores. From `/analyze-window` these are
    # instantaneous (no smoothing, since that endpoint is stateless). From a
    # `/sessions/{id}/stream` SSE feed these carry the same slow-EMA
    # smoothing the bundled frontend applies, so a consumer needs no
    # client-side scoring logic at all. mindfulness/restfulness are null
    # when BrainFlow's classifier had no usable prediction for the window.
    mindfulness_score: float | None = Field(default=None, alias="mindfulnessScore")
    restfulness_score: float | None = Field(default=None, alias="restfulnessScore")
    focus_score: int | None = Field(default=None, alias="focusScore")
    relax_score: int | None = Field(default=None, alias="relaxScore")

    # Valence/arousal proxy, its raw (pre-smoothing, pre-calibration) values,
    # nearest-label classification, and confidence. From `/analyze-window`
    # `valence`/`arousal` equal the raw values (no session to smooth or
    # calibrate across). From a session stream they carry smoothing and,
    # once calibration is active, a baseline offset -- see
    # `calibrationActive` and the `/sessions/{id}/calibration*` endpoints.
    valence: float | None = None
    arousal: float | None = None
    raw_valence: float | None = Field(default=None, alias="rawValence")
    raw_arousal: float | None = Field(default=None, alias="rawArousal")
    state_label: str | None = Field(default=None, alias="stateLabel")
    confidence: float | None = None
    calibration_active: bool = Field(default=False, alias="calibrationActive")

    # This connection's valence/arousal calibration progress (see
    # `affective_state.AffectiveStateProvider.get_calibration_state` and the
    # `/sessions/{id}/calibration*` / `/headset-fit/sessions/{id}/calibration*`
    # endpoints that start/reset it). Riding along on every window means a
    # caller doesn't need a separate poll to show calibration progress.
    calibration_status: Literal["off", "collecting", "active"] = Field(
        default="off", alias="calibrationStatus",
    )
    calibration_progress: int = Field(default=0, alias="calibrationProgress")
    calibration_required: int = Field(default=0, alias="calibrationRequired")


class ChannelSignalQualityModel(BaseModel):
    """Per-channel signal-quality breakdown, from
    `brainflow_service/headset_fit.py`."""

    model_config = ConfigDict(populate_by_name=True)

    channel: SignalChannel
    state: Literal["poor", "adjusting", "good"]
    score: float
    rms_uv: float = Field(alias="rmsUv")
    std_dev_uv: float = Field(alias="stdDevUv")
    peak_to_peak_uv: float = Field(alias="peakToPeakUv")
    mean_step_uv: float = Field(alias="meanStepUv")
    max_abs_uv: float = Field(alias="maxAbsUv")
    max_step_uv: float = Field(alias="maxStepUv")
    clipped_fraction: float = Field(alias="clippedFraction")
    message: str


class SignalQualityMetadata(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source: Literal["device", "inferred"] = "inferred"
    excessive_artifact: bool = Field(default=False, alias="excessiveArtifact")
    motion_rms: float | None = Field(default=None, alias="motionRms")
    message: str | None = None

    # Headset fit / contact-quality assessment (brainflow_service/headset_fit.py).
    # `state`/`ready` are null/false until enough EEG samples have been seen
    # to assess; a session stream's `ready` only turns true after
    # `requiredStableMs` of sustained good contact, so a single
    # `/analyze-window` call always reports `ready: false`.
    state: Literal["poor", "adjusting", "good", "ready"] | None = None
    ready: bool = False
    worn: bool = False
    blockers: list[str] = Field(default_factory=list)
    channels: list[ChannelSignalQualityModel] = Field(default_factory=list)
    stable_for_ms: float | None = Field(default=None, alias="stableForMs")
    required_stable_ms: float | None = Field(default=None, alias="requiredStableMs")


class SensorCapability(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: str
    sample_rate_hz: float | None = Field(alias="sampleRateHz")
    channels: list[SignalChannel]


class DeviceInfo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    label: str
    model: str
    provider_name: str = Field(alias="providerName")
    firmware_version: str | None = Field(default=None, alias="firmwareVersion")
    capabilities: list[SensorCapability]
    metadata: dict[str, Any] = Field(default_factory=dict)


class AttentionMetricSampleModel(BaseModel):
    """Baseline-relative attention score, from
    `brainflow_service/training.py`'s `AttentionBaselineProvider` -- the
    Training feature's metric, distinct from the always-on headline scores
    in `SignalFeatures`. Every score here is `null` until its own baseline
    has enough samples with real spread to compute a z-score from (a brief
    startup window, typically a few seconds) -- see `training.py`'s module
    docstring for why there is no non-baseline fallback."""

    model_config = ConfigDict(populate_by_name=True)

    displayed_score: float | None = Field(default=None, alias="displayedScore")
    restfulness_score: float | None = Field(default=None, alias="restfulnessScore")
    focus_score: float | None = Field(default=None, alias="focusScore")
    relax_score: float | None = Field(default=None, alias="relaxScore")
    raw_ratio: float = Field(alias="rawRatio")
    baseline_ratio: float | None = Field(default=None, alias="baselineRatio")
    raw_brainflow_mindfulness: float | None = Field(default=None, alias="rawBrainflowMindfulness")
    baseline_brainflow_mindfulness: float | None = Field(default=None, alias="baselineBrainflowMindfulness")
    baseline_relative_value: float | None = Field(default=None, alias="baselineRelativeValue")
    baseline_z_score: float | None = Field(default=None, alias="baselineZScore")
    raw_brainflow_restfulness: float | None = Field(default=None, alias="rawBrainflowRestfulness")
    baseline_brainflow_restfulness: float | None = Field(default=None, alias="baselineBrainflowRestfulness")
    restfulness_baseline_relative_value: float | None = Field(
        default=None, alias="restfulnessBaselineRelativeValue",
    )
    restfulness_baseline_z_score: float | None = Field(default=None, alias="restfulnessBaselineZScore")
    score_source: Literal["brainflow_mindfulness", "unavailable"] = Field(alias="scoreSource")
    restfulness_score_source: Literal["brainflow_restfulness", "unavailable"] = Field(
        alias="restfulnessScoreSource",
    )


class SignalFrame(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sensor: str
    sample_rate_hz: float | None = Field(alias="sampleRateHz")
    channels: list[SignalChannel]
    samples: list[list[float]]
    timestamps_ms: list[float] | None = Field(default=None, alias="timestampsMs")
    received_at_ms: float = Field(alias="receivedAtMs")
    sequence_id: int = Field(alias="sequenceId")
    quality: SignalQualityMetadata | None = None
    features: SignalFeatures | None = None
    training: AttentionMetricSampleModel | None = None


class AffectiveCalibrationStateResponse(BaseModel):
    """Response for the `/sessions/{id}/calibration*` endpoints. Unrelated
    to `CalibrationProfile` below, which is a different (training-feature)
    baseline-ratio calibration."""

    model_config = ConfigDict(populate_by_name=True)

    status: Literal["off", "collecting", "active"]
    progress: int
    required: int


class CalibrationProfile(BaseModel):
    """The Training feature's locked-in baseline snapshot -- returned by
    `GET /sessions/{id}/training/calibration-profile` once
    `AttentionBaselineProvider`'s baseline has filled (metadata/diagnostics
    only; it doesn't gate whether scores are being produced -- see
    `training.py`)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    algorithm_version: str = Field(alias="algorithmVersion")
    created_at_ms: float = Field(alias="createdAtMs")
    baseline_ratio: float | None = Field(alias="baselineRatio")
    baseline_ratio_spread: float | None = Field(default=None, alias="baselineRatioSpread")
    baseline_brainflow_mindfulness: float | None = Field(default=None, alias="baselineBrainflowMindfulness")
    baseline_brainflow_mindfulness_spread: float | None = Field(
        default=None, alias="baselineBrainflowMindfulnessSpread",
    )
    baseline_brainflow_restfulness: float | None = Field(default=None, alias="baselineBrainflowRestfulness")
    baseline_brainflow_restfulness_spread: float | None = Field(
        default=None, alias="baselineBrainflowRestfulnessSpread",
    )
    accepted_windows: int = Field(alias="acceptedWindows")
    rejected_windows: int = Field(alias="rejectedWindows")
    rejection_reasons: dict[str, int] = Field(alias="rejectionReasons")
    device_info: DeviceInfo | None = Field(default=None, alias="deviceInfo")
    metadata: dict[str, Any] = Field(default_factory=dict)
