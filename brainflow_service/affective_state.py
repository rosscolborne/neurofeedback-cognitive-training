"""Valence/arousal state and smoothing.

Python port of `src/metrics/affectiveStateMetric.ts`'s `AffectiveStateProvider`.
Wraps `MindStateSmoother` (mindfulness/restfulness/focus/relax) and adds the
two-axis valence/arousal proxy and nearest-label classification. These are
live, smoothed metrics; the service has no baseline-calibration state.

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
class AffectiveStateSample:
    at_ms: float
    valence: float
    arousal: float
    raw_valence: float
    raw_arousal: float
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
    """Single-window valence/arousal with no smoothing --
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
    the four headline scores via an internal `MindStateSmoother`."""

    def __init__(
        self,
        smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA,
    ) -> None:
        self._alpha = smoothing_alpha
        self._mind_state = MindStateSmoother(smoothing_alpha)
        self._smoothed_valence: float | None = None
        self._smoothed_arousal: float | None = None

    def reset(self) -> None:
        self._smoothed_valence = None
        self._smoothed_arousal = None
        self._mind_state.reset()

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
        mind_state = self._mind_state.push(
            theta_power=theta,
            alpha_power=alpha,
            beta_power=beta,
            raw_mindfulness=raw_mindfulness,
            raw_restfulness=raw_restfulness,
        )

        self._smoothed_valence = (
            raw_valence
            if self._smoothed_valence is None
            else _smooth(self._smoothed_valence, raw_valence, self._alpha)
        )
        self._smoothed_arousal = (
            raw_arousal
            if self._smoothed_arousal is None
            else _smooth(self._smoothed_arousal, raw_arousal, self._alpha)
        )

        valence = _clamp(self._smoothed_valence, -1.0, 1.0)
        arousal = _clamp(self._smoothed_arousal, -1.0, 1.0)

        return AffectiveStateSample(
            at_ms=at_ms,
            valence=valence,
            arousal=arousal,
            raw_valence=raw_valence,
            raw_arousal=raw_arousal,
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

def _finite_power(value: float) -> float:
    return max(0.0, value) if math.isfinite(value) else 0.0


def _smooth(current: float, target: float, weight: float) -> float:
    return current * (1 - weight) + target * weight


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
