from __future__ import annotations

from brainflow_service.metrics import (
    MindStateSmoother,
    compute_neurofeedback_scores,
    normalize_brainflow_score,
    smooth_score,
)


def test_focus_rises_with_relative_beta_power() -> None:
    low_beta = compute_neurofeedback_scores(theta_power=10, alpha_power=10, beta_power=2)
    high_beta = compute_neurofeedback_scores(theta_power=10, alpha_power=10, beta_power=20)

    assert high_beta.focus_score > low_beta.focus_score


def test_relax_rises_with_relative_alpha_power() -> None:
    low_alpha = compute_neurofeedback_scores(theta_power=10, alpha_power=2, beta_power=10)
    high_alpha = compute_neurofeedback_scores(theta_power=10, alpha_power=20, beta_power=10)

    assert high_alpha.relax_score > low_alpha.relax_score


def test_neurofeedback_scores_are_bounded() -> None:
    scores = compute_neurofeedback_scores(theta_power=1e-9, alpha_power=1e6, beta_power=1e6)

    assert 0 <= scores.focus_score <= 100
    assert 0 <= scores.relax_score <= 100


def test_normalize_brainflow_score_scales_and_clamps() -> None:
    assert normalize_brainflow_score(0.5) == 50.0
    assert normalize_brainflow_score(1.5) == 100.0
    assert normalize_brainflow_score(-0.5) == 0.0


def test_normalize_brainflow_score_passes_through_missing_values() -> None:
    assert normalize_brainflow_score(None) is None
    assert normalize_brainflow_score(float("nan")) is None


def test_smooth_score_seeds_on_first_call_then_averages() -> None:
    first = smooth_score(None, 80.0, weight=0.05)
    second = smooth_score(first, 0.0, weight=0.05)

    assert first == 80.0
    assert 0.0 < second < 80.0


def test_mind_state_smoother_reports_null_scores_when_brainflow_metrics_missing() -> None:
    smoother = MindStateSmoother()

    scores = smoother.push(
        theta_power=5,
        alpha_power=5,
        beta_power=5,
        raw_mindfulness=None,
        raw_restfulness=None,
    )

    assert scores.mindfulness_score is None
    assert scores.restfulness_score is None
    assert 0 <= scores.focus_score <= 100
    assert 0 <= scores.relax_score <= 100


def test_mind_state_smoother_reports_scores_once_brainflow_metrics_present() -> None:
    smoother = MindStateSmoother()

    scores = smoother.push(
        theta_power=5,
        alpha_power=5,
        beta_power=5,
        raw_mindfulness=0.7,
        raw_restfulness=0.3,
    )

    assert scores.mindfulness_score == 70
    assert scores.restfulness_score == 30


def test_mind_state_smoother_smooths_across_pushes() -> None:
    smoother = MindStateSmoother(smoothing_alpha=0.5)

    first = smoother.push(
        theta_power=5, alpha_power=5, beta_power=5, raw_mindfulness=1.0, raw_restfulness=1.0,
    )
    second = smoother.push(
        theta_power=5, alpha_power=5, beta_power=5, raw_mindfulness=0.0, raw_restfulness=0.0,
    )

    assert first.mindfulness_score == 100
    assert 0 < second.mindfulness_score < 100


def test_mind_state_smoother_reset_clears_smoothing_state() -> None:
    smoother = MindStateSmoother(smoothing_alpha=0.5)
    smoother.push(theta_power=5, alpha_power=5, beta_power=5, raw_mindfulness=1.0, raw_restfulness=1.0)

    smoother.reset()
    scores = smoother.push(
        theta_power=5, alpha_power=5, beta_power=5, raw_mindfulness=0.2, raw_restfulness=0.2,
    )

    assert scores.mindfulness_score == 20
