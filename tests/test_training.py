from __future__ import annotations

from brainflow_service.training import AttentionBaselineProvider


def _push_baseline(provider: AttentionBaselineProvider, count: int, *, mindfulness=0.5, restfulness=0.5):
    sample = None
    for i in range(count):
        sample = provider.push(
            at_ms=i,
            theta_power=5,
            alpha_power=10 + (i % 2) * 0.5,
            beta_power=3 + (i % 3) * 0.2,
            raw_mindfulness=mindfulness + (i % 2) * 0.01,
            raw_restfulness=restfulness + (i % 2) * 0.01,
        )
    return sample


def test_scores_are_none_before_baseline_has_enough_samples() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=24)

    sample = provider.push(
        at_ms=0, theta_power=5, alpha_power=10, beta_power=3,
        raw_mindfulness=0.5, raw_restfulness=0.5,
    )

    assert sample is not None
    assert sample.displayed_score is None
    assert sample.restfulness_score is None
    assert sample.focus_score is None
    assert sample.relax_score is None


def test_scores_become_available_once_baseline_has_real_spread() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)

    sample = _push_baseline(provider, 4)

    assert sample is not None
    assert sample.displayed_score is not None
    assert 0 <= sample.displayed_score <= 100
    assert sample.restfulness_score is not None
    assert sample.focus_score is not None
    assert sample.relax_score is not None


def test_unreliable_window_is_rejected_and_returns_none() -> None:
    provider = AttentionBaselineProvider()

    sample = provider.push(
        at_ms=0, theta_power=5, alpha_power=10, beta_power=3,
        raw_mindfulness=0.5, raw_restfulness=0.5, reliable=False,
    )

    assert sample is None


def test_baseline_freezes_once_full() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)
    _push_baseline(provider, 4)
    ratio_after_baseline = provider._ratio_baseline.collected

    # Push well past the baseline sample count.
    _push_baseline(provider, 20)

    assert provider._ratio_baseline.collected == ratio_after_baseline == 4


def test_calibration_profile_locks_in_once_baseline_fills() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)

    assert provider.get_calibration_profile() is None

    _push_baseline(provider, 4)

    profile = provider.get_calibration_profile()
    assert profile is not None
    assert profile.algorithm_version == "median_mad_zscore_v1"
    assert profile.accepted_windows == 4


def test_calibration_profile_does_not_get_overwritten_after_locking_in() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)
    _push_baseline(provider, 4)
    first_profile = provider.get_calibration_profile()

    _push_baseline(provider, 20)

    assert provider.get_calibration_profile().id == first_profile.id


def test_score_source_reflects_whether_raw_metric_was_available() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)

    sample = _push_baseline(provider, 4, mindfulness=0.5, restfulness=0.5)
    assert sample.score_source == "brainflow_mindfulness"
    assert sample.restfulness_score_source == "brainflow_restfulness"

    provider2 = AttentionBaselineProvider(baseline_sample_count=4)
    sample2 = None
    for i in range(4):
        sample2 = provider2.push(
            at_ms=i, theta_power=5, alpha_power=10 + (i % 2) * 0.5, beta_power=3,
            raw_mindfulness=None, raw_restfulness=None,
        )
    assert sample2.score_source == "unavailable"
    assert sample2.restfulness_score_source == "unavailable"
    assert sample2.displayed_score is None
    assert sample2.restfulness_score is None


def test_reset_clears_baseline_and_calibration_profile() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=4)
    _push_baseline(provider, 4)
    assert provider.get_calibration_profile() is not None

    provider.reset()

    assert provider.get_calibration_profile() is None
    assert provider._ratio_baseline.collected == 0


def test_score_rises_with_relative_beta_power_once_baselined() -> None:
    provider = AttentionBaselineProvider(baseline_sample_count=6)
    for i in range(6):
        provider.push(
            at_ms=i, theta_power=5, alpha_power=10, beta_power=3 + (i % 2) * 0.3,
            raw_mindfulness=0.5, raw_restfulness=0.5,
        )

    low_focus = provider.push(
        at_ms=100, theta_power=5, alpha_power=10, beta_power=1,
        raw_mindfulness=0.5, raw_restfulness=0.5,
    )
    high_focus = provider.push(
        at_ms=101, theta_power=5, alpha_power=10, beta_power=20,
        raw_mindfulness=0.5, raw_restfulness=0.5,
    )

    assert high_focus.focus_score > low_focus.focus_score
