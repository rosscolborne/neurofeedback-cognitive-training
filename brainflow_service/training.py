"""Per-session baseline-relative Training score.

This is intentionally separate from the UI's 60-second Calibration phase
and from the explicit calibration controls.  It learns a fixed personal
reference from the first 24 reliable BrainFlow mindfulness readings, then
reports later readings relative to that reference.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median


BASELINE_WINDOW_COUNT = 24
Z_SCORE_SCALE = 1.5
SMOOTHING_ALPHA = 0.22


@dataclass(frozen=True)
class TrainingScoreSample:
    score: float | None
    baseline_ready: bool


class TrainingScoreProvider:
    """Owns the fixed Training-score baseline for one live connection."""

    def __init__(self) -> None:
        self._baseline_values: list[float] = []
        self._center: float | None = None
        self._spread: float | None = None
        self._smoothed_score: float | None = None

    def push(self, mindfulness: float | None, *, reliable: bool) -> TrainingScoreSample:
        if not reliable or mindfulness is None or not math.isfinite(mindfulness):
            return TrainingScoreSample(score=None, baseline_ready=self.baseline_ready)

        if not self.baseline_ready:
            self._baseline_values.append(mindfulness)
            if len(self._baseline_values) < BASELINE_WINDOW_COUNT:
                return TrainingScoreSample(score=None, baseline_ready=False)
            self._freeze_baseline()

        if self._center is None or self._spread is None:
            return TrainingScoreSample(score=None, baseline_ready=False)

        z_score = (mindfulness - self._center) / self._spread
        raw_score = 50.0 + math.tanh(z_score / Z_SCORE_SCALE) * 45.0
        self._smoothed_score = (
            raw_score
            if self._smoothed_score is None
            else self._smoothed_score * (1.0 - SMOOTHING_ALPHA) + raw_score * SMOOTHING_ALPHA
        )
        return TrainingScoreSample(score=round(min(100.0, max(0.0, self._smoothed_score))), baseline_ready=True)

    @property
    def baseline_ready(self) -> bool:
        return self._center is not None and self._spread is not None

    def _freeze_baseline(self) -> None:
        center = median(self._baseline_values)
        mad = median([abs(value - center) for value in self._baseline_values])
        spread = max(mad * 1.4826, (max(self._baseline_values) - min(self._baseline_values)) / 6.0)
        if math.isfinite(spread) and spread > 0.0:
            self._center = center
            self._spread = spread
