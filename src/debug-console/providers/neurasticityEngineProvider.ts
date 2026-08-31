import { eegEngine } from "../../services/eegEngine";
import type { EEGDataPoint } from "../../types";
import type {
  DeviceInfo,
  EegProviderEvents,
  SignalFeatures,
  SignalFrame,
  SignalQualityMetadata,
} from "../domain/eeg";
import type { EegProvider, EegProviderDescriptor } from "./eegProvider";

type ConnectionKind = "brainflow" | "bluetooth";

const channels = ["tp9", "af7", "af8", "tp10"] as const;

/**
 * Debug-console adapter for Neurasticity's actual connection engine.
 *
 * No connection or decoding code lives here: both options call the same
 * EEGEngine methods used by the product UI, then translate its live output
 * into the console's display-oriented SignalFrame contract.
 */
export class NeurasticityEngineProvider implements EegProvider {
  readonly descriptor: EegProviderDescriptor;
  private deviceInfo: DeviceInfo | null = null;
  private unsubscribe: (() => void) | null = null;
  private sequenceId = 0;

  constructor(
    private readonly kind: ConnectionKind,
    private readonly events: EegProviderEvents,
  ) {
    this.descriptor =
      kind === "brainflow"
        ? {
            id: "brainflow-muse-athena",
            label: "Muse Athena",
            description: "Neurasticity BrainFlow connection",
          }
        : {
            id: "muse-athena-bluetooth",
            label: "Muse Athena - Bluetooth",
            description: "Neurasticity Bluetooth connection",
          };
  }

  getDeviceInfo() {
    return this.deviceInfo;
  }

  async connectAndStart() {
    await this.disconnect("Preparing a fresh connection");
    this.events.onState("connecting", `Connecting through Neurasticity's ${this.kind} path`);
    this.sequenceId = 0;
    this.unsubscribe = eegEngine.subscribe((point) => this.publish(point));
    eegEngine.start();

    const result =
      this.kind === "brainflow"
        ? await eegEngine.connectMuseAthenaBrainflow()
        : await eegEngine.connectMuseBluetooth();

    if (!result.success) {
      await this.disconnect(result.error ?? "Unable to connect");
      this.events.onState("error", result.error ?? "Unable to connect");
      this.events.onError({ message: result.error ?? "Unable to connect", recoverable: true });
      return;
    }

    this.deviceInfo = {
      label: result.deviceName ?? "Muse Athena",
      model: this.kind === "brainflow" ? "Muse Athena via BrainFlow" : "Muse Athena via Bluetooth",
      providerName: this.kind === "brainflow" ? "Neurasticity BrainFlow" : "Neurasticity Bluetooth",
      capabilities: [
        {
          kind: "eeg",
          sampleRateHz: 256,
          channels: channels.map((name) => ({ id: name, label: name.toUpperCase(), unit: "uV" })),
        },
      ],
    };
    this.events.onDeviceInfo(this.deviceInfo);
    this.events.onState("streaming", "Receiving EEG through Neurasticity");
  }

  async disconnect(reason = "Disconnected") {
    this.unsubscribe?.();
    this.unsubscribe = null;
    eegEngine.stop();
    eegEngine.disconnectHardware();
    this.deviceInfo = null;
    this.events.onState("disconnected", reason);
  }

  private publish(point: Parameters<typeof eegEngine.subscribe>[0] extends (data: infer T) => void ? T : never) {
    if (!eegEngine.isHardwareConnected) return;

    const samples = [
      channels.map((channel) => {
        const values = eegEngine.rawBuffers[channel];
        return values[values.length - 1] ?? 0;
      }),
    ];
    const features = toFeatures(point);
    const frame: SignalFrame = {
      sensor: "eeg",
      sampleRateHz: 256,
      channels: channels.map((name) => ({ id: name, label: name.toUpperCase(), unit: "uV" })),
      samples,
      receivedAtMs: point.timestamp,
      sequenceId: ++this.sequenceId,
      features,
      quality: toQuality(),
    };
    this.events.onSignalFrame(frame);
  }
}

function toFeatures(point: EEGDataPoint): SignalFeatures {
  const scores = point.brainflowScores;
  return {
    bandPowers: {
      absolute: { ...point.bands },
      relative: {},
      ratios: {
        thetaBeta: point.thetaBetaRatioAvailable ? point.thetaBetaRatio : 0,
      },
      windowSeconds: 2,
      method: "brainflow_welch_psd",
    },
    mindfulnessScore: scores?.mindfulnessScore ?? null,
    restfulnessScore: scores?.restfulnessScore ?? null,
    focusScore: scores?.focusScore ?? null,
    relaxScore: scores?.relaxScore ?? null,
    valence: scores?.valence ?? null,
    arousal: scores?.arousal ?? null,
    // EEGEngine exposes the finished product values. The console needs raw
    // fields to render its proxy panel, so use those same values rather than
    // recomputing a second, divergent estimate.
    rawValence: scores?.valence ?? null,
    rawArousal: scores?.arousal ?? null,
    stateLabel: scores?.emotionLabel ?? null,
    thetaBetaRatio: point.thetaBetaRatioAvailable ? point.thetaBetaRatio : null,
  };
}

function toQuality(): SignalQualityMetadata | undefined {
  const fit = eegEngine.serverFitState;
  if (!fit) return undefined;

  return {
    source: "device",
    state: fit.state,
    ready: fit.ready,
    worn: fit.worn,
    blockers: fit.blockers,
    channels: fit.channels.map((channel) => ({
      channel: {
        ...channel.channel,
        unit: "uV",
      },
      state: channel.state,
      score: channel.state === "good" ? 1 : channel.state === "adjusting" ? 0.5 : 0,
      rmsUv: channel.rmsUv ?? 0,
      stdDevUv: 0,
      peakToPeakUv: 0,
      meanStepUv: 0,
      maxAbsUv: 0,
      maxStepUv: 0,
      clippedFraction: 0,
      message: channel.state === "good" ? "Signal looks usable" : "Adjust headset fit",
    })),
  };
}
