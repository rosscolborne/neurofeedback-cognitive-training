"""Pure valence/arousal proxy helpers for raw per-window band powers."""
from __future__ import annotations

import math
from dataclasses import dataclass

NEUTRAL_RADIUS = 0.18


@dataclass(frozen=True)
class EmotionRegion:
    label: str
    valence: float
    arousal: float


AFFECTIVE_EMOTION_REGIONS: tuple[EmotionRegion, ...] = (
    EmotionRegion("Tense", -.25, .78), EmotionRegion("Angry", -.68, .55),
    EmotionRegion("Frustrated", -.72, .25), EmotionRegion("Depressed", -.74, -.25),
    EmotionRegion("Bored", -.58, -.58), EmotionRegion("Tired", -.25, -.82),
    EmotionRegion("Calm", .25, -.82), EmotionRegion("Relaxed", .58, -.58),
    EmotionRegion("Content", .72, -.25), EmotionRegion("Happy", .72, .25),
    EmotionRegion("Delighted", .62, .55), EmotionRegion("Excited", .32, .78),
)


@dataclass(frozen=True)
class FitQualityHint:
    ready: bool
    state: str | None


@dataclass(frozen=True)
class AffectiveState:
    valence: float
    arousal: float
    label: str
    confidence: float


def map_ratio_to_axis(ratio: float) -> float:
    return 0.0 if not math.isfinite(ratio) or ratio <= 0 else _clamp(math.tanh(math.log2(ratio) / 2.5), -1, 1)


def compute_affective_state(bands: dict[str, float], fit: FitQualityHint | None = None) -> AffectiveState | None:
    theta, alpha, beta, gamma = (_finite_power(bands.get(name, 0.0)) for name in ("theta", "alpha", "beta", "gamma"))
    if theta + alpha + beta + gamma <= 0:
        return None
    arousal = map_ratio_to_axis((beta + gamma) / (alpha + theta + 1e-9))
    valence = map_ratio_to_axis(alpha / (theta + beta + 1e-9))
    return AffectiveState(valence, arousal, classify_affective_state(valence, arousal), estimate_confidence(valence, arousal, confidence_quality_factor(fit)))


def classify_affective_state(valence: float, arousal: float) -> str:
    if math.hypot(valence, arousal) < NEUTRAL_RADIUS:
        return "Neutral"
    return min(AFFECTIVE_EMOTION_REGIONS, key=lambda r: math.hypot(valence - r.valence, arousal - r.arousal)).label


def confidence_quality_factor(fit: FitQualityHint | None) -> float:
    if fit is None or fit.ready:
        return 1.0
    return .75 if fit.state == "good" else .45


def estimate_confidence(valence: float, arousal: float, quality_factor: float = 1.0) -> float:
    return _clamp(min(1.0, math.hypot(valence, arousal)) * quality_factor, 0, 1)


def _finite_power(value: float) -> float:
    return max(0.0, value) if math.isfinite(value) else 0.0


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
