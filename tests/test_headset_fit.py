from __future__ import annotations

import math

from brainflow_service.headset_fit import (
    BLUETOOTH_HEADSET_FIT_THRESHOLDS,
    DEFAULT_HEADSET_FIT_THRESHOLDS,
    HeuristicHeadsetFitProvider,
    select_scalp_electrode_indices,
    to_signal_quality_metadata,
)
from brainflow_service.models import SignalChannel

FOUR_MUSE_CHANNELS = [
    SignalChannel(id="tp9", label="TP9", unit="uV", index=0),
    SignalChannel(id="af7", label="AF7", unit="uV", index=1),
    SignalChannel(id="af8", label="AF8", unit="uV", index=2),
    SignalChannel(id="tp10", label="TP10", unit="uV", index=3),
]


def _repeat_sine(*, amplitude: float, freq_hz: float, sample_rate: int, seconds: float, channels: int) -> list[list[float]]:
    count = int(sample_rate * seconds)
    return [
        [amplitude * math.sin(2 * math.pi * freq_hz * (i / sample_rate))] * channels
        for i in range(count)
    ]


def test_clean_signal_is_reported_good() -> None:
    samples = _repeat_sine(amplitude=50, freq_hz=10, sample_rate=256, seconds=1, channels=4)

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert snapshot.state == "good"
    assert snapshot.worn is True
    assert snapshot.excessive_artifact is False
    assert all(c.state == "good" for c in snapshot.channels)


def test_flat_signal_is_reported_poor() -> None:
    samples = [[0.0, 0.0, 0.0, 0.0]] * 100

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert snapshot.state == "poor"
    assert all(c.state == "poor" for c in snapshot.channels)
    assert all(c.message == "Signal is too flat" for c in snapshot.channels)


def test_clipped_signal_is_reported_poor() -> None:
    samples = [[150000.0] * 4 if i % 2 == 0 else [10.0] * 4 for i in range(100)]

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert snapshot.state == "poor"
    assert all(c.message == "Signal is clipped or saturated" for c in snapshot.channels)


def test_large_steps_are_reported_as_excessive_noise() -> None:
    samples = [[5000.0] * 4 if i % 2 == 0 else [-5000.0] * 4 for i in range(100)]

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert snapshot.state == "adjusting"
    assert all(c.message == "Excessive noise or movement" for c in snapshot.channels)
    # Steps this large also trip the overall excessive-artifact gate used to
    # decide `reliable` for the headline scores.
    assert snapshot.excessive_artifact is True


def test_moderately_unstable_signal_is_reported_adjusting() -> None:
    samples = _repeat_sine(amplitude=2000, freq_hz=1, sample_rate=256, seconds=1, channels=4)

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert snapshot.state == "adjusting"
    assert all(c.message == "Signal is unstable; check headset fit" for c in snapshot.channels)
    assert snapshot.excessive_artifact is False


def test_too_few_samples_is_reported_adjusting() -> None:
    samples = [[1.0, 2.0, 3.0, 4.0]] * 5  # fewer than min_samples_per_frame

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert all(c.state == "adjusting" for c in snapshot.channels)
    assert all(c.message == "Waiting for enough samples" for c in snapshot.channels)


def test_side_adjustment_blocker_points_at_the_worse_side() -> None:
    # tp9/af7 (left) flat, tp10/af8 (right) clean.
    samples = [
        [0.0, 0.0, 50 * math.sin(2 * math.pi * 10 * i / 256), 50 * math.sin(2 * math.pi * 10 * i / 256)]
        for i in range(256)
    ]

    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    assert "Adjust left side." in snapshot.blockers


def test_empty_channels_does_not_crash_and_is_reported_poor() -> None:
    snapshot = HeuristicHeadsetFitProvider().update(channels=[], samples=[])

    assert snapshot.state == "poor"
    assert snapshot.worn is False
    assert snapshot.channels == []


def test_stability_timer_reaches_ready_after_required_duration() -> None:
    provider = HeuristicHeadsetFitProvider()
    samples = _repeat_sine(amplitude=50, freq_hz=10, sample_rate=256, seconds=1, channels=4)

    first = provider.update(channels=FOUR_MUSE_CHANNELS, samples=samples, now_ms=0)
    assert first.state == "good"
    assert first.ready is False
    assert first.stable_for_ms == 0

    just_before = provider.update(
        channels=FOUR_MUSE_CHANNELS, samples=samples,
        now_ms=DEFAULT_HEADSET_FIT_THRESHOLDS.stable_ready_ms - 1,
    )
    assert just_before.ready is False

    at_threshold = provider.update(
        channels=FOUR_MUSE_CHANNELS, samples=samples,
        now_ms=DEFAULT_HEADSET_FIT_THRESHOLDS.stable_ready_ms,
    )
    assert at_threshold.ready is True
    assert at_threshold.state == "ready"


def test_stability_timer_resets_once_signal_becomes_unacceptable() -> None:
    provider = HeuristicHeadsetFitProvider()
    good_samples = _repeat_sine(amplitude=50, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    flat_samples = [[0.0, 0.0, 0.0, 0.0]] * 100

    provider.update(channels=FOUR_MUSE_CHANNELS, samples=good_samples, now_ms=0)
    provider.update(channels=FOUR_MUSE_CHANNELS, samples=flat_samples, now_ms=1000)
    resumed = provider.update(channels=FOUR_MUSE_CHANNELS, samples=good_samples, now_ms=2000)

    assert resumed.stable_for_ms == 0


def test_reset_clears_stability_timer() -> None:
    provider = HeuristicHeadsetFitProvider()
    samples = _repeat_sine(amplitude=50, freq_hz=10, sample_rate=256, seconds=1, channels=4)

    provider.update(channels=FOUR_MUSE_CHANNELS, samples=samples, now_ms=0)
    provider.reset()
    resumed = provider.update(channels=FOUR_MUSE_CHANNELS, samples=samples, now_ms=5000)

    assert resumed.stable_for_ms == 0


def test_to_signal_quality_metadata_round_trips_fields() -> None:
    samples = _repeat_sine(amplitude=50, freq_hz=10, sample_rate=256, seconds=1, channels=4)
    snapshot = HeuristicHeadsetFitProvider().update(channels=FOUR_MUSE_CHANNELS, samples=samples)

    metadata = to_signal_quality_metadata(snapshot)

    assert metadata.state == snapshot.state
    assert metadata.ready == snapshot.ready
    assert metadata.worn == snapshot.worn
    assert metadata.excessive_artifact == snapshot.excessive_artifact
    assert len(metadata.channels) == len(snapshot.channels)
    assert metadata.channels[0].channel.id == snapshot.channels[0].channel.id


# --- Bluetooth (Muse Athena Web Bluetooth) profile -------------------------
#
# These replay the exact per-channel stats captured live from the bundled
# app's `[fit debug]` console log (both worn and resting-on-desk, same
# headset, same session -- see the headset-fit-over-Bluetooth investigation)
# through the real `BLUETOOTH_HEADSET_FIT_THRESHOLDS`, as a regression test
# against the false-"good" bug: an unworn headset over Bluetooth used to
# read as `good`/`ready` because `DEFAULT_HEADSET_FIT_THRESHOLDS`'s ceilings
# are calibrated for BrainFlow's much larger scale for the same contact
# state.


def _synthesize_channel(std_uv: float, max_step_uv: float, n: int = 512, seed: int = 1) -> list[float]:
    """Deterministic pseudo-noise whose stdDev/maxStep land close to the
    given targets, so real captured summary stats can be replayed as a
    sample window without needing the raw per-sample capture."""
    state = seed

    def rnd() -> float:
        nonlocal state
        state = (state * 48271) % 2147483647
        return state / 2147483647

    values: list[float] = []
    v = 0.0
    for _ in range(n):
        step = (rnd() - 0.5) * 2 * max_step_uv * 0.6
        v += step * 0.15
        v = max(-3 * std_uv, min(3 * std_uv, v))
        values.append(v + (rnd() - 0.5) * std_uv * 0.3)
    return values


def _synthesize_window(stats_by_channel: list[tuple[float, float]]) -> list[list[float]]:
    columns = [_synthesize_channel(std_uv, max_step_uv, seed=index + 1) for index, (std_uv, max_step_uv) in enumerate(stats_by_channel)]
    return [list(row) for row in zip(*columns)]


BLE_WORN_STATS = [(179.1, 392.7), (10.4, 36.8), (13.7, 53.2), (71.4, 181.2)]  # tp9, af7, af8, tp10
BLE_OFF_HEAD_STATS = [(570.8, 1216.6), (575.2, 1278.3), (572.5, 1220.3), (572.8, 1219.5)]


def test_bluetooth_thresholds_pass_real_worn_capture() -> None:
    samples = _synthesize_window(BLE_WORN_STATS)

    snapshot = HeuristicHeadsetFitProvider(BLUETOOTH_HEADSET_FIT_THRESHOLDS).update(
        channels=FOUR_MUSE_CHANNELS, samples=samples,
    )

    assert snapshot.state == "good"
    assert snapshot.worn is True


def test_bluetooth_thresholds_reject_real_off_head_capture() -> None:
    samples = _synthesize_window(BLE_OFF_HEAD_STATS)

    snapshot = HeuristicHeadsetFitProvider(BLUETOOTH_HEADSET_FIT_THRESHOLDS).update(
        channels=FOUR_MUSE_CHANNELS, samples=samples,
    )

    assert snapshot.state != "good"
    assert snapshot.state != "ready"
    assert snapshot.worn is False


def test_default_thresholds_would_have_falsely_passed_the_off_head_capture() -> None:
    # Documents the actual bug this profile fixes: the same off-head data
    # that `BLUETOOTH_HEADSET_FIT_THRESHOLDS` correctly rejects above reads
    # as "good" against the BrainFlow-calibrated defaults.
    samples = _synthesize_window(BLE_OFF_HEAD_STATS)

    snapshot = HeuristicHeadsetFitProvider(DEFAULT_HEADSET_FIT_THRESHOLDS).update(
        channels=FOUR_MUSE_CHANNELS, samples=samples,
    )

    assert snapshot.state == "good"
    assert snapshot.worn is True


def test_select_scalp_electrode_indices_drops_aux_channels() -> None:
    names = ["TP9", "AF7", "AF8", "TP10", "AUX1", "AUX2", "AUX3", "AUX4"]

    assert select_scalp_electrode_indices(names) == [0, 1, 2, 3]


def test_select_scalp_electrode_indices_is_case_insensitive() -> None:
    assert select_scalp_electrode_indices(["tp9", "af7", "af8", "tp10"]) == [0, 1, 2, 3]


def test_select_scalp_electrode_indices_falls_back_to_all_when_unrecognized() -> None:
    names = ["Channel 1", "Channel 2", "Channel 3"]

    assert select_scalp_electrode_indices(names) == [0, 1, 2]
