import type {
  DeviceInfo,
  EegConnectionState,
  SignalChannel,
  SignalFrame,
} from "../domain/eeg";
import {
  defaultHeadsetFitThresholds,
  type HeadsetFitThresholds,
} from "./headsetFitConfig";

export type HeadsetFitState =
  | "not_detected"
  | "not_worn"
  | "poor"
  | "adjusting"
  | "good"
  | "ready";

export type ChannelFitState = "unknown" | "poor" | "adjusting" | "good";

export interface ChannelSignalQuality {
  channel: SignalChannel;
  state: ChannelFitState;
  score: number;
  rmsUv: number;
  stdDevUv: number;
  peakToPeakUv: number;
  meanStepUv: number;
  maxAbsUv: number;
  maxStepUv: number;
  clippedFraction: number;
  source: "device" | "inferred";
  message: string;
}

export interface HeadsetFitSnapshot {
  state: HeadsetFitState;
  ready: boolean;
  connected: boolean;
  worn: boolean;
  source: "device" | "inferred";
  message: string;
  blockers: string[];
  channels: ChannelSignalQuality[];
  stableForMs: number;
  requiredStableMs: number;
  excessiveArtifact: boolean;
  updatedAtMs: number;
}

export interface HeadsetFitProvider {
  reset(): void;
  update(input: {
    connectionState: EegConnectionState;
    deviceInfo: DeviceInfo | null;
    frame: SignalFrame | null;
    nowMs?: number;
  }): HeadsetFitSnapshot;
}

export class HeuristicHeadsetFitProvider implements HeadsetFitProvider {
  private stableSinceMs: number | null = null;
  private snapshot: HeadsetFitSnapshot = createInitialSnapshot();

  constructor(private readonly thresholds: HeadsetFitThresholds = defaultHeadsetFitThresholds) {}

  reset() {
    this.stableSinceMs = null;
    this.snapshot = createInitialSnapshot();
  }

  update({
    connectionState,
    deviceInfo,
    frame,
    nowMs = performance.now(),
  }: {
    connectionState: EegConnectionState;
    deviceInfo: DeviceInfo | null;
    frame: SignalFrame | null;
    nowMs?: number;
  }) {
    const connected = connectionState === "connected" || connectionState === "streaming";

    if (!connected) {
      this.stableSinceMs = null;
      this.snapshot = {
        ...createInitialSnapshot(nowMs),
        state: "not_detected",
        connected: false,
        message: "Headset not detected",
        blockers: ["Connect an EEG device."],
      };
      return this.snapshot;
    }

    if (!frame || frameAgeMs(frame.receivedAtMs, nowMs) > this.thresholds.staleFrameMs) {
      this.stableSinceMs = null;
      this.snapshot = {
        ...createInitialSnapshot(nowMs),
        state: "not_worn",
        connected: true,
        message: "Waiting for EEG signal",
        blockers: ["Waiting for a fresh EEG signal."],
      };
      return this.snapshot;
    }

    const channels = analyzeChannels(frame, this.thresholds);
    const poorChannels = channels.filter((channel) => channel.state === "poor");
    const adjustingChannels = channels.filter((channel) => channel.state === "adjusting");
    const goodChannels = channels.filter((channel) => channel.state === "good");
    const poorFraction = channels.length > 0 ? poorChannels.length / channels.length : 1;
    const goodFraction = channels.length > 0 ? goodChannels.length / channels.length : 0;
    const excessiveArtifact =
      frame.quality?.excessiveArtifact ??
      channels.some((channel) => channel.maxStepUv > this.thresholds.maxStepUv * 1.5);
    const enoughGoodChannels =
      goodChannels.length >= Math.min(this.thresholds.minGoodChannels, channels.length) &&
      goodFraction >= this.thresholds.minGoodChannelFraction;
    const worn = enoughGoodChannels && !allFlat(channels);
    const blockers = buildBlockers({
      channels,
      poorChannels,
      adjustingChannels,
      goodChannels,
      excessiveArtifact,
      worn,
      enoughGoodChannels,
    });
    const acceptable =
      worn &&
      channels.length > 0 &&
      enoughGoodChannels &&
      poorFraction <= this.thresholds.maxPoorChannelFraction &&
      !excessiveArtifact;

    if (acceptable) {
      this.stableSinceMs ??= nowMs;
    } else {
      this.stableSinceMs = null;
    }

    const stableForMs = this.stableSinceMs === null ? 0 : nowMs - this.stableSinceMs;
    const ready = acceptable && stableForMs >= this.thresholds.stableReadyMs;
    const state = ready
      ? "ready"
      : acceptable
        ? "good"
        : poorFraction > this.thresholds.maxPoorChannelFraction
          ? "poor"
          : "adjusting";

    this.snapshot = {
      state,
      ready,
      connected,
      worn,
      source: frame.quality?.source ?? "inferred",
      message: ready
        ? "Signal looks stable"
        : acceptable
          ? "Signal looks usable"
          : blockers[0] ?? "Check headset fit",
      blockers: ready ? [] : blockers,
      channels,
      stableForMs,
      requiredStableMs: this.thresholds.stableReadyMs,
      excessiveArtifact,
      updatedAtMs: nowMs,
    };

    return this.snapshot;
  }
}

function analyzeChannels(
  frame: SignalFrame,
  thresholds: HeadsetFitThresholds,
): ChannelSignalQuality[] {
  return frame.channels.map((channel, channelIndex) => {
    const values = frame.samples
      .map((row) => row[channelIndex])
      .filter((value) => Number.isFinite(value));
    const stats = channelStats(values);
    const metadata = frame.quality?.channelQualities?.find(
      (quality) => quality.channelId === channel.id,
    );

    if (metadata?.source === "device" && metadata.state !== "unknown") {
      return {
        channel,
        state: metadata.state,
        score: metadata.score ?? scoreForState(metadata.state),
        ...stats,
        source: "device",
        message: metadata.message ?? messageForState(metadata.state, channel.label),
      };
    }

    const inferred = inferChannelState(stats, values.length, thresholds);

    return {
      channel,
      ...stats,
      ...inferred,
      source: "inferred",
    };
  });
}

function channelStats(values: number[]) {
  if (values.length === 0) {
    return {
      rmsUv: 0,
      stdDevUv: 0,
      peakToPeakUv: 0,
      meanStepUv: 0,
      maxAbsUv: 0,
      maxStepUv: 0,
      clippedFraction: 1,
    };
  }

  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const squareMean =
    values.reduce((total, value) => total + value * value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
  let maxStepUv = 0;
  let totalStepUv = 0;

  for (let index = 1; index < values.length; index += 1) {
    const step = Math.abs(values[index] - values[index - 1]);
    maxStepUv = Math.max(maxStepUv, step);
    totalStepUv += step;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))] ?? 0;
  const maxAbsUv = values.reduce(
    (max, value) => Math.max(max, Math.abs(value)),
    0,
  );
  const clippedCount = values.filter((value) => Math.abs(value) > 100000).length;

  return {
    rmsUv: Math.sqrt(squareMean),
    stdDevUv: Math.sqrt(variance),
    peakToPeakUv: percentile(0.95) - percentile(0.05),
    meanStepUv: totalStepUv / Math.max(1, values.length - 1),
    maxAbsUv,
    maxStepUv,
    clippedFraction: clippedCount / values.length,
  };
}

function inferChannelState(
  stats: ReturnType<typeof channelStats>,
  sampleCount: number,
  thresholds: HeadsetFitThresholds,
) {
  if (sampleCount < thresholds.minSamplesPerFrame) {
    return {
      state: "adjusting" as const,
      score: 35,
      message: "Waiting for enough samples",
    };
  }

  if (stats.rmsUv < thresholds.minRmsUv || stats.stdDevUv < thresholds.minStdDevUv) {
    return {
      state: "poor" as const,
      score: 12,
      message: "Signal is too flat",
    };
  }

  if (stats.maxAbsUv > thresholds.maxAbsoluteUv || stats.clippedFraction > thresholds.maxClippedFraction) {
    return {
      state: "poor" as const,
      score: 10,
      message: "Signal is clipped or saturated",
    };
  }

  if (stats.rmsUv > thresholds.maxRmsUv || stats.maxStepUv > thresholds.maxStepUv) {
    return {
      state: "adjusting" as const,
      score: 52,
      message: "Excessive noise or movement",
    };
  }

  if (
    stats.stdDevUv > thresholds.maxGoodStdDevUv ||
    stats.peakToPeakUv > thresholds.maxGoodPeakToPeakUv ||
    stats.meanStepUv > thresholds.maxGoodMeanStepUv ||
    stats.maxStepUv > thresholds.maxGoodStepUv
  ) {
    return {
      state: "adjusting" as const,
      score: 58,
      message: "Signal is unstable; check headset fit",
    };
  }

  return {
    state: "good" as const,
    score: 86,
    message: "Plausible EEG signal",
  };
}

function buildBlockers({
  channels,
  poorChannels,
  adjustingChannels,
  goodChannels,
  excessiveArtifact,
  worn,
  enoughGoodChannels,
}: {
  channels: ChannelSignalQuality[];
  poorChannels: ChannelSignalQuality[];
  adjustingChannels: ChannelSignalQuality[];
  goodChannels: ChannelSignalQuality[];
  excessiveArtifact: boolean;
  worn: boolean;
  enoughGoodChannels: boolean;
}) {
  const blockers: string[] = [];

  if (!worn) {
    blockers.push(
      goodChannels.length > 0
        ? `Need stable signal on more channels (${goodChannels.length}/${channels.length} good).`
        : "Check headset fit.",
    );
  }

  if (worn && !enoughGoodChannels) {
    blockers.push(`Need stable signal on more channels (${goodChannels.length}/${channels.length} good).`);
  }

  if (poorChannels.length > 0) {
    blockers.push(`Check headset fit near ${poorChannels[0].channel.label}.`);
  }

  const side = sideAdjustment(channels);
  if (side) {
    blockers.push(`Adjust ${side} side.`);
  }

  if (adjustingChannels.length > 0 && !side) {
    blockers.push(`Stabilize ${adjustingChannels[0].channel.label}.`);
  }

  if (excessiveArtifact) {
    blockers.push("Excessive noise or movement.");
  }

  return blockers;
}

function sideAdjustment(channels: ChannelSignalQuality[]) {
  const left = channels.filter(
    (channel) =>
      ["tp9", "af7"].includes(channel.channel.id) && channel.state !== "good",
  ).length;
  const right = channels.filter(
    (channel) =>
      ["tp10", "af8"].includes(channel.channel.id) && channel.state !== "good",
  ).length;

  if (left > right && left > 0) return "left";
  if (right > left && right > 0) return "right";
  return "";
}

function allFlat(channels: ChannelSignalQuality[]) {
  return channels.length > 0 && channels.every((channel) => channel.stdDevUv < 0.25);
}

export function frameAgeMs(frameReceivedAtMs: number, performanceNowMs: number) {
  const epochTimestampThresholdMs = 1_000_000_000_000;
  const currentClockMs =
    frameReceivedAtMs > epochTimestampThresholdMs ? Date.now() : performanceNowMs;

  return Math.max(0, currentClockMs - frameReceivedAtMs);
}

function scoreForState(state: "poor" | "adjusting" | "good") {
  if (state === "good") return 90;
  if (state === "adjusting") return 55;
  return 15;
}

function messageForState(state: "poor" | "adjusting" | "good", channelName: string) {
  if (state === "good") return "Plausible EEG signal";
  if (state === "adjusting") return `Stabilize ${channelName}`;
  return `Check headset fit near ${channelName}`;
}

export function createInitialSnapshot(nowMs = performance.now()): HeadsetFitSnapshot {
  return {
    state: "not_detected",
    ready: false,
    connected: false,
    worn: false,
    source: "inferred",
    message: "Headset not detected",
    blockers: ["Connect an EEG device."],
    channels: [],
    stableForMs: 0,
    requiredStableMs: defaultHeadsetFitThresholds.stableReadyMs,
    excessiveArtifact: false,
    updatedAtMs: nowMs,
  };
}

