"""Shared robust baseline normalization.

The bundled app has (had) two different baseline-calibration strategies:

- `attentionMetric.ts`'s `HeuristicAttentionProvider` (the Training feature):
  collects a rolling baseline, computes a **median/MAD-based** center and
  spread (robust to outliers, unlike a raw mean/stddev), and maps new
  values to a 0-100 score via a z-score through `tanh`.
- `affectiveStateMetric.ts`'s `AffectiveStateProvider` (valence/arousal):
  collected a baseline **median only**, and calibrated by a flat
  `value - median`, clamped -- no spread normalization at all, so the same
  absolute offset means something different depending on how naturally
  noisy the signal is.

This module is the one, shared implementation of the more robust
(median/MAD z-score) approach; `training.py` and `affective_state.py` both
use it now, via `BaselineCollector`. This is a deliberate improvement over
the current bundled app, not just a port -- the TS `AffectiveStateProvider`
still uses the simpler raw-offset approach.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

DEFAULT_BASELINE_SAMPLE_COUNT = 24
DEFAULT_Z_SCORE_SCALE = 1.5
MIN_SAMPLES_FOR_ROBUST_STATS = 4


def median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


@dataclass(frozen=True)
class RobustStats:
    center: float
    spread: float


def compute_robust_stats(values: list[float]) -> RobustStats | None:
    """Port of `robustStats` (attentionMetric.ts): median center, spread
    from MAD * 1.4826 (the constant that makes MAD a consistent estimator
    of standard deviation under normality), falling back to range/6 when
    the baseline is too homogeneous for MAD to give a stable spread.
    Returns `None` (rather than a zero/near-zero spread) when fewer than
    `MIN_SAMPLES_FOR_ROBUST_STATS` values are available, or the computed
    spread isn't a usable positive number -- callers should treat that as
    "not enough baseline yet", not "baseline is exactly zero"."""
    if len(values) < MIN_SAMPLES_FOR_ROBUST_STATS:
        return None

    center = median(values)
    deviations = [abs(v - center) for v in values]
    mad = median(deviations)
    fallback_spread = (max(values) - min(values)) / 6
    spread = max(mad * 1.4826, fallback_spread)

    if not math.isfinite(spread) or spread <= 0:
        return None

    return RobustStats(center=center, spread=spread)


def z_score(value: float | None, stats: RobustStats | None) -> float | None:
    if value is None or stats is None:
        return None
    return (value - stats.center) / stats.spread


def map_z_score_to_score(value: float | None, scale: float = DEFAULT_Z_SCORE_SCALE) -> float | None:
    """Port of `mapZScoreToScore`: squashes a z-score into a 0-100 score
    centered at 50 (the baseline) via `tanh`, so readings near the
    baseline stay near 50 and extreme deviations saturate towards 5/95
    rather than running past 0/100."""
    if value is None or not math.isfinite(value):
        return None
    return 50 + math.tanh(value / scale) * 45


class BaselineCollector:
    """Accumulates up to `sample_count` raw values (a one-time baseline
    window -- collection stops once full, matching the TS behavior of
    freezing the baseline rather than letting it drift), then exposes a
    plain median and the robust stats above for scoring subsequent
    values."""

    def __init__(self, sample_count: int = DEFAULT_BASELINE_SAMPLE_COUNT) -> None:
        self._sample_count = sample_count
        self._values: list[float] = []

    def reset(self) -> None:
        self._values = []

    @property
    def sample_count(self) -> int:
        return self._sample_count

    @property
    def collected(self) -> int:
        return len(self._values)

    @property
    def is_full(self) -> bool:
        return len(self._values) >= self._sample_count

    def accept(self, value: float) -> None:
        if not self.is_full:
            self._values.append(value)

    def median(self) -> float | None:
        return median(self._values) if self._values else None

    def stats(self) -> RobustStats | None:
        return compute_robust_stats(self._values)
