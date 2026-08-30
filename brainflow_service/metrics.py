"""Mindfulness, restfulness, focus, and relax scoring.

This is a Python port of the scoring logic that previously lived only in the
browser (`src/metrics/neurofeedbackRatios.ts` and the relevant parts of
`src/metrics/affectiveStateMetric.ts`). Moving it here means any front-end --
not just the bundled React app -- gets the same four finished 0-100 scores by
calling this service over HTTP/SSE, instead of having to reimplement the
smoothing and normalization itself.

Two consumption modes are supported:

- `compute_neurofeedback_scores` + `normalize_brainflow_score` give
  instantaneous, unsmoothed scores for a single window (used by the stateless
  `/analyze-window` endpoint).
- `MindStateSmoother` adds the same slow EMA smoothing the frontend used,
  keyed per BrainFlow session (used by the `/sessions/{id}/stream` SSE feed).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Matches `vrchatStyleEmaDecay` in src/metrics/affectiveStateMetric.ts, which
# is what actually drives the smoothing shown in the app today (the
# `smoothing_alpha` field on `ProcessingConfig` is unrelated and unused for
# this purpose).
DEFAULT_SMOOTHING_ALPHA = 0.05

_NEUROFEEDBACK_NORMALIZE_SCALE = 1.1


@dataclass(frozen=True)
class NeurofeedbackScores:
    focus_score: int
    relax_score: int
    focus_signed: float
    relax_signed: float


@dataclass(frozen=True)
class MindStateScores:
    """The four finished, display-ready scores."""

    mindfulness_score: float | None
    restfulness_score: float | None
    focus_score: int
    relax_score: int


def compute_neurofeedback_scores(
    theta_power: float,
    alpha_power: float,
    beta_power: float,
) -> NeurofeedbackScores:
    """Port of `computeBrainflowsNeurofeedbackScores` (neurofeedbackRatios.ts).

    Focus rises with beta power relative to theta; relax rises with alpha
    power relative to theta.
    """
    theta = max(1e-9, theta_power)
    focus_signed = _tanh_log(beta_power / theta, _NEUROFEEDBACK_NORMALIZE_SCALE)
    relax_signed = _tanh_log(alpha_power / theta, _NEUROFEEDBACK_NORMALIZE_SCALE)

    return NeurofeedbackScores(
        focus_score=_signed_to_score(focus_signed),
        relax_score=_signed_to_score(relax_signed),
        focus_signed=focus_signed,
        relax_signed=relax_signed,
    )


def normalize_brainflow_score(value: float | None) -> float | None:
    """Port of `normalizeBrainflowMindfulness`: scales a 0-1 BrainFlow ML
    metric (mindfulness or restfulness) to a 0-100 score."""
    if value is None or not math.isfinite(value):
        return None
    return _clamp(value * 100.0, 0.0, 100.0)


def smooth_score(current: float | None, target: float, weight: float) -> float:
    """Port of `smoothScore`: exponential moving average, seeded on first call."""
    if current is None:
        return target
    return current * (1 - weight) + target * weight


class MindStateSmoother:
    """Stateful, per-session port of the smoothing in `AffectiveStateProvider`.

    Call `push` once per analyzed window; it mirrors the EMA smoothing the
    frontend applies so a session's SSE stream carries the same finished
    scores the bundled app displays, without needing any client-side logic.
    """

    def __init__(self, smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA) -> None:
        self._alpha = smoothing_alpha
        self._smoothed_mindfulness: float | None = None
        self._smoothed_restfulness: float | None = None
        self._smoothed_focus: float | None = None
        self._smoothed_relax: float | None = None

    def reset(self) -> None:
        self._smoothed_mindfulness = None
        self._smoothed_restfulness = None
        self._smoothed_focus = None
        self._smoothed_relax = None

    def push(
        self,
        *,
        theta_power: float,
        alpha_power: float,
        beta_power: float,
        raw_mindfulness: float | None,
        raw_restfulness: float | None,
    ) -> MindStateScores:
        neurofeedback = compute_neurofeedback_scores(theta_power, alpha_power, beta_power)

        raw_mindfulness_score = normalize_brainflow_score(raw_mindfulness)
        raw_restfulness_score = normalize_brainflow_score(raw_restfulness)

        self._smoothed_mindfulness = (
            None
            if raw_mindfulness_score is None
            else smooth_score(self._smoothed_mindfulness, raw_mindfulness_score, self._alpha)
        )
        self._smoothed_restfulness = (
            None
            if raw_restfulness_score is None
            else smooth_score(self._smoothed_restfulness, raw_restfulness_score, self._alpha)
        )
        self._smoothed_focus = smooth_score(
            self._smoothed_focus, float(neurofeedback.focus_score), self._alpha,
        )
        self._smoothed_relax = smooth_score(
            self._smoothed_relax, float(neurofeedback.relax_score), self._alpha,
        )

        return MindStateScores(
            mindfulness_score=(
                None
                if self._smoothed_mindfulness is None
                else round(_clamp(self._smoothed_mindfulness, 0.0, 100.0))
            ),
            restfulness_score=(
                None
                if self._smoothed_restfulness is None
                else round(_clamp(self._smoothed_restfulness, 0.0, 100.0))
            ),
            focus_score=round(_clamp(self._smoothed_focus, 0.0, 100.0)),
            relax_score=round(_clamp(self._smoothed_relax, 0.0, 100.0)),
        )


def _tanh_log(value: float, scale: float) -> float:
    if not math.isfinite(value) or value <= 0:
        return 0.0
    return math.tanh(scale * math.log(value))


def _signed_to_score(value: float) -> int:
    return round(_clamp((value + 1) * 50, 0.0, 100.0))


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))
