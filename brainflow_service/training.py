"""Baseline-relative attention scoring, for the Training feature.

Python port of `HeuristicAttentionProvider` in
`src/metrics/attentionMetric.ts`. Where `affective_state.AffectiveStateProvider`
gives a live, always-on mindfulness/restfulness/focus/relax reading,
`AttentionBaselineProvider` answers a different question: "relative to this
session's own baseline, is the signal higher or lower right now?" -- the
same median/MAD z-score normalization `affective_state.py` uses for
valence/arousal calibration, from the shared `baseline.py`.

Deviation from the TS version: the original also had a `direct` display
mode (the raw mindfulness/restfulness score, no baseline at all) toggled by
`useBaselineRelativeDisplay`, defaulting to *off*. That toggle and the
less-robust "direct" path are intentionally not ported -- this module
always scores against the baseline, so there is exactly one normalization
strategy in `brainflow_service`, not two. A practical consequence: each
score is `null` until its own baseline has enough samples with real spread
to compute a z-score from (`baseline.MIN_SAMPLES_FOR_ROBUST_STATS`, 4) --
that's a brief startup window, not a persistent mode a caller can be stuck
in.

Baseline collection here starts automatically from the first pushed
window (there's no explicit start/stop the way
`AffectiveStateProvider.start_calibration()` has) and freezes once
`baseline_sample_count` windows have been collected, exactly like the TS
version.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from .baseline import (
    DEFAULT_BASELINE_SAMPLE_COUNT,
    DEFAULT_Z_SCORE_SCALE,
    BaselineCollector,
    map_z_score_to_score,
    z_score,
)
from .metrics import DEFAULT_SMOOTHING_ALPHA, compute_neurofeedback_scores, smooth_score
from .models import AttentionMetricSampleModel, CalibrationProfile

ScoreSource = Literal["brainflow_mindfulness", "unavailable"]
RestfulnessScoreSource = Literal["brainflow_restfulness", "unavailable"]


@dataclass(frozen=True)
class AttentionMetricSample:
    at_ms: float
    displayed_score: float | None
    restfulness_score: float | None
    focus_score: float | None
    relax_score: float | None
    theta_power: float
    alpha_power: float
    beta_power: float
    raw_ratio: float
    baseline_ratio: float | None
    raw_brainflow_mindfulness: float | None
    baseline_brainflow_mindfulness: float | None
    baseline_relative_value: float | None
    baseline_z_score: float | None
    raw_brainflow_restfulness: float | None
    baseline_brainflow_restfulness: float | None
    restfulness_baseline_relative_value: float | None
    restfulness_baseline_z_score: float | None
    score_source: ScoreSource
    restfulness_score_source: RestfulnessScoreSource
    reliable: bool


@dataclass(frozen=True)
class AttentionCalibrationProfile:
    id: str
    algorithm_version: str
    created_at_ms: float
    baseline_ratio: float | None
    baseline_brainflow_mindfulness: float | None
    baseline_ratio_spread: float | None
    baseline_brainflow_mindfulness_spread: float | None
    baseline_brainflow_restfulness: float | None
    baseline_brainflow_restfulness_spread: float | None
    accepted_windows: int
    rejected_windows: int
    rejection_reasons: dict[str, int]


def to_attention_metric_sample_model(sample: AttentionMetricSample) -> AttentionMetricSampleModel:
    return AttentionMetricSampleModel(
        displayedScore=sample.displayed_score,
        restfulnessScore=sample.restfulness_score,
        focusScore=sample.focus_score,
        relaxScore=sample.relax_score,
        rawRatio=sample.raw_ratio,
        baselineRatio=sample.baseline_ratio,
        rawBrainflowMindfulness=sample.raw_brainflow_mindfulness,
        baselineBrainflowMindfulness=sample.baseline_brainflow_mindfulness,
        baselineRelativeValue=sample.baseline_relative_value,
        baselineZScore=sample.baseline_z_score,
        rawBrainflowRestfulness=sample.raw_brainflow_restfulness,
        baselineBrainflowRestfulness=sample.baseline_brainflow_restfulness,
        restfulnessBaselineRelativeValue=sample.restfulness_baseline_relative_value,
        restfulnessBaselineZScore=sample.restfulness_baseline_z_score,
        scoreSource=sample.score_source,
        restfulnessScoreSource=sample.restfulness_score_source,
    )


def to_calibration_profile_model(profile: AttentionCalibrationProfile) -> CalibrationProfile:
    return CalibrationProfile(
        id=profile.id,
        algorithmVersion=profile.algorithm_version,
        createdAtMs=profile.created_at_ms,
        baselineRatio=profile.baseline_ratio,
        baselineRatioSpread=profile.baseline_ratio_spread,
        baselineBrainflowMindfulness=profile.baseline_brainflow_mindfulness,
        baselineBrainflowMindfulnessSpread=profile.baseline_brainflow_mindfulness_spread,
        baselineBrainflowRestfulness=profile.baseline_brainflow_restfulness,
        baselineBrainflowRestfulnessSpread=profile.baseline_brainflow_restfulness_spread,
        acceptedWindows=profile.accepted_windows,
        rejectedWindows=profile.rejected_windows,
        rejectionReasons=profile.rejection_reasons,
    )


class AttentionBaselineProvider:
    """Stateful, per-session port of `HeuristicAttentionProvider`."""

    def __init__(
        self,
        smoothing_alpha: float = DEFAULT_SMOOTHING_ALPHA,
        baseline_sample_count: int = DEFAULT_BASELINE_SAMPLE_COUNT,
        z_score_scale: float = DEFAULT_Z_SCORE_SCALE,
    ) -> None:
        self._alpha = smoothing_alpha
        self._z_score_scale = z_score_scale
        self._ratio_baseline = BaselineCollector(baseline_sample_count)
        self._mindfulness_baseline = BaselineCollector(baseline_sample_count)
        self._restfulness_baseline = BaselineCollector(baseline_sample_count)
        self._focus_baseline = BaselineCollector(baseline_sample_count)
        self._relax_baseline = BaselineCollector(baseline_sample_count)
        self._smoothed_score: float | None = None
        self._smoothed_restfulness_score: float | None = None
        self._smoothed_focus_score: float | None = None
        self._smoothed_relax_score: float | None = None
        self._calibration_profile: AttentionCalibrationProfile | None = None
        self._rejected_windows = 0
        self._rejection_reasons: dict[str, int] = {}

    def reset(self) -> None:
        for baseline in self._baselines():
            baseline.reset()
        self._smoothed_score = None
        self._smoothed_restfulness_score = None
        self._smoothed_focus_score = None
        self._smoothed_relax_score = None
        self._calibration_profile = None
        self._rejected_windows = 0
        self._rejection_reasons = {}

    def get_calibration_profile(self) -> AttentionCalibrationProfile | None:
        return self._calibration_profile

    def push(
        self,
        *,
        at_ms: float,
        theta_power: float,
        alpha_power: float,
        beta_power: float,
        raw_mindfulness: float | None,
        raw_restfulness: float | None,
        reliable: bool = True,
    ) -> AttentionMetricSample | None:
        if not reliable:
            self._reject_window("poor_quality")
            return None

        neurofeedback = compute_neurofeedback_scores(theta_power, alpha_power, beta_power)
        raw_ratio = beta_power / max(1e-9, alpha_power + theta_power)

        self._ratio_baseline.accept(raw_ratio)
        if raw_mindfulness is not None:
            self._mindfulness_baseline.accept(raw_mindfulness)
        if raw_restfulness is not None:
            self._restfulness_baseline.accept(raw_restfulness)
        self._focus_baseline.accept(neurofeedback.focus_signed)
        self._relax_baseline.accept(neurofeedback.relax_signed)

        baseline_ratio = self._ratio_baseline.median()
        baseline_mindfulness = self._mindfulness_baseline.median()
        baseline_restfulness = self._restfulness_baseline.median()
        mindfulness_stats = self._mindfulness_baseline.stats()
        restfulness_stats = self._restfulness_baseline.stats()

        baseline_relative_value = (
            raw_mindfulness / baseline_mindfulness
            if raw_mindfulness is not None and baseline_mindfulness
            else None
        )
        baseline_z = z_score(raw_mindfulness, mindfulness_stats)
        restfulness_baseline_relative_value = (
            raw_restfulness / baseline_restfulness
            if raw_restfulness is not None and baseline_restfulness
            else None
        )
        restfulness_baseline_z = z_score(raw_restfulness, restfulness_stats)
        focus_z = z_score(neurofeedback.focus_signed, self._focus_baseline.stats())
        relax_z = z_score(neurofeedback.relax_signed, self._relax_baseline.stats())

        display_score = map_z_score_to_score(baseline_z, self._z_score_scale)
        restfulness_display_score = map_z_score_to_score(restfulness_baseline_z, self._z_score_scale)
        focus_target = map_z_score_to_score(focus_z, self._z_score_scale)
        relax_target = map_z_score_to_score(relax_z, self._z_score_scale)

        if self._ratio_baseline.is_full and self._calibration_profile is None:
            ratio_stats = self._ratio_baseline.stats()
            self._calibration_profile = AttentionCalibrationProfile(
                id=str(uuid.uuid4()),
                algorithm_version="median_mad_zscore_v1",
                created_at_ms=at_ms,
                baseline_ratio=baseline_ratio,
                baseline_brainflow_mindfulness=baseline_mindfulness,
                baseline_ratio_spread=ratio_stats.spread if ratio_stats else None,
                baseline_brainflow_mindfulness_spread=mindfulness_stats.spread if mindfulness_stats else None,
                baseline_brainflow_restfulness=baseline_restfulness,
                baseline_brainflow_restfulness_spread=restfulness_stats.spread if restfulness_stats else None,
                accepted_windows=self._ratio_baseline.collected,
                rejected_windows=self._rejected_windows,
                rejection_reasons=dict(self._rejection_reasons),
            )

        if display_score is None:
            self._reject_window("missing_baseline")

        self._smoothed_score = (
            None if display_score is None else smooth_score(self._smoothed_score, display_score, self._alpha)
        )
        self._smoothed_restfulness_score = (
            None
            if restfulness_display_score is None
            else smooth_score(self._smoothed_restfulness_score, restfulness_display_score, self._alpha)
        )
        self._smoothed_focus_score = (
            None if focus_target is None else smooth_score(self._smoothed_focus_score, focus_target, self._alpha)
        )
        self._smoothed_relax_score = (
            None if relax_target is None else smooth_score(self._smoothed_relax_score, relax_target, self._alpha)
        )

        return AttentionMetricSample(
            at_ms=at_ms,
            displayed_score=_round_clamped(self._smoothed_score),
            restfulness_score=_round_clamped(self._smoothed_restfulness_score),
            focus_score=_round_clamped(self._smoothed_focus_score),
            relax_score=_round_clamped(self._smoothed_relax_score),
            theta_power=theta_power,
            alpha_power=alpha_power,
            beta_power=beta_power,
            raw_ratio=raw_ratio,
            baseline_ratio=baseline_ratio,
            raw_brainflow_mindfulness=raw_mindfulness,
            baseline_brainflow_mindfulness=baseline_mindfulness,
            baseline_relative_value=baseline_relative_value,
            baseline_z_score=baseline_z,
            raw_brainflow_restfulness=raw_restfulness,
            baseline_brainflow_restfulness=baseline_restfulness,
            restfulness_baseline_relative_value=restfulness_baseline_relative_value,
            restfulness_baseline_z_score=restfulness_baseline_z,
            score_source="brainflow_mindfulness" if raw_mindfulness is not None else "unavailable",
            restfulness_score_source="brainflow_restfulness" if raw_restfulness is not None else "unavailable",
            reliable=reliable,
        )

    def _baselines(self) -> tuple[BaselineCollector, ...]:
        return (
            self._ratio_baseline,
            self._mindfulness_baseline,
            self._restfulness_baseline,
            self._focus_baseline,
            self._relax_baseline,
        )

    def _reject_window(self, reason: str) -> None:
        self._rejected_windows += 1
        self._rejection_reasons[reason] = self._rejection_reasons.get(reason, 0) + 1


def _round_clamped(value: float | None) -> float | None:
    if value is None:
        return None
    return round(min(100.0, max(0.0, value)))
