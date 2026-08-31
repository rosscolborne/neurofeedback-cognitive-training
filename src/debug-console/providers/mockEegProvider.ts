import type {
  DeviceInfo,
  EegProviderEvents,
  SignalChannel,
  SignalFrame,
} from "../domain/eeg";
import type { EegProvider, EegProviderDescriptor } from "./eegProvider";

const channels: SignalChannel[] = [
  { id: "tp9", label: "TP9", unit: "uV" },
  { id: "af7", label: "AF7", unit: "uV" },
  { id: "af8", label: "AF8", unit: "uV" },
  { id: "tp10", label: "TP10", unit: "uV" },
  { id: "aux1", label: "AUX1", unit: "uV" },
  { id: "aux2", label: "AUX2", unit: "uV" },
  { id: "aux3", label: "AUX3", unit: "uV" },
  { id: "aux4", label: "AUX4", unit: "uV" },
];

const deviceInfo: DeviceInfo = {
  label: "Simulated EEG device",
  model: "Mock 8-channel EEG source",
  providerName: "Mock provider",
  capabilities: [
    {
      kind: "eeg",
      sampleRateHz: 256,
      channels,
    },
  ],
};

export class MockEegProvider implements EegProvider {
  readonly descriptor: EegProviderDescriptor = {
    id: "mock-eeg",
    label: "Mock EEG",
    description: "Simulated EEG source for UI development",
  };

  private intervalId: number | null = null;
  private sequenceId = 0;
  private startedAtMs = 0;

  constructor(private readonly events: EegProviderEvents) {}

  getDeviceInfo() {
    return deviceInfo;
  }

  async connectAndStart() {
    await this.disconnect();

    this.sequenceId = 0;
    this.startedAtMs = performance.now();
    this.events.onState("initializing", "Preparing simulated EEG source");
    await sleep(200);
    this.events.onState("connected");
    this.events.onDeviceInfo(deviceInfo);
    await sleep(150);
    this.events.onState("streaming");

    this.intervalId = window.setInterval(() => {
      this.sequenceId += 1;
      const elapsedSeconds = (performance.now() - this.startedAtMs) / 1000;
      const samples = createSamples(elapsedSeconds, this.sequenceId);
      const frame: SignalFrame = {
        sensor: "eeg",
        sampleRateHz: 256,
        channels,
        samples,
        receivedAtMs: performance.now(),
        sequenceId: this.sequenceId,
      };

      if (this.sequenceId <= 10 || this.sequenceId % 100 === 0) {
        console.log("[Normalized EEG frame]", frame);
      }

      this.events.onSignalFrame(frame);
    }, 100);
  }

  async disconnect(reason = "Disconnecting") {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
      this.events.onState("disconnecting", reason);
      await sleep(100);
    }

    this.events.onState("disconnected");
  }
}

function createSamples(elapsedSeconds: number, sequenceId: number) {
  const rows: number[][] = [];

  for (let sampleIndex = 0; sampleIndex < 25; sampleIndex += 1) {
    const t = elapsedSeconds + sampleIndex / 256;
    rows.push(
      channels.map((_, channelIndex) => {
        const alpha = Math.sin(2 * Math.PI * 10 * t + channelIndex * 0.35) * 18;
        const drift = Math.sin(2 * Math.PI * 0.6 * t + channelIndex) * 7;
        const line = Math.sin(2 * Math.PI * 50 * t) * 1.5;
        const deterministicNoise =
          Math.sin((sequenceId * 31 + sampleIndex * 17 + channelIndex * 13) * 0.19) *
          2.5;

        return alpha + drift + line + deterministicNoise;
      }),
    );
  }

  return rows;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

