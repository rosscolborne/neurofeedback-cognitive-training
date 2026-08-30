from __future__ import annotations

from brainflow_service.baseline import (
    BaselineCollector,
    compute_robust_stats,
    map_z_score_to_score,
    median,
    z_score,
)


def test_median_odd_and_even_length() -> None:
    assert median([3.0, 1.0, 2.0]) == 2.0
    assert median([1.0, 2.0, 3.0, 4.0]) == 2.5


def test_compute_robust_stats_returns_none_below_minimum_samples() -> None:
    assert compute_robust_stats([1.0, 2.0, 3.0]) is None


def test_compute_robust_stats_returns_none_for_zero_spread() -> None:
    assert compute_robust_stats([5.0, 5.0, 5.0, 5.0]) is None


def test_compute_robust_stats_center_is_the_median() -> None:
    stats = compute_robust_stats([1.0, 2.0, 3.0, 100.0])

    assert stats is not None
    assert stats.center == 2.5  # median, not skewed by the 100.0 outlier


def test_compute_robust_stats_spread_is_positive_and_finite() -> None:
    stats = compute_robust_stats([1.0, 2.0, 3.0, 4.0, 5.0])

    assert stats is not None
    assert stats.spread > 0


def test_z_score_is_zero_at_the_center() -> None:
    stats = compute_robust_stats([1.0, 2.0, 3.0, 4.0])
    assert stats is not None

    assert z_score(stats.center, stats) == 0.0


def test_z_score_is_none_for_missing_value_or_stats() -> None:
    stats = compute_robust_stats([1.0, 2.0, 3.0, 4.0])

    assert z_score(None, stats) is None
    assert z_score(5.0, None) is None


def test_map_z_score_to_score_centers_at_fifty_and_is_bounded() -> None:
    assert map_z_score_to_score(0.0) == 50.0
    assert 50 < map_z_score_to_score(2.0) < 100
    assert 0 < map_z_score_to_score(-2.0) < 50
    assert map_z_score_to_score(None) is None


def test_map_z_score_to_score_saturates_without_exceeding_bounds() -> None:
    assert map_z_score_to_score(1000.0) < 100
    assert map_z_score_to_score(-1000.0) > 0


def test_baseline_collector_caps_at_sample_count() -> None:
    collector = BaselineCollector(sample_count=3)
    for value in [1.0, 2.0, 3.0, 4.0, 5.0]:
        collector.accept(value)

    assert collector.collected == 3
    assert collector.is_full is True
    assert collector.median() == 2.0  # only the first 3 values were kept


def test_baseline_collector_reset_clears_collected_values() -> None:
    collector = BaselineCollector(sample_count=3)
    collector.accept(1.0)
    collector.accept(2.0)

    collector.reset()

    assert collector.collected == 0
    assert collector.median() is None
    assert collector.stats() is None


def test_baseline_collector_stats_matches_compute_robust_stats() -> None:
    values = [1.0, 2.0, 3.0, 4.0]
    collector = BaselineCollector(sample_count=4)
    for value in values:
        collector.accept(value)

    assert collector.stats() == compute_robust_stats(values)
