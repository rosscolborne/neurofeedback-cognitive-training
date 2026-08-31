from __future__ import annotations

import math

from brainflow_service.affective_state import (
    AffectiveStateProvider,
    classify_affective_state,
    compute_raw_affective_sample,
    estimate_confidence,
    map_ratio_to_axis,
)


def test_map_ratio_to_axis_is_zero_for_nonpositive_or_nonfinite() -> None:
    assert map_ratio_to_axis(0) == 0.0
    assert map_ratio_to_axis(-1) == 0.0
    assert map_ratio_to_axis(float("nan")) == 0.0


def test_map_ratio_to_axis_is_bounded_and_monotonic() -> None:
    low = map_ratio_to_axis(0.5)
    high = map_ratio_to_axis(4.0)

    assert -1 <= low <= 1
    assert -1 <= high <= 1
    assert high > low


def test_classify_affective_state_reports_neutral_near_origin() -> None:
    assert classify_affective_state(0.01, -0.01) == "Neutral"


def test_classify_affective_state_matches_nearest_region() -> None:
    # Close to the "Excited" region (valence 0.32, arousal 0.78).
    assert classify_affective_state(0.3, 0.75) == "Excited"
    # Close to the "Depressed" region (valence -0.74, arousal -0.25).
    assert classify_affective_state(-0.7, -0.3) == "Depressed"


def test_estimate_confidence_is_bounded() -> None:
    assert estimate_confidence(0.0, 0.0) == 0.0
    assert 0 <= estimate_confidence(1.0, 1.0) <= 1


def test_compute_raw_affective_sample_returns_none_for_all_zero_power() -> None:
    assert compute_raw_affective_sample(0.0, 0.0, 0.0, 0.0) is None


def test_compute_raw_affective_sample_reports_valence_arousal_and_label() -> None:
    sample = compute_raw_affective_sample(theta_power=5, alpha_power=5, beta_power=5, gamma_power=5)

    assert sample is not None
    assert -1 <= sample.valence <= 1
    assert -1 <= sample.arousal <= 1
    assert isinstance(sample.label, str)


def test_provider_returns_none_when_unreliable() -> None:
    provider = AffectiveStateProvider()

    sample = provider.push(
        at_ms=0,
        theta_power=5,
        alpha_power=5,
        beta_power=5,
        gamma_power=5,
        raw_mindfulness=0.5,
        raw_restfulness=0.5,
        reliable=False,
    )

    assert sample is None


def test_provider_smooths_valence_and_arousal_across_pushes() -> None:
    provider = AffectiveStateProvider(smoothing_alpha=0.5)

    first = provider.push(
        at_ms=0, theta_power=5, alpha_power=20, beta_power=1, gamma_power=1,
        raw_mindfulness=None, raw_restfulness=None,
    )
    second = provider.push(
        at_ms=1, theta_power=20, alpha_power=1, beta_power=1, gamma_power=1,
        raw_mindfulness=None, raw_restfulness=None,
    )

    assert first is not None and second is not None
    # Second push's raw valence is much lower; smoothing should pull the
    # displayed valence down but not all the way to the new raw value yet.
    assert second.valence < first.valence
    assert second.valence != second.raw_valence


def test_provider_reports_headline_scores_alongside_valence_arousal() -> None:
    provider = AffectiveStateProvider()

    sample = provider.push(
        at_ms=0, theta_power=5, alpha_power=5, beta_power=5, gamma_power=5,
        raw_mindfulness=0.6, raw_restfulness=0.4,
    )

    assert sample is not None
    assert sample.mindfulness_score == 60
    assert sample.restfulness_score == 40
    assert 0 <= sample.focus_score <= 100
    assert 0 <= sample.relax_score <= 100
