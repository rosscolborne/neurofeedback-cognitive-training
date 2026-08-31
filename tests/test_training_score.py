from __future__ import annotations

from brainflow_service.training import BASELINE_WINDOW_COUNT, TrainingScoreProvider


def test_training_score_uses_first_24_reliable_mindfulness_windows_as_its_baseline() -> None:
    provider = TrainingScoreProvider()

    for index in range(BASELINE_WINDOW_COUNT - 1):
        sample = provider.push(40.0 + index, reliable=True)
        assert sample.score is None
        assert sample.baseline_ready is False

    baseline_sample = provider.push(63.0, reliable=True)
    assert baseline_sample.baseline_ready is True
    assert baseline_sample.score is not None

    above_baseline = provider.push(90.0, reliable=True)
    assert above_baseline.baseline_ready is True
    assert above_baseline.score is not None
    assert above_baseline.score > baseline_sample.score


def test_training_score_does_not_use_unreliable_windows_for_its_baseline() -> None:
    provider = TrainingScoreProvider()

    for _ in range(BASELINE_WINDOW_COUNT):
        provider.push(60.0, reliable=False)

    assert provider.push(60.0, reliable=True).baseline_ready is False
