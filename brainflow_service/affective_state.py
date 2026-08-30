"""Valence/arousal state, calibration, and smoothing.

Python port of `src/metrics/affectiveStateMetric.ts`'s `AffectiveStateProvider`.
Wraps `MindStateSmoother` (mindfulness/restfulness/focus/relax) and adds the
two-axis valence/arousal proxy, its baseline calibration, and nearest-label
classification, so a session carries the full set of scores the bundled
app's "Valence / Arousal" panel shows -- not just the four headline scores.

Calibration uses `baseline.py`'s median/MAD z-score normalization -- the
same one `training.py` uses -- rather than the TS version's simpler
`value - median`, clamped offset. This is a deliberate improvement over the
current bundled app, not a faithful port of this one piece: with only a
flat offset, the same absolute deviation means something different
depending on how naturally noisy the signal is, whereas a z-score accounts
for that spread. There is intentionally no less-robust alternative left in
this module.

`AffectiveStateProvider.push` accepts `reliable` and `fit` so a caller can
wire in real quality gating -- `brainflow_service/runtime.py` does this with
`headset_fit.py`'s `HeuristicHeadsetFitProvider`, matching the TS version's
`if (quality?.excessiveArtifact) return null` gate and its confidence
`qualityFactor`. Both default to "no quality signal available" (always
reliable, full-confidence) for callers that don't have a fit assessment to
hand, e.g. the stateless `/analyze-window` endpoint.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from .baseline import DEFAULT_BASELINE_SAMPLE_COUNT, DEFAULT_Z_SCORE_SCALE, BaselineCollector, z_score
from .metrics import DEFAULT_SMOOTHING_ALPHA, MindStateSmoother

NEUTRAL_RADIUS = 0.18


@dataclass(frozen=True)
class EmotionRegion:
    label: str
    valence: float
    arousal: float


# Port of `affectiveEmotionRegions` in affectiveStateMetric.ts.
AFFECTIVE_EMOTION_REGIONS: tuple[EmotionRegion, ...] = (
    EmotionRegion("Tense", -0.25, 0.78),
    EmotionRegion("Angry", -0.68, 0.55),
    EmotionRegion("Frustrated", -0.72, 0.25),
    EmotionRegion("Depressed", -0.74, -0.25),
    EmotionRegion("Bored", -0.58, -0.58),
    EmotionRegion("Tired", -0.25, -0.82),
    EmotionRegion("Calm", 0.25, -0.82),
    EmotionRegion("Relaxed", 0.58, -0.58),
    EmotionRegion("Content", 0.72, -0.25),
    EmotionRegion("Happy", 0.72, 0.25),
    EmotionRegion("Delighted", 0.62, 0.55),
    EmotionRegion("Excited", 0.32, 0.78),
)


@dataclass(frozen=True)
class AffectiveCalibrationState:
    status: Literal["off", "collecting", "active"]
    progress: int
    required: int


@dataclass(frozen=True)
class AffectiveStateSample:
    at_ms: float
    valence: float
    arousal: float
    raw_valence: float
    raw_arousal: float
    calibration_active: bool
    label: str
    confidence: float
    theta_power: float
    alpha_power: float
    beta_power: float
    gamma_power: float
    mindfulness_score: float | None
    restfulness_score: float | None
    focus_score: int
    relax_score: int
    reliable: bool


@dataclass(frozen=True)
class FitQualityHint:
    """Minimal view of a `headset_fit.HeadsetFitSnapshot` needed for the
    confidence calculation -- avoids a hard dependency on `headset_fit.py`
    for callers that don't have (or want) a fit assessment."""

    ready: bool
    state: str | None


def confidence_quality_factor(fit: FitQualityHint | None) -> float:
    """Port of the `qualityFactor` term in `estimateConfidence` (TS).
    `fit=None` means "no quality signal available" and returns 1.0 (full
    confidence, i.e. distance-only) rather than the TS default of 0.45 --
    that default only exists in the browser to handle a race before the
    first headset-fit snapshot exists, which doesn't apply here."""
    if fit is None:
        return 1.0
    if fit.ready:
        return 1.0
    if fit.state == "good":
        return 0.75
    return 0.45


@dataclass(frozen=True)
class RawAffectiveSample:
    """Single-window valence/arousal with no smoothing or calibration --
    used by the stateless `/analyze-window` endpoint."""

    valence: float
    arousal: float
    label: str
    confidence: float


def map_ratio_to_axis(ratio: float) -> float:
    """Port of `mapRatioToAxis`."""
    if not math.isfinite(ratio) or ratio <= 0:
        return 0.0
    return _clamp(math.tanh(math.log2(ratio) / 2.5), -1.0, 1.0)


def classify_affective_state(valence: float, arousal: float) -> str:
    """Port of `classifyAffectiveState`: nearest named region, or "Neutral"
    within `NEUTRAL_RADIUS` of the origin."""
    if math.hypot(valence, arousal) < NEUTRAL_RADIUS:
        return "Neutral"

    nearest = AFFECTIVE_EMOTION_REGIONS[0]
    nearest_distance = math.inf
    for region in AFFECTIVE_EMOTION_REGIONS:
        distance = math.hypot(valence - region.valence, arousal - region.arousal)
        if distance < nearest_distance:
            nearest = region
            nearest_distance = distance
    return nearest.label


def estimate_confidence(valence: float, arousal: float, quality_factor: float = 1.0) -> float:
    """Port of `estimateConfidence`. Pass `confidence_quality_factor(fit)`
    for `quality_factor` to fold in a real headset-fit assessment; the
    default (1.0) is distance-only."""
    distance = min(1.0, math.hypot(valence, arousal))
    return _clamp(distance * quality_factor, 0.0, 1.0)


def compute_raw_affective_sample(
    theta_power: float,
    alpha_power: float,
    beta_power: float,
    gamma_power: float,
) -> RawAffectiveSample | None:
    theta = _finite_power(theta_power)
    alpha = _finite_power(alpha_power)
    beta = _finite_power(beta_power)
    gamma = _finite_power(gamma_power)
    if theta + alpha + beta + gamma <= 0:
        return None

    raw_arousal = map_ratio_to_axis((beta + gamma) / (alpha + theta + 1e-9))
    raw_valence = map_ratio_to_axis(alpha / (theta + beta + 1e-9))
    return RawAffectiveSample(
        valence=raw_valence,
        arousal=raw_arousal,
        label=classify_affective_state(raw_valence, raw_arousal),
        confidence=estimate_confidence(raw_valence, raw_arousal),
    )


class AffectiveStateProvider:
    """Stateful, per-session port of `AffectiveStateProvider`
    (affectiveStateMetric.ts): valence/arousal with slow-EMA smoothing and
    optional robust-baseline calibration, plus the four headline scores via
    an internal `MindStateSmoother`."""

    def __init__(
        self,
        smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA,
        calibration_sample_count: int = DEFAULT_BASELINE_SAMPLE_COUNT,
        z_score_scale: float = DEFAULT_Z_SCORE_SCALE,
    ) -> None:
        self._alpha = smoothing_alpha
        self._z_score_scale = z_score_scale
        self._mind_state = MindStateSmoother(smoothing_alpha)
        self._smoothed_valence: float | None = None
        self._smoothed_arousal: float | None = None
        self._calibration_status: Literal["off", "collecting", "active"] = "off"
        self._valence_baseline = BaselineCollector(calibration_sample_count)
        self._arousal_baseline = BaselineCollector(calibration_sample_count)
        self._calibration_profile_active = False

    def reset(self) -> None:
        self._smoothed_valence = None
        self._smoothed_arousal = None
        self._mind_state.reset()
        self.reset_calibration()

    def start_calibration(self) -> None:
        self._calibration_status = "collecting"
        self._valence_baseline.reset()
        self._arousal_baseline.reset()
        self._calibration_profile_active = False
        self._smoothed_valence = None
        self._smoothed_arousal = None

    def reset_calibration(self) -> None:
        self._calibration_status = "off"
        self._valence_baseline.reset()
        self._arousal_baseline.reset()
        self._calibration_profile_active = False
        self._smoothed_valence = None
        self._smoothed_arousal = None

    def get_calibration_state(self) -> AffectiveCalibrationState:
        if self._calibration_status == "collecting":
            progress = min(self._valence_baseline.collected, self._valence_baseline.sample_count)
        elif self._calibration_status == "active":
            progress = self._valence_baseline.sample_count
        else:
            progress = 0
        return AffectiveCalibrationState(
            status=self._calibration_status,
            progress=progress,
            required=self._valence_baseline.sample_count,
        )

    def push(
        self,
        *,
        at_ms: float,
        theta_power: float,
        alpha_power: float,
        beta_power: float,
        gamma_power: float,
        raw_mindfulness: float | None,
        raw_restfulness: float | None,
        reliable: bool = True,
        fit: FitQualityHint | None = None,
    ) -> AffectiveStateSample | None:
        if not reliable:
            return None

        theta = _finite_power(theta_power)
        alpha = _finite_power(alpha_power)
        beta = _finite_power(beta_power)
        gamma = _finite_power(gamma_power)
        if theta + alpha + beta + gamma <= 0:
            return None

        raw_arousal = map_ratio_to_axis((beta + gamma) / (alpha + theta + 1e-9))
        raw_valence = map_ratio_to_axis(alpha / (theta + beta + 1e-9))
        self._accept_calibration_sample(raw_valence, raw_arousal)

        calibrated_valence = (
            raw_valence
            if not self._calibration_profile_active
            else self._map_z_score_to_axis(z_score(raw_valence, self._valence_baseline.stats()))
        )
        calibrated_arousal = (
            raw_arousal
            if not self._calibration_profile_active
            else self._map_z_score_to_axis(z_score(raw_arousal, self._arousal_baseline.stats()))
        )

        mind_state = self._mind_state.push(
            theta_power=theta,
            alpha_power=alpha,
            beta_power=beta,
            raw_mindfulness=raw_mindfulness,
            raw_restfulness=raw_restfulness,
        )

        self._smoothed_valence = (
            calibrated_valence
            if self._smoothed_valence is None
            else _smooth(self._smoothed_valence, calibrated_valence, self._alpha)
        )
        self._smoothed_arousal = (
            calibrated_arousal
            if self._smoothed_arousal is None
            else _smooth(self._smoothed_arousal, calibrated_arousal, self._alpha)
        )

        valence = _clamp(self._smoothed_valence, -1.0, 1.0)
        arousal = _clamp(self._smoothed_arousal, -1.0, 1.0)

        return AffectiveStateSample(
            at_ms=at_ms,
            valence=valence,
            arousal=arousal,
            raw_valence=raw_valence,
            raw_arousal=raw_arousal,
            calibration_active=self._calibration_profile_active,
            label=classify_affective_state(valence, arousal),
            confidence=estimate_confidence(valence, arousal, confidence_quality_factor(fit)),
            theta_power=theta,
            alpha_power=alpha,
            beta_power=beta,
            gamma_power=gamma,
            mindfulness_score=mind_state.mindfulness_score,
            restfulness_score=mind_state.restfulness_score,
            focus_score=mind_state.focus_score,
            relax_score=mind_state.relax_score,
            reliable=reliable,
        )

    def _accept_calibration_sample(self, raw_valence: float, raw_arousal: float) -> None:
        if self._calibration_status != "collecting":
            return

        self._valence_baseline.accept(raw_valence)
        self._arousal_baseline.accept(raw_arousal)
        if not (self._valence_baseline.is_full and self._arousal_baseline.is_full):
            return

        # Robust stats need real spread in the baseline (see
        # `baseline.compute_robust_stats`); a baseline with none (e.g. a
        # perfectly flat/frozen signal) leaves calibration "collecting"
        # rather than activating on a meaningless zero-spread baseline.
        if self._valence_baseline.stats() is None or self._arousal_baseline.stats() is None:
            return

        self._calibration_profile_active = True
        self._calibration_status = "active"
        self._smoothed_valence = None
        self._smoothed_arousal = None

    def _map_z_score_to_axis(self, value: float | None) -> float:
        if value is None or not math.isfinite(value):
            return 0.0
        return _clamp(math.tanh(value / self._z_score_scale), -1.0, 1.0)


def _finite_power(value: float) -> float:
    return max(0.0, value) if math.isfinite(value) else 0.0


def _smooth(current: float, target: float, weight: float) -> float:
    return current * (1 - weight) + target * weight


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
