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

    # Valence/arousal proxy, its raw values, nearest-label classification,
    # and confidence. Session streams smooth these values; no baseline
    # calibration is applied.
    valence: float | None = None
    arousal: float | None = None
    raw_valence: float | None = Field(default=None, alias="rawValence")
    raw_arousal: float | None = Field(default=None, alias="rawArousal")
    state_label: str | None = Field(default=None, alias="stateLabel")
    confidence: float | None = None
    # 0–1 magnitude-squared spectral coherence across AF7↔AF8 and TP9↔TP10.
    # Null when the window lacks one of those valid left/right channel pairs.
    interhemispheric_coherence: float | None = Field(
        default=None, alias="interhemisphericCoherence",
    )
    theta_beta_ratio: float | None = Field(default=None, alias="thetaBetaRatio")
    in_zone: bool | None = Field(default=None, alias="inZone")
    zone_score: float | None = Field(default=None, alias="zoneScore")


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


class TrainingMetricSampleModel(BaseModel):
    """A mindfulness score normalized against this connection's first 24
    reliable mindfulness windows."""

    model_config = ConfigDict(populate_by_name=True)

    score: float | None = None
    baseline_ready: bool = Field(alias="baselineReady")


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
    training: TrainingMetricSampleModel | None = None
