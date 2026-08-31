export type EegConnectionState =
  | "idle"
  | "initializing"
  | "discovering"
  | "connecting"
  | "connected"
  | "streaming"
  | "disconnecting"
  | "disconnected"
  | "error";

export type SensorKind = "eeg" | "ppg" | "accelerometer" | "gyroscope" | "battery";

export interface SignalChannel {
  id: string;
  label: string;
  unit: string;
}

export type ContactQualityState = "unknown" | "poor" | "adjusting" | "good";

export interface SignalChannelQualityMetadata {
  channelId: string;
  state: ContactQualityState;
  source: "device" | "inferred";
  score?: number;
  impedanceOhms?: number;
  message?: string;
}

export type HeadsetFitAssessmentState = "poor" | "adjusting" | "good" | "ready";
export type HeadsetFitAssessmentChannelState = "poor" | "adjusting" | "good";

/** Per-channel breakdown from a server-computed headset-fit assessment --
 * mirrors `brainflow_service/models.py`'s `ChannelSignalQualityModel`. */
export interface HeadsetFitAssessmentChannel {
  channel: SignalChannel;
  state: HeadsetFitAssessmentChannelState;
  score: number;
  rmsUv: number;
  stdDevUv: number;
  peakToPeakUv: number;
  meanStepUv: number;
  maxAbsUv: number;
  maxStepUv: number;
  clippedFraction: number;
  message: string;
}

export interface SignalQualityMetadata {
  source: "device" | "inferred";
  channelQualities?: SignalChannelQualityMetadata[];
  excessiveArtifact?: boolean;
  worn?: boolean;
  message?: string;
  // A full server-computed headset-fit assessment -- present when `source`
  // is a `brainflow_service` endpoint that runs `headset_fit.py` itself
  // (`/sessions/{id}/stream`, `/analyze-window`, and
  // `/headset-fit/sessions/{id}/assess`), so the client can display it
  // directly instead of re-deriving fit from raw samples. See
  // `App.tsx`'s `snapshotFromServerFit`.
  state?: HeadsetFitAssessmentState;
  ready?: boolean;
  blockers?: string[];
  channels?: HeadsetFitAssessmentChannel[];
  stableForMs?: number;
  requiredStableMs?: number;
}

export interface BandPowerFeatures {
  absolute: Record<string, number>;
  relative: Record<string, number>;
  ratios: Record<string, number>;
  windowSeconds: number;
  method: "brainflow_welch_psd" | "custom_goertzel";
}

export interface SignalFeatures {
  bandPowers?: BandPowerFeatures | null;
  brainflowConcentration?: number | null;
  brainflowRestfulness?: number | null;

  // Authoritative values from brainflow_service. The console only presents
  // them; it never computes a competing local metric pipeline.
  mindfulnessScore?: number | null;
  restfulnessScore?: number | null;
  valence?: number | null;
  arousal?: number | null;
  stateLabel?: string | null;
  confidence?: number | null;
  calibrationActive?: boolean;
  calibrationStatus?: "off" | "collecting" | "active";
  calibrationProgress?: number;
  calibrationRequired?: number;
  rawMetrics?: Record<string, number>;
  baselineRelativeMetrics?: Record<string, number>;
  interhemisphericCoherence?: number | null;
}

/** Training's baseline-relative attention score -- mirrors
 * `brainflow_service/models.py`'s `AttentionMetricSampleModel`. */
export interface TrainingMetricSample {
  displayedScore: number | null;
  restfulnessScore: number | null;
  focusScore: number | null;
  relaxScore: number | null;
  rawRatio: number;
  baselineRatio: number | null;
  rawBrainflowMindfulness: number | null;
  baselineBrainflowMindfulness: number | null;
  baselineRelativeValue: number | null;
  baselineZScore: number | null;
  rawBrainflowRestfulness: number | null;
  baselineBrainflowRestfulness: number | null;
  restfulnessBaselineRelativeValue: number | null;
  restfulnessBaselineZScore: number | null;
  scoreSource: "brainflow_mindfulness" | "unavailable";
  restfulnessScoreSource: "brainflow_restfulness" | "unavailable";
}

export interface SensorCapability {
  kind: SensorKind;
  sampleRateHz: number | null;
  channels: SignalChannel[];
}

export interface DeviceInfo {
  label: string;
  model: string;
  providerName: string;
  firmwareVersion?: string;
  capabilities: SensorCapability[];
  metadata?: Record<string, unknown>;
}

export interface SignalFrame {
  sensor: SensorKind;
  sampleRateHz: number | null;
  channels: SignalChannel[];
  samples: number[][];
  timestampsMs?: number[];
  receivedAtMs: number;
  sequenceId: number;
  quality?: SignalQualityMetadata;
  features?: SignalFeatures | null;
  training?: TrainingMetricSample | null;
}

export interface EegFrameSummary {
  latestByChannel: Record<string, number>;
  samplesInFrame: number;
  totalSamples: number;
  frameCount: number;
  sampleRateHz: number | null;
  channelNames: string[];
}

export interface ProviderError {
  message: string;
  code?: string;
  recoverable?: boolean;
  details?: Record<string, unknown>;
}

export interface EegProviderEvents {
  onState: (state: EegConnectionState, detail?: string) => void;
  onDeviceInfo: (info: DeviceInfo) => void;
  onSignalFrame: (frame: SignalFrame) => void;
  onError: (error: ProviderError) => void;
}

export function getCapability(
  device: DeviceInfo | null,
  kind: SensorKind,
): SensorCapability | null {
  return device?.capabilities.find((capability) => capability.kind === kind) ?? null;
}

export function summarizeEegFrame(
  frame: SignalFrame,
  previousTotalSamples: number,
  previousFrameCount: number,
): EegFrameSummary {
  const latestRow = frame.samples[frame.samples.length - 1] ?? [];
  const channelNames = frame.channels.map((channel) => channel.label);
  const latestByChannel = Object.fromEntries(
    frame.channels.map((channel, index) => [
      channel.label,
      latestRow[index] ?? Number.NaN,
    ]),
  );

  return {
    latestByChannel,
    samplesInFrame: frame.samples.length,
    totalSamples: previousTotalSamples + frame.samples.length,
    frameCount: previousFrameCount + 1,
    sampleRateHz: frame.sampleRateHz,
    channelNames,
  };
}
