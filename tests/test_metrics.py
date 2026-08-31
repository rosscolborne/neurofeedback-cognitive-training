from brainflow_service.metrics import BrainFlowScoreSmoother, MetricCalculator, MetricInput, compute_band_ratios, compute_protocol_feedback, normalize_brainflow_score, smooth_ema


def test_band_derived_ratios_use_smoothed_bands() -> None:
    calculator = MetricCalculator(smoothing_alpha=.5)
    calculator.push(MetricInput({"theta": 8, "alpha": 4, "smr": 4, "beta": 4, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    snapshot = calculator.push(MetricInput({"theta": 4, "alpha": 8, "smr": 8, "beta": 8, "gamma": 1}, None, None, None, "theta-beta-ratio", 1.85, True))
    assert snapshot.absolute_bands["theta"] == 6
    assert snapshot.absolute_bands["beta"] == 6
    assert snapshot.ratios["thetaBeta"] == 1
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


def test_protocol_feedback_names_the_actual_metric() -> None:
    bands = {"theta": 8, "alpha": 5, "smr": 7, "beta": 4}
    feedback = compute_protocol_feedback(bands, compute_band_ratios(bands), "smr-enhancement", 6)
    assert feedback.metric_name == "smr" and feedback.value == 7 and feedback.in_zone


def test_normalize_and_ema_helpers() -> None:
    assert normalize_brainflow_score(.5) == 50
    assert normalize_brainflow_score(None) is None
    assert smooth_ema(80, 0, .5) == 40


def test_calibration_makes_selected_display_metrics_relative_to_their_own_baselines() -> None:
    calculator = MetricCalculator()
    baseline = MetricInput({"theta": 4, "alpha": 6, "smr": 3, "beta": 2, "gamma": 1}, .5, .4, .6, "theta-beta-ratio", 1.85, True)
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
