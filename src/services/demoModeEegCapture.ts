import type { EEGDataPoint } from '../types';
import { summarizeEegWindows, type EegCapture, type EegCaptureProvider, type EegWindowSample } from '../consumer/eeg/eegCapture';
import { eegEngine as defaultEngine, type EEGEngine } from './eegEngine';

// The simulated EEG provider for games: the existing Demo Mode synthetic EEG
// (eegEngine's simulator), reduced to a recording summary. It lives outside
// src/consumer because eegEngine uses the clinical types; games receive it as
// an EegCaptureProvider and never see where the data comes from.
//
// Provenance is fixed here: everything this provider produces is 'simulated'.
// The recording schema also requires a device and processing block. The
// simulator emulates a Muse over Web Bluetooth, but no real headset exists, so
// the model is 'unknown' (simulation is never modelled as a device) and the
// service version says 'demo-mode'.

type DemoEngine = Pick<EEGEngine, 'isDemoMode' | 'isHardwareConnected' | 'start' | 'stop' | 'subscribe'>;

/** eegEngine ticks every 100 ms; ten samples make one 1-second window. */
const SAMPLE_INTERVAL_MS = 100;
const SAMPLES_PER_WINDOW = 10;

export const DEMO_MODE_DEVICE = {
  model: 'unknown',
  firmwareVersion: null,
  transport: 'web-bluetooth',
  channels: ['TP9', 'AF7', 'AF8', 'TP10'],
  sampleRateHz: 256,
} as const;

export const DEMO_MODE_PROCESSING = {
  service: 'brainflow-service',
  serviceVersion: 'demo-mode',
  featureVersion: 1,
  windowSeconds: (SAMPLE_INTERVAL_MS * SAMPLES_PER_WINDOW) / 1000,
} as const;

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function score(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : null;
}

export function createDemoModeEegProvider(engine: DemoEngine = defaultEngine, now: () => number = () => Date.now()): EegCaptureProvider {
  return {
    source: 'simulated',
    label: 'Simulated EEG (Demo Mode)',
    start(): EegCapture {
      // With a headset connected the engine reports measured data, which must never be labelled simulated.
      if (engine.isHardwareConnected) throw new Error('A headset is connected; Demo Mode EEG is unavailable.');
      const startedAtMs = now();
      const windows: EegWindowSample[] = [];
      let pending: EEGDataPoint[] = [];
      let stopped = false;
      // Once a headset connects the engine reports measured data, which must
      // never be summarised under 'simulated': the whole capture is void.
      let voided = false;

      engine.isDemoMode = true;
      engine.start(SAMPLE_INTERVAL_MS);
      const unsubscribe = engine.subscribe((point) => {
        if (stopped || voided) return;
        if (engine.isHardwareConnected) {
          voided = true;
          return;
        }
        pending.push(point);
        if (pending.length < SAMPLES_PER_WINDOW) return;
        const values = (pick: (sample: EEGDataPoint) => number | null) => pending.map(pick).filter((value): value is number => value !== null);
        windows.push({
          mindfulness: mean(values((sample) => score(sample.brainflowScores?.mindfulnessScore))),
          restfulness: mean(values((sample) => score(sample.brainflowScores?.restfulnessScore))),
          usable: pending.every((sample) => sample.signalQuality !== 'poor' && sample.signalQuality !== 'disconnected'),
        });
        pending = [];
      });

      const stop = () => {
        if (stopped) return false;
        stopped = true;
        unsubscribe();
        engine.stop();
        // Demo Mode belongs to this capture only.
        engine.isDemoMode = false;
        return true;
      };

      return {
        finish() {
          const measuredDataArrived = voided || engine.isHardwareConnected;
          if (!stop() || measuredDataArrived) return null;
          return summarizeEegWindows({
            source: 'simulated',
            device: { ...DEMO_MODE_DEVICE, channels: [...DEMO_MODE_DEVICE.channels] },
            processing: { ...DEMO_MODE_PROCESSING },
            startedAtMs,
            endedAtMs: now(),
            windows,
          });
        },
        cancel() {
          stop();
        },
      };
    },
  };
}
