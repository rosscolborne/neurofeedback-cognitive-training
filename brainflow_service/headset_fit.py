"""Headset fit / signal quality inference.

Python port of `src/signalQuality/headsetFitProvider.ts` and
`headsetFitConfig.ts`. Infers per-channel and overall signal quality from
raw EEG sample statistics (RMS, variance, step size, clipping) -- the same
heuristics the bundled React app uses to decide when a headset is worn well
enough to trust its readings, and what closes the gap noted in
`affective_state.py`: sessions now gate their scores on a real, server-side
quality signal instead of always assuming `reliable=True`.

Two deviations from the TS version, both because they're concepts specific
to a browser polling a live connection rather than a request/response or
per-session-stream service:

- No `connectionState`/`deviceInfo` handling or stale-frame detection --
  every call here is given a frame the caller just captured, so it's
  always fresh and "connected" by construction. The TS `"not_detected"`/
  `"not_worn"` states (used only for a missing/stale connection) don't
  apply; the reachable states here are `"poor"`, `"adjusting"`, `"good"`,
  `"ready"`.
- No device-reported per-channel quality metadata -- BrainFlow doesn't
  supply this, so all channels are always heuristically inferred from
  their raw sample statistics.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, replace
from typing import Literal

from .models import ChannelSignalQualityModel, SignalChannel, SignalQualityMetadata

HeadsetFitState = Literal["poor", "adjusting", "good", "ready"]
ChannelFitState = Literal["poor", "adjusting", "good"]


@dataclass(frozen=True)
class HeadsetFitThresholds:
    stable_ready_ms: float = 3500
    min_samples_per_frame: int = 16
    min_good_channels: int = 2
    min_good_channel_fraction: float = 0.5
    max_poor_channel_fraction: float = 0.5
    min_rms_uv: float = 0.35
    max_rms_uv: float = 20000
    min_std_dev_uv: float = 0.25
    max_good_std_dev_uv: float = 1200
    max_good_peak_to_peak_uv: float = 3600
    max_good_mean_step_uv: float = 1500
    max_good_step_uv: float = 3800
    max_absolute_uv: float = 100000
    max_step_uv: float = 6500
    max_clipped_fraction: float = 0.3


DEFAULT_HEADSET_FIT_THRESHOLDS = HeadsetFitThresholds()


# Thresholds for EEG captured by the Elata Web Bluetooth SDK's Athena WASM
# decoder (as opposed to BrainFlow's own board driver, which
# `DEFAULT_HEADSET_FIT_THRESHOLDS` is tuned against).
#
# That decoder reports EEG in different absolute units than BrainFlow does
# for the exact same physical electrode and contact state -- paired
# on-device measurements (worn vs. resting unworn, same headset, same
# session) came out roughly 4-7x smaller on this path across every channel:
#
#              worn (good)         resting on desk (not worn)
#   std_dev_uv    10 - 179 uV          570 - 575 uV
#   max_step_uv   37 - 393 uV         1217 - 1278 uV
#   peak_to_peak_uv 33 - 502 uV        1450 uV
#
# `DEFAULT_HEADSET_FIT_THRESHOLDS`'s `max_good_*` ceilings never trip at
# this scale -- a resting, unworn headset's noise floor here still reads
# as "good" against them. These ceilings instead sit at the midpoint of
# the measured worn/unworn gap above, so they clear real worn contact
# (including the noisier rear TP9/TP10 channels) with margin while still
# catching the unworn case. `max_good_mean_step_uv` wasn't directly
# measured -- it's scaled down by the same ratio as the others for
# consistency, and is redundant with `max_good_std_dev_uv`/
# `max_good_step_uv` above via the `or` they're combined with in
# `_infer_channel_state`, so an imprecise value here can't reopen the
# false-"good" gap. Every other field (contact-count rules, flat/clipped/
# excessive-noise cutoffs) isn't in play at these measured levels, so it's
# left at the default.
BLUETOOTH_HEADSET_FIT_THRESHOLDS = replace(
    DEFAULT_HEADSET_FIT_THRESHOLDS,
    max_good_std_dev_uv=320,
    max_good_peak_to_peak_uv=850,
    max_good_mean_step_uv=300,
    max_good_step_uv=700,
)

# The four scalp-contact EEG electrodes on a Muse headband. The Elata Web
# Bluetooth SDK's Athena decoder additionally reports AUX1-4 as "EEG"
# channels, but those are auxiliary/reference inputs, not electrodes worn
# against skin -- BrainFlow's own board config for the same hardware
# (`get_eeg_channels`/`get_eeg_names` for `MUSE_S_ATHENA_BOARD`) only ever
# exposes these four, and an unconnected AUX input reads as a clean,
# plausible EEG trace whether or not the headband is on a head, which is
# enough on its own to make a resting headset look worn if left in the mix.
SCALP_ELECTRODE_IDS = frozenset({"tp9", "af7", "af8", "tp10"})


def select_scalp_electrode_indices(channel_ids: list[str]) -> list[int]:
    """Indices of `channel_ids` that are scalp electrodes -- see
    `SCALP_ELECTRODE_IDS`. Falls back to every index when none are
    recognized, so a caller streaming an unrecognized channel layout still
    gets an assessment rather than losing all of its channels."""
    indices = [index for index, channel_id in enumerate(channel_ids) if channel_id.lower() in SCALP_ELECTRODE_IDS]
    return indices if indices else list(range(len(channel_ids)))


@dataclass(frozen=True)
class ChannelSignalQuality:
    channel: SignalChannel
    state: ChannelFitState
    score: float
    rms_uv: float
    std_dev_uv: float
    peak_to_peak_uv: float
    mean_step_uv: float
    max_abs_uv: float
    max_step_uv: float
    clipped_fraction: float
    message: str


@dataclass(frozen=True)
class HeadsetFitSnapshot:
    state: HeadsetFitState
    ready: bool
    worn: bool
    message: str
    blockers: list[str]
    channels: list[ChannelSignalQuality]
    stable_for_ms: float
    required_stable_ms: float
    excessive_artifact: bool
    updated_at_ms: float


class HeuristicHeadsetFitProvider:
    """Stateful, per-session port of `HeuristicHeadsetFitProvider`. Call
    `update` once per analyzed window.

    For a stateless, single-window assessment, use a fresh instance (or
    call `reset`) -- `ready` will then always be `False`, since readiness
    requires sustained good contact over `thresholds.stable_ready_ms`,
    which a single window can't demonstrate.
    """

    def __init__(self, thresholds: HeadsetFitThresholds = DEFAULT_HEADSET_FIT_THRESHOLDS) -> None:
        self._thresholds = thresholds
        self._stable_since_ms: float | None = None

    def reset(self) -> None:
        self._stable_since_ms = None

    def update(
        self,
        *,
        channels: list[SignalChannel],
        samples: list[list[float]],
        now_ms: float | None = None,
    ) -> HeadsetFitSnapshot:
        now = now_ms if now_ms is not None else time.monotonic() * 1000.0
        thresholds = self._thresholds

        channel_qualities = _analyze_channels(channels, samples, thresholds)
        poor = [c for c in channel_qualities if c.state == "poor"]
        adjusting = [c for c in channel_qualities if c.state == "adjusting"]
        good = [c for c in channel_qualities if c.state == "good"]
        poor_fraction = len(poor) / len(channel_qualities) if channel_qualities else 1.0
        good_fraction = len(good) / len(channel_qualities) if channel_qualities else 0.0
        excessive_artifact = any(
            c.max_step_uv > thresholds.max_step_uv * 1.5 for c in channel_qualities
        )
        enough_good_channels = (
            len(good) >= min(thresholds.min_good_channels, len(channel_qualities))
            and good_fraction >= thresholds.min_good_channel_fraction
        )
        worn = enough_good_channels and not _all_flat(channel_qualities)
        blockers = _build_blockers(
            channel_qualities=channel_qualities,
            poor=poor,
            adjusting=adjusting,
            good=good,
            excessive_artifact=excessive_artifact,
            worn=worn,
            enough_good_channels=enough_good_channels,
        )
        acceptable = (
            worn
            and len(channel_qualities) > 0
            and enough_good_channels
            and poor_fraction <= thresholds.max_poor_channel_fraction
            and not excessive_artifact
        )

        if acceptable:
            if self._stable_since_ms is None:
                self._stable_since_ms = now
        else:
            self._stable_since_ms = None

        stable_for_ms = 0.0 if self._stable_since_ms is None else now - self._stable_since_ms
        ready = acceptable and stable_for_ms >= thresholds.stable_ready_ms
        state: HeadsetFitState = (
            "ready"
            if ready
            else "good"
            if acceptable
            else "poor"
            if poor_fraction > thresholds.max_poor_channel_fraction
            else "adjusting"
        )

        return HeadsetFitSnapshot(
            state=state,
            ready=ready,
            worn=worn,
            message=(
                "Signal looks stable"
                if ready
                else "Signal looks usable"
                if acceptable
                else (blockers[0] if blockers else "Check headset fit")
            ),
            blockers=[] if ready else blockers,
            channels=channel_qualities,
            stable_for_ms=stable_for_ms,
            required_stable_ms=thresholds.stable_ready_ms,
            excessive_artifact=excessive_artifact,
            updated_at_ms=now,
        )


def to_signal_quality_metadata(snapshot: HeadsetFitSnapshot) -> SignalQualityMetadata:
    """Adapts the plain-dataclass result of `update()` into the pydantic
    model used on `SignalFrame.quality` / `AnalyzeWindowResponse.quality`."""
    return SignalQualityMetadata(
        source="inferred",
        excessiveArtifact=snapshot.excessive_artifact,
        message=snapshot.message,
        state=snapshot.state,
        ready=snapshot.ready,
        worn=snapshot.worn,
        blockers=list(snapshot.blockers),
        channels=[
            ChannelSignalQualityModel(
                channel=channel.channel,
                state=channel.state,
                score=channel.score,
                rmsUv=channel.rms_uv,
                stdDevUv=channel.std_dev_uv,
                peakToPeakUv=channel.peak_to_peak_uv,
                meanStepUv=channel.mean_step_uv,
                maxAbsUv=channel.max_abs_uv,
                maxStepUv=channel.max_step_uv,
                clippedFraction=channel.clipped_fraction,
                message=channel.message,
            )
            for channel in snapshot.channels
        ],
        stableForMs=snapshot.stable_for_ms,
        requiredStableMs=snapshot.required_stable_ms,
    )


@dataclass(frozen=True)
class _ChannelStats:
    rms_uv: float
    std_dev_uv: float
    peak_to_peak_uv: float
    mean_step_uv: float
    max_abs_uv: float
    max_step_uv: float
    clipped_fraction: float


def _channel_stats(values: list[float]) -> _ChannelStats:
    if not values:
        return _ChannelStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)

    n = len(values)
    mean = sum(values) / n
    square_mean = sum(v * v for v in values) / n
    variance = sum((v - mean) ** 2 for v in values) / n

    max_step_uv = 0.0
    total_step_uv = 0.0
    for index in range(1, n):
        step = abs(values[index] - values[index - 1])
        max_step_uv = max(max_step_uv, step)
        total_step_uv += step

    ordered = sorted(values)
    max_abs_uv = max(abs(v) for v in values)
    clipped_count = sum(1 for v in values if abs(v) > 100000)

    return _ChannelStats(
        rms_uv=math.sqrt(square_mean),
        std_dev_uv=math.sqrt(variance),
        peak_to_peak_uv=_percentile(ordered, 0.95) - _percentile(ordered, 0.05),
        mean_step_uv=total_step_uv / max(1, n - 1),
        max_abs_uv=max_abs_uv,
        max_step_uv=max_step_uv,
        clipped_fraction=clipped_count / n,
    )


def _percentile(ordered: list[float], fraction: float) -> float:
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, math.floor((len(ordered) - 1) * fraction)))
    return ordered[index]


def _infer_channel_state(
    stats: _ChannelStats,
    sample_count: int,
    thresholds: HeadsetFitThresholds,
) -> tuple[ChannelFitState, float, str]:
    if sample_count < thresholds.min_samples_per_frame:
        return "adjusting", 35.0, "Waiting for enough samples"

    if stats.rms_uv < thresholds.min_rms_uv or stats.std_dev_uv < thresholds.min_std_dev_uv:
        return "poor", 12.0, "Signal is too flat"

    if (
        stats.max_abs_uv > thresholds.max_absolute_uv
        or stats.clipped_fraction > thresholds.max_clipped_fraction
    ):
        return "poor", 10.0, "Signal is clipped or saturated"

    if stats.rms_uv > thresholds.max_rms_uv or stats.max_step_uv > thresholds.max_step_uv:
        return "adjusting", 52.0, "Excessive noise or movement"

    if (
        stats.std_dev_uv > thresholds.max_good_std_dev_uv
        or stats.peak_to_peak_uv > thresholds.max_good_peak_to_peak_uv
        or stats.mean_step_uv > thresholds.max_good_mean_step_uv
        or stats.max_step_uv > thresholds.max_good_step_uv
    ):
        return "adjusting", 58.0, "Signal is unstable; check headset fit"

    return "good", 86.0, "Plausible EEG signal"


def _analyze_channels(
    channels: list[SignalChannel],
    samples: list[list[float]],
    thresholds: HeadsetFitThresholds,
) -> list[ChannelSignalQuality]:
    results: list[ChannelSignalQuality] = []
    for index, channel in enumerate(channels):
        values = [
            row[index]
            for row in samples
            if index < len(row) and math.isfinite(row[index])
        ]
        stats = _channel_stats(values)
        state, score, message = _infer_channel_state(stats, len(values), thresholds)
        results.append(
            ChannelSignalQuality(
                channel=channel,
                state=state,
                score=score,
                rms_uv=stats.rms_uv,
                std_dev_uv=stats.std_dev_uv,
                peak_to_peak_uv=stats.peak_to_peak_uv,
                mean_step_uv=stats.mean_step_uv,
                max_abs_uv=stats.max_abs_uv,
                max_step_uv=stats.max_step_uv,
                clipped_fraction=stats.clipped_fraction,
                message=message,
            ),
        )
    return results


def _build_blockers(
    *,
    channel_qualities: list[ChannelSignalQuality],
    poor: list[ChannelSignalQuality],
    adjusting: list[ChannelSignalQuality],
    good: list[ChannelSignalQuality],
    excessive_artifact: bool,
    worn: bool,
    enough_good_channels: bool,
) -> list[str]:
    blockers: list[str] = []

    if not worn:
        blockers.append(
            f"Need stable signal on more channels ({len(good)}/{len(channel_qualities)} good)."
            if good
            else "Check headset fit."
        )

    if worn and not enough_good_channels:
        blockers.append(
            f"Need stable signal on more channels ({len(good)}/{len(channel_qualities)} good)."
        )

    if poor:
        blockers.append(f"Check headset fit near {poor[0].channel.label}.")

    side = _side_adjustment(channel_qualities)
    if side:
        blockers.append(f"Adjust {side} side.")

    if adjusting and not side:
        blockers.append(f"Stabilize {adjusting[0].channel.label}.")

    if excessive_artifact:
        blockers.append("Excessive noise or movement.")

    return blockers


def _side_adjustment(channel_qualities: list[ChannelSignalQuality]) -> str:
    left = sum(
        1 for c in channel_qualities if c.channel.id in ("tp9", "af7") and c.state != "good"
    )
    right = sum(
        1 for c in channel_qualities if c.channel.id in ("tp10", "af8") and c.state != "good"
    )
    if left > right and left > 0:
        return "left"
    if right > left and right > 0:
        return "right"
    return ""


def _all_flat(channel_qualities: list[ChannelSignalQuality]) -> bool:
    return bool(channel_qualities) and all(c.std_dev_uv < 0.25 for c in channel_qualities)
