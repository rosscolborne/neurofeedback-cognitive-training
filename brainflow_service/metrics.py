"""One session-scoped source of truth for derived EEG metrics."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .affective_state import AffectiveState, FitQualityHint, compute_affective_state

DEFAULT_SMOOTHING_ALPHA = 0.05


@dataclass(frozen=True)
class MetricInput:
    absolute_bands: dict[str, float]
    interhemispheric_coherence: float | None
    raw_mindfulness: float | None
    raw_restfulness: float | None
    protocol: str
    threshold: float
    reliable: bool
    fit: FitQualityHint | None = None


@dataclass(frozen=True)
class BrainFlowScores:
    mindfulness_score: float | None
    restfulness_score: float | None


@dataclass(frozen=True)
class ProtocolFeedback:
    metric_name: str | None
    value: float | None
    in_zone: bool | None
    zone_score: float | None


@dataclass(frozen=True)
class MetricSnapshot:
    absolute_bands: dict[str, float]
    relative_bands: dict[str, float]
    ratios: dict[str, float]
    brainflow_scores: BrainFlowScores
    affective_state: AffectiveState | None
    interhemispheric_coherence: float | None
    protocol_feedback: ProtocolFeedback
    calibration_status: str = "off"
    calibration_progress: int = 0
    calibration_required: int = 24
    raw_metrics: dict[str, float] | None = None
    baseline_relative_metrics: dict[str, float] | None = None


class MetricCalibration:
    """Independent baseline-relative display transforms for one session.

    A caller can start a selected set of metrics, or omit the set to
    calibrate every metric that becomes available (the Debug Console case).
    """
    required = 24
    def __init__(self) -> None:
        self.status = "off"
        self._requested: set[str] | None = set()
        self._samples: dict[str, list[float]] = {}
        self._baselines: dict[str, tuple[float, float]] = {}

    def start(self, metric_names: set[str] | None = None) -> None:
        self.status = "collecting"
        self._requested = None if metric_names is None else {_calibration_key(name) for name in metric_names}
        self._samples, self._baselines = {}, {}

    def reset(self) -> None:
        self.status, self._requested, self._samples, self._baselines = "off", set(), {}, {}

    def apply(self, values: dict[str, float]) -> dict[str, float]:
        if self.status == "off":
            return values
        keys = set(values) if self._requested is None else self._requested & set(values)
        for key in keys:
            samples = self._samples.setdefault(key, [])
            if len(samples) < self.required:
                samples.append(values[key])
                if len(samples) == self.required:
                    self._baselines[key] = baseline_distribution(samples)
        active = {key for key in keys if key in self._baselines}
        collecting = keys - active
        if collecting:
            self.status = "collecting"
        elif active:
            self.status = "active"
        return {
            key: calibration_percentile(value, *self._baselines[key])
            if key in self._baselines else value
            for key, value in values.items()
        }

    @property
    def progress(self) -> int:
        if not self._samples:
            return 0
        return min(len(samples) for samples in self._samples.values())

    @property
    def active_keys(self) -> set[str]:
        return set(self._baselines)


def _calibration_key(name: str) -> str:
    """Accept public metric names (e.g. thetaBeta) and internal keys."""
    if name in {"mindfulness", "restfulness", "valence", "arousal", "confidence", "ihc"} or name.startswith("ratio:"):
        return name
    return f"ratio:{name}"


def baseline_distribution(samples: list[float]) -> tuple[float, float]:
    """Mean and standard deviation defining the calibration normal curve."""
    centre = sum(samples) / len(samples)
    spread = math.sqrt(sum((value - centre) ** 2 for value in samples) / len(samples))
    spread = max(spread, 1e-9)
    return centre, spread


def calibration_percentile(
    value: float,
    centre: float,
    spread: float,
) -> float:
    """Percentile in the normal distribution fitted to calibration samples."""
    z_score = (value - centre) / max(spread, 1e-9)
    return 50.0 * (1.0 + math.erf(z_score / math.sqrt(2.0)))


class BandPowerSmoother:
    """EMA history for absolute PSD band powers, scoped to one device session."""
    def __init__(self, smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA) -> None:
        self._alpha = smoothing_alpha
        self._bands: dict[str, float] = {}

    def reset(self) -> None:
        self._bands.clear()

    def push(self, bands: dict[str, float]) -> dict[str, float]:
        result: dict[str, float] = {}
        for name, value in bands.items():
            if math.isfinite(value):
                self._bands[name] = smooth_ema(self._bands.get(name), max(0.0, value), self._alpha)
                result[name] = self._bands[name]
        return result


class BrainFlowScoreSmoother:
    """Output-level EMA for BrainFlow's independently trained model outputs."""
    def __init__(self, smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA) -> None:
        self._alpha = smoothing_alpha
        self._mindfulness: float | None = None
        self._restfulness: float | None = None

    def reset(self) -> None:
        self._mindfulness = self._restfulness = None

    def push(self, mindfulness: float | None, restfulness: float | None) -> BrainFlowScores:
        m, r = normalize_brainflow_score(mindfulness), normalize_brainflow_score(restfulness)
        if m is not None:
            self._mindfulness = smooth_ema(self._mindfulness, m, self._alpha)
        if r is not None:
            self._restfulness = smooth_ema(self._restfulness, r, self._alpha)
        return BrainFlowScores(
            None if self._mindfulness is None else round(_clamp(self._mindfulness, 0, 100)),
            None if self._restfulness is None else round(_clamp(self._restfulness, 0, 100)),
        )


class MetricCalculator:
    """Calculates every product metric for one live EEG connection."""
    def __init__(self, smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA) -> None:
        self._bands = BandPowerSmoother(smoothing_alpha)
        self._brainflow = BrainFlowScoreSmoother(smoothing_alpha)
        self._calibration = MetricCalibration()
        self._coherence: float | None = None
        self._alpha = smoothing_alpha

    def reset(self) -> None:
        self._bands.reset()
        self._brainflow.reset()
        self._coherence = None
        self._calibration.reset()

    def start_calibration(self, metric_names: set[str] | None = None) -> None:
        self._calibration.start(metric_names)

    def reset_calibration(self) -> None:
        self._calibration.reset()

    def push(self, metric_input: MetricInput) -> MetricSnapshot:
        absolute = self._bands.push(metric_input.absolute_bands)
        relative, ratios = compute_relative_band_powers(absolute), compute_band_ratios(absolute)
        coherence = self._push_coherence(metric_input.interhemispheric_coherence)
        # Do not display or feed an artifact-contaminated prediction into the
        # EMA history; raw model outputs remain available separately for
        # diagnostics in the transport payload.
        brainflow_scores = self._brainflow.push(metric_input.raw_mindfulness, metric_input.raw_restfulness) if metric_input.reliable else BrainFlowScores(None, None)
        affective = compute_affective_state(absolute, metric_input.fit) if metric_input.reliable else None
        feedback = compute_protocol_feedback(absolute, ratios, metric_input.protocol, metric_input.threshold) if metric_input.reliable else ProtocolFeedback(None, None, None, None)
        raw_display = _display_values(brainflow_scores, affective, coherence, ratios) if metric_input.reliable else {}
        display = self._calibration.apply(raw_display) if metric_input.reliable else {}
        baseline_relative = {key: display[key] for key in self._calibration.active_keys if key in display}
        if self._calibration.status == "active":
            brainflow_scores = BrainFlowScores(
                display.get("mindfulness", brainflow_scores.mindfulness_score),
                display.get("restfulness", brainflow_scores.restfulness_score),
            )
            ratios = {key: display.get(f"ratio:{key}", value) for key, value in ratios.items()}
            coherence = display.get("ihc", coherence)
            if affective:
                affective = AffectiveState(display.get("valence", affective.valence), display.get("arousal", affective.arousal), affective.label, display.get("confidence", affective.confidence))
        return MetricSnapshot(absolute, relative, ratios, brainflow_scores, affective, coherence, feedback, self._calibration.status, self._calibration.progress, self._calibration.required, raw_display, baseline_relative)

    def _push_coherence(self, value: float | None) -> float | None:
        if value is None or not math.isfinite(value):
            return None
        self._coherence = smooth_ema(self._coherence, value, self._alpha)
        return self._coherence


def _display_values(scores: BrainFlowScores, affective: AffectiveState | None, coherence: float | None, ratios: dict[str, float]) -> dict[str, float]:
    values = {f"ratio:{key}": value for key, value in ratios.items()}
    if scores.mindfulness_score is not None: values["mindfulness"] = scores.mindfulness_score
    if scores.restfulness_score is not None: values["restfulness"] = scores.restfulness_score
    if coherence is not None: values["ihc"] = coherence
    if affective:
        values.update(valence=affective.valence, arousal=affective.arousal, confidence=affective.confidence)
    return values


def compute_relative_band_powers(bands: dict[str, float]) -> dict[str, float]:
    total = sum(max(0.0, value) for value in bands.values() if math.isfinite(value))
    return {name: (max(0.0, value) / total if total else 0.0) for name, value in bands.items()}


def compute_band_ratios(bands: dict[str, float]) -> dict[str, float]:
    theta, alpha, smr, beta, gamma = (bands.get(name, 0.0) for name in ("theta", "alpha", "smr", "beta", "gamma"))
    return {
        "thetaBeta": safe_ratio(theta, beta), "betaTheta": safe_ratio(beta, theta),
        "alphaTheta": safe_ratio(alpha, theta), "thetaAlpha": safe_ratio(theta, alpha),
        "smrTheta": safe_ratio(smr, theta), "thetaAlphaBeta": safe_ratio(theta, alpha + beta),
        "alphaBeta": safe_ratio(alpha, beta), "betaAlpha": safe_ratio(beta, alpha),
        "arousal": safe_ratio(beta + gamma, alpha + theta),
        "valence": safe_ratio(alpha, theta + beta),
        "betaOverAlphaTheta": safe_ratio(beta, alpha + theta),
    }


def compute_protocol_feedback(bands: dict[str, float], ratios: dict[str, float], protocol: str, threshold: float) -> ProtocolFeedback:
    if protocol == "theta-beta-ratio": return _lower_is_better("thetaBeta", ratios.get("thetaBeta"), threshold, 1.5)
    if protocol == "smr-enhancement": return _higher_is_better("smr", bands.get("smr"), threshold, 1.5)
    if protocol in {"alpha-enhancement", "individualized-upper-alpha"}: return _higher_is_better("alpha", bands.get("alpha"), threshold, 2.0)
    if protocol == "alpha-theta-crossover": return _higher_is_better("thetaAlpha", ratios.get("thetaAlpha"), threshold, .5)
    if protocol == "beta-downtraining": return _lower_is_better("beta", bands.get("beta"), threshold, 5.0)
    return ProtocolFeedback(None, None, None, None)


def normalize_brainflow_score(value: float | None) -> float | None:
    return None if value is None or not math.isfinite(value) else _clamp(value * 100.0, 0, 100)


def smooth_ema(current: float | None, target: float, weight: float) -> float:
    return target if current is None else current * (1 - weight) + target * weight


def safe_ratio(numerator: float, denominator: float) -> float:
    return 0.0 if not math.isfinite(numerator) or not math.isfinite(denominator) else max(0.0, numerator) / max(1e-9, max(0.0, denominator))


def _higher_is_better(name: str, value: float | None, threshold: float, width: float) -> ProtocolFeedback:
    if value is None or not math.isfinite(value): return ProtocolFeedback(name, None, None, None)
    return ProtocolFeedback(name, value, value >= threshold, _clamp((value - threshold + width) / (2 * width), 0, 1))


def _lower_is_better(name: str, value: float | None, threshold: float, width: float) -> ProtocolFeedback:
    if value is None or not math.isfinite(value): return ProtocolFeedback(name, None, None, None)
    return ProtocolFeedback(name, value, value <= threshold, _clamp(1 - (value - threshold) / width, 0, 1))


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
