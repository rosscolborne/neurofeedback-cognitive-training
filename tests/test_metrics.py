from brainflow_service.affective_state import compute_affective_state
from brainflow_service.dsp import calculate_peak_band_amplitude_uv, calculate_spectral_power_ratio
from brainflow_service.metrics import BrainFlowScoreSmoother, MetricCalculator, MetricInput, compute_band_ratios, compute_protocol_feedback, normalize_brainflow_score, smooth_ema
import numpy as np
import pytest


def test_derived_metrics_use_independent_output_smoothing() -> None:
    calculator = MetricCalculator(smoothing_alpha=.5)
    calculator.push(MetricInput({"theta": 8, "alpha": 4, "smr": 4, "beta": 4, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    snapshot = calculator.push(MetricInput({"theta": 4, "alpha": 8, "smr": 8, "beta": 8, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    assert snapshot.absolute_bands["theta"] == 6
    assert snapshot.absolute_bands["beta"] == 6
    # Raw ratios are 2.0 then 0.5, so the output EMA is 1.25. This must not
    # be recomputed from the separately-smoothed theta and beta values (1.0).
    assert snapshot.ratios["thetaBeta"] == 1.25
    assert sum(snapshot.relative_bands.values()) == 1


def test_every_named_ratio_is_available() -> None:
    ratios = compute_band_ratios({"theta": 2, "alpha": 4, "smr": 3, "beta": 8, "gamma": 1})
    assert {"thetaBeta", "betaTheta", "alphaTheta", "thetaAlpha", "smrTheta", "thetaAlphaBeta", "alphaBeta", "betaAlpha", "arousal", "valence"} <= ratios.keys()


def test_brainflow_scores_are_output_smoothed_and_resettable() -> None:
    smoother = BrainFlowScoreSmoother(.5)
    assert smoother.push(1, 1).mindfulness_score == 100
    assert smoother.push(0, 0).mindfulness_score == 50
    smoother.reset()
    assert smoother.push(.2, .2).mindfulness_score == 20


def test_affective_outputs_and_coherence_use_independent_output_smoothing() -> None:
    calculator = MetricCalculator(smoothing_alpha=.5)
    first_bands = {"theta": 4, "alpha": 8, "smr": 4, "beta": 4, "gamma": 4}
    second_bands = {"theta": 4, "alpha": 4, "smr": 4, "beta": 8, "gamma": 8}
    calculator.push(MetricInput(first_bands, .2, None, None, "theta-beta-ratio", 1.85, True))
    snapshot = calculator.push(MetricInput(second_bands, .6, None, None, "theta-beta-ratio", 1.85, True))

    first_affective = compute_affective_state(first_bands)
    second_affective = compute_affective_state(second_bands)
    assert first_affective is not None and second_affective is not None
    assert snapshot.affective_state is not None
    assert snapshot.interhemispheric_coherence == .4
    assert snapshot.affective_state.valence == (first_affective.valence + second_affective.valence) / 2
    assert snapshot.affective_state.arousal == (first_affective.arousal + second_affective.arousal) / 2


def test_protocol_feedback_names_the_actual_metric() -> None:
    bands = {"theta": 8, "alpha": 5, "smr": 7, "beta": 4}
    feedback = compute_protocol_feedback(bands, compute_band_ratios(bands), "smr-enhancement", 6, reward_amplitude_uv=7)
    assert feedback.metric_name == "smrAmplitudeUv" and feedback.value == 7 and feedback.in_zone
    assert compute_protocol_feedback(bands, compute_band_ratios(bands), "smr-enhancement", 6).in_zone is None


def test_default_beta_feedback_is_at_or_below_threshold() -> None:
    for beta, in_zone in [(13.9, True), (14.0, True), (14.1, False)]:
        bands = {"theta": 4, "alpha": 8, "smr": 6, "beta": beta}
        feedback = compute_protocol_feedback(bands, compute_band_ratios(bands), "beta-downtraining", 14, beta)
        assert feedback.metric_name == "betaAmplitudeUv" and feedback.value == beta and feedback.in_zone is in_zone
    assert compute_protocol_feedback(bands, compute_band_ratios(bands), "beta-downtraining", 14).in_zone is None


def test_beta_spectral_amplitude_comes_from_raw_microvolt_samples() -> None:
    samples = np.arange(512) / 256
    beta = 12 * np.sin(2 * np.pi * 17 * samples)
    alpha = 30 * np.sin(2 * np.pi * 10 * samples)
    window = np.tile(beta + alpha, (4, 1))
    assert calculate_peak_band_amplitude_uv(window, 256, 13, 30) == pytest.approx(12, abs=.1)
    assert calculate_peak_band_amplitude_uv(window, 256, 20, 30) < 1


def test_ratio_reward_uses_selected_spectral_power_bands() -> None:
    samples = np.arange(512) / 256
    window = np.tile(
        4 * np.sin(2 * np.pi * 6 * samples)
        + 12 * np.sin(2 * np.pi * 10 * samples)
        + 8 * np.sin(2 * np.pi * 17 * samples), (4, 1),
    )
    default = calculate_spectral_power_ratio(window, 256, (4, 8), (13, 30))
    changed = calculate_spectral_power_ratio(window, 256, (9, 11), (13, 30))
    assert default == pytest.approx(.25, abs=.03)
    assert changed == pytest.approx(2.25, abs=.1)
    bands = {"theta": 99, "alpha": 1, "beta": 1}
    ratios = compute_band_ratios(bands)
    assert compute_protocol_feedback(bands, ratios, "theta-beta-ratio", 1.85, reward_power_ratio=default).in_zone
    assert not compute_protocol_feedback(bands, ratios, "theta-beta-ratio", 1.85, reward_power_ratio=changed).in_zone
    assert compute_protocol_feedback(bands, ratios, "theta-beta-ratio", 1.85).in_zone is None


def test_single_band_feedback_uses_amplitude_not_welch_power() -> None:
    bands = {"theta": 1, "alpha": 100, "smr": 100, "beta": 1}
    ratios = compute_band_ratios(bands)
    for protocol, threshold in [("alpha-enhancement", 11), ("smr-enhancement", 7.5)]:
        assert not compute_protocol_feedback(bands, ratios, protocol, threshold, reward_amplitude_uv=threshold - .1).in_zone
        assert compute_protocol_feedback(bands, ratios, protocol, threshold, reward_amplitude_uv=threshold + .1).in_zone
        assert compute_protocol_feedback(bands, ratios, protocol, threshold).in_zone is None


@pytest.mark.parametrize("protocol,kind", [
    ("theta-beta-ratio", "ratio"),
    ("alpha-theta-crossover", "ratio"),
    ("smr-enhancement", "amplitude"),
    ("alpha-enhancement", "amplitude"),
    ("beta-downtraining", "amplitude"),
])
def test_every_backend_protocol_honors_clinician_condition(protocol: str, kind: str) -> None:
    kwargs = {"reward_kind": kind, "reward_condition": "above",
              "reward_power_ratio": 2.0 if kind == "ratio" else None,
              "reward_amplitude_uv": 12.0 if kind == "amplitude" else None}
    assert compute_protocol_feedback({}, {}, protocol, 10 if kind == "amplitude" else 1.5, **kwargs).in_zone
    kwargs["reward_condition"] = "below"
    assert not compute_protocol_feedback({}, {}, protocol, 10 if kind == "amplitude" else 1.5, **kwargs).in_zone


def test_normalize_and_ema_helpers() -> None:
    assert normalize_brainflow_score(.5) == 50
    assert normalize_brainflow_score(None) is None
    assert smooth_ema(80, 0, .5) == 40


def test_calibration_makes_selected_display_metrics_relative_to_their_own_baselines() -> None:
    calculator = MetricCalculator()
    baseline = MetricInput({"theta": 4, "alpha": 6, "smr": 3, "beta": 2, "gamma": 1}, .5, .4, .6, "theta-beta-ratio", 1.85, True, reward_power_ratio=2)
    calculator.start_calibration({"thetaBeta"})
    for _ in range(24):
        snapshot = calculator.push(baseline)
    assert snapshot.calibration_status == "active"
    assert snapshot.ratios["thetaBeta"] == 50
    # A selected calibration changes only that metric; other values remain raw.
    assert snapshot.brainflow_scores.mindfulness_score == 40
    # Protocol feedback remains in absolute units so its training target does
    # not move when the display is calibrated.
    assert snapshot.protocol_feedback.value is not None and snapshot.protocol_feedback.value > 0
    calculator.reset_calibration()
    snapshot = calculator.push(baseline)
    assert snapshot.calibration_status == "off"
    assert snapshot.ratios["thetaBeta"] > 0


def test_calibration_uses_a_normal_distribution_percentile() -> None:
    calculator = MetricCalculator(smoothing_alpha=1)
    calculator.start_calibration({"thetaBeta"})
    for theta in range(1, 25):
        calculator.push(MetricInput({"theta": theta, "beta": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    snapshot = calculator.push(MetricInput({"theta": 30, "beta": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    # A value well above calibration maps above the distribution midpoint.
    assert 50 < snapshot.ratios["thetaBeta"] < 100
