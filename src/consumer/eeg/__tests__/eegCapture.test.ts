import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { eegRecordingWriteSchema } from '@nfct/shared';
import { distributionOf, summarizeEegWindows } from '../eegCapture';

const device = { model: 'unknown', firmwareVersion: null, transport: 'web-bluetooth', channels: ['TP9', 'AF7'], sampleRateHz: 256 } as const;
const processing = { service: 'brainflow-service', serviceVersion: 'demo-mode', featureVersion: 1, windowSeconds: 1 } as const;

describe('EEG capture summary', () => {
  it('computes mean, median and nearest-rank p10/p90', () => {
    expect(distributionOf([])).toBeNull();
    expect(distributionOf([0.5])).toEqual({ mean: 0.5, median: 0.5, p10: 0.5, p90: 0.5, n: 1 });
    const values = Array.from({ length: 10 }, (_, index) => (index + 1) / 10);
    expect(distributionOf(values)).toMatchObject({ median: 0.55, p10: 0.1, p90: 0.9, n: 10 });
  });

  it('keeps the provider-stamped source and produces a schema-valid recording', () => {
    const draft = summarizeEegWindows({
      source: 'simulated',
      device: { ...device, channels: [...device.channels] },
      processing: { ...processing },
      startedAtMs: 1_790_000_000_000,
      endedAtMs: 1_790_000_090_000,
      windows: [
        { mindfulness: 0.8, restfulness: 0.6, usable: true },
        { mindfulness: 1.4, restfulness: null, usable: true },
        { mindfulness: 0.1, restfulness: 0.1, usable: false },
      ],
    });
    expect(draft).not.toBeNull();
    expect(draft!.source).toBe('simulated');
    expect(draft!.quality).toMatchObject({ windowsTotal: 3, windowsUsable: 2 });
    // Out-of-range scores are clamped to fractions; unusable windows are left out.
    expect(draft!.summary.mindfulness).toMatchObject({ n: 2, p90: 1 });
    expect(draft!.summary.restfulness).toMatchObject({ n: 1, mean: 0.6 });
    const stored = { ...draft!, schemaVersion: 1, userId: 'player-1', gameSessionId: 'sessionAAAAAAAAAAAA1', createdAt: Timestamp.now() };
    expect(eegRecordingWriteSchema.safeParse(stored).success).toBe(true);
  });

  it('produces nothing when no window was captured', () => {
    expect(summarizeEegWindows({ source: 'simulated', device: { ...device, channels: [...device.channels] }, processing, startedAtMs: 1, endedAtMs: 2, windows: [] })).toBeNull();
  });
});
