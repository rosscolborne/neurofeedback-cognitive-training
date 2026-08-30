from __future__ import annotations

from dataclasses import asdict
import logging

import numpy as np

from .config import DEFAULT_BANDS, DEFAULT_PROCESSING, FrequencyBand, ProcessingConfig
from .models import BandPowerFeatures

logger = logging.getLogger(__name__)


def build_eeg_window(data: np.ndarray, eeg_channels: list[int], samples: int) -> np.ndarray | None:
    if data.size == 0 or samples <= 0:
        return None
    if data.shape[1] < samples:
        return None

    window = data[np.array(eeg_channels), -samples:].astype(float, copy=True)
    if not np.isfinite(window).all():
        return None
    return np.ascontiguousarray(window)


def preprocess_eeg_window(
    window: np.ndarray,
    sampling_rate: int,
    config: ProcessingConfig = DEFAULT_PROCESSING,
) -> np.ndarray:
    processed = np.ascontiguousarray(window.astype(float, copy=True))
    try:
        from brainflow.data_filter import DataFilter, DetrendOperations, FilterTypes

        for channel_index in range(processed.shape[0]):
            channel = processed[channel_index]
            DataFilter.detrend(channel, DetrendOperations.CONSTANT.value)
            DataFilter.perform_bandpass(
                channel,
                sampling_rate,
                config.bandpass_low_hz,
                config.bandpass_high_hz,
                config.filter_order,
                FilterTypes.BUTTERWORTH_ZERO_PHASE.value,
                0.0,
            )
            DataFilter.perform_bandstop(
                channel,
                sampling_rate,
                config.notch_low_hz,
                config.notch_high_hz,
                config.filter_order,
                FilterTypes.BUTTERWORTH_ZERO_PHASE.value,
                0.0,
            )
    except Exception:
        processed -= processed.mean(axis=1, keepdims=True)
    return processed


def extract_band_power_features(
    window: np.ndarray,
    sampling_rate: int,
    bands: tuple[FrequencyBand, ...] = DEFAULT_BANDS,
) -> BandPowerFeatures | None:
    if window.size == 0 or window.shape[1] < max(16, sampling_rate):
        return None
    if not np.isfinite(window).all():
        return None

    try:
        from brainflow.data_filter import DataFilter, WindowOperations

        nfft = DataFilter.get_nearest_power_of_two(window.shape[1])
        if nfft >= window.shape[1]:
            nfft = max(16, nfft // 2)
        absolute: dict[str, float] = {}
        per_channel: dict[str, list[float]] = {band.id: [] for band in bands}

        for channel in window:
            psd = DataFilter.get_psd_welch(
                np.ascontiguousarray(channel),
                nfft,
                nfft // 2,
                sampling_rate,
                WindowOperations.HANNING.value,
            )
            for band in bands:
                power = DataFilter.get_band_power(psd, band.low_hz, band.high_hz)
                per_channel[band.id].append(float(power))

        for band in bands:
            values = per_channel[band.id]
            absolute[band.id] = float(np.mean(values)) if values else 0.0
    except Exception:
        absolute = fallback_band_powers(window, sampling_rate, bands)

    total = sum(max(0.0, value) for value in absolute.values())
    relative = {
        key: (max(0.0, value) / total if total > 0 else 0.0)
        for key, value in absolute.items()
    }
    theta = absolute.get("theta", 0.0)
    alpha = absolute.get("alpha", 0.0)
    beta = absolute.get("beta", 0.0)

    return BandPowerFeatures(
        absolute=absolute,
        relative=relative,
        ratios={
            "alphaTheta": safe_ratio(alpha, theta),
            "betaTheta": safe_ratio(beta, theta),
            "thetaBeta": safe_ratio(theta, beta),
            "betaOverAlphaTheta": safe_ratio(beta, alpha + theta),
        },
        window_seconds=window.shape[1] / sampling_rate,
        method="brainflow_welch_psd",
    )


def extract_brainflow_mental_state(
    window: np.ndarray,
    sampling_rate: int,
    metric: str,
) -> float | None:
    """Run one of BrainFlow's bundled MLModel classifiers (mindfulness/restfulness).

    `window` must be the raw, unfiltered EEG window. BrainFlow's default
    classifiers were trained on `get_avg_band_powers(..., apply_filter=True)`
    features computed from raw data -- that method applies BrainFlow's own
    per-band filtering internally. Passing an already bandpass/notch-filtered
    window here (as this project's display pipeline uses) and asking
    `get_avg_band_powers` to skip filtering produces a feature vector outside
    the distribution the classifier expects (most notably the delta band gets
    starved by our 3 Hz highpass), so predictions come back degenerate rather
    than reflecting the real signal. Always call this with raw samples.
    """
    if window.size == 0 or window.shape[1] < max(16, sampling_rate):
        return None
    if not np.isfinite(window).all():
        return None

    try:
        from brainflow.data_filter import DataFilter
        from brainflow.ml_model import (
            BrainFlowClassifiers,
            BrainFlowMetrics,
            BrainFlowModelParams,
            MLModel,
        )

        metric_id = {
            "mindfulness": BrainFlowMetrics.MINDFULNESS.value,
            "restfulness": BrainFlowMetrics.RESTFULNESS.value,
        }.get(metric)
        if metric_id is None:
            return None

        eeg_rows = list(range(window.shape[0]))
        avg_band_powers, _ = DataFilter.get_avg_band_powers(
            np.ascontiguousarray(window),
            eeg_rows,
            sampling_rate,
            True,
        )
        model = MLModel(
            BrainFlowModelParams(
                metric_id,
                BrainFlowClassifiers.DEFAULT_CLASSIFIER.value,
            ),
        )
        try:
            model.prepare()
            prediction = model.predict(avg_band_powers)
        finally:
            model.release()

        if len(prediction) == 0 or not np.isfinite(prediction[0]):
            logger.warning(
                "BrainFlow %s metric returned no usable prediction (raw=%s)",
                metric,
                prediction,
            )
            return None
        return float(np.clip(prediction[0], 0.0, 1.0))
    except Exception:
        logger.exception("BrainFlow %s metric extraction failed", metric)
        return None


def extract_brainflow_mindfulness(window: np.ndarray, sampling_rate: int) -> float | None:
    return extract_brainflow_mental_state(window, sampling_rate, "mindfulness")


def extract_brainflow_restfulness(window: np.ndarray, sampling_rate: int) -> float | None:
    return extract_brainflow_mental_state(window, sampling_rate, "restfulness")


def config_metadata(config: ProcessingConfig = DEFAULT_PROCESSING) -> dict[str, object]:
    return {
        "processing": asdict(config),
        "bands": [asdict(band) for band in DEFAULT_BANDS],
    }


def safe_ratio(numerator: float, denominator: float) -> float:
    return float(numerator / max(1e-9, denominator))


def fallback_band_powers(
    window: np.ndarray,
    sampling_rate: int,
    bands: tuple[FrequencyBand, ...],
) -> dict[str, float]:
    freqs = np.fft.rfftfreq(window.shape[1], d=1.0 / sampling_rate)
    spectrum = np.abs(np.fft.rfft(window - window.mean(axis=1, keepdims=True), axis=1)) ** 2
    powers: dict[str, float] = {}
    for band in bands:
        mask = (freqs >= band.low_hz) & (freqs <= band.high_hz)
        powers[band.id] = float(np.mean(spectrum[:, mask])) if mask.any() else 0.0
    return powers
