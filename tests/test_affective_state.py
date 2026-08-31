from brainflow_service.affective_state import classify_affective_state, compute_affective_state, map_ratio_to_axis


def test_map_ratio_to_axis_is_bounded_and_monotonic() -> None:
    assert map_ratio_to_axis(0) == 0
    assert -1 <= map_ratio_to_axis(.5) < map_ratio_to_axis(4) <= 1


def test_affective_state_is_pure_band_derived_result() -> None:
    state = compute_affective_state({"theta": 5, "alpha": 5, "beta": 5, "gamma": 5})
    assert state is not None
    assert -1 <= state.valence <= 1 and -1 <= state.arousal <= 1


def test_classification() -> None:
    assert classify_affective_state(.01, -.01) == "Neutral"
    assert classify_affective_state(.3, .75) == "Excited"
