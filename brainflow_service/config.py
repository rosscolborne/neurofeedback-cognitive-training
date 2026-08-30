from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FrequencyBand:
    id: str
    label: str
    low_hz: float
    high_hz: float


@dataclass(frozen=True)
class ProcessingConfig:
    window_seconds: float = 2.0
    update_interval_seconds: float = 0.25
    notch_low_hz: float = 58.0
    notch_high_hz: float = 62.0
    bandpass_low_hz: float = 3.0
    bandpass_high_hz: float = 45.0
    filter_order: int = 4
    baseline_windows_required: int = 24
    smoothing_alpha: float = 0.22


DEFAULT_BANDS = (
    FrequencyBand("delta", "Delta", 1.0, 4.0),
    FrequencyBand("theta", "Theta", 4.0, 8.0),
    FrequencyBand("alpha", "Alpha", 8.0, 13.0),
    # SMR is a clinically distinct 12–15 Hz reward band. It intentionally
    # overlaps the conventional alpha/beta boundaries so it can be surfaced
    # independently for SMR-enhancement protocols.
    FrequencyBand("smr", "Sensorimotor Rhythm", 12.0, 15.0),
    FrequencyBand("beta", "Beta", 13.0, 30.0),
    FrequencyBand("gamma", "Gamma", 30.0, 45.0),
)

DEFAULT_PROCESSING = ProcessingConfig()


@dataclass(frozen=True)
class BrainFlowDeviceConfig:
    id: str
    label: str
    board_id_name: str
    mode: str
    preset: str = "DEFAULT_PRESET"
    other_info: str = ""
    startup_attempts: int = 1
    startup_retry_delay_seconds: float = 1.5


DEVICE_CONFIGS = {
    "brainflow-muse-athena": BrainFlowDeviceConfig(
        id="brainflow-muse-athena",
        label="Muse Athena",
        board_id_name="MUSE_S_ATHENA_BOARD",
        mode="live",
        other_info="preset=p1041;low_latency=true",
        startup_attempts=4,
        startup_retry_delay_seconds=2.0,
    ),
    "brainflow-synthetic": BrainFlowDeviceConfig(
        id="brainflow-synthetic",
        label="BrainFlow Synthetic",
        board_id_name="SYNTHETIC_BOARD",
        mode="synthetic",
    ),
}
