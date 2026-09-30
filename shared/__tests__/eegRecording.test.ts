import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { eegRecordingWriteSchema, readEegRecording } from '@nfct/shared';
import { storedEegRecording } from './fixtures';

/** Every property name anywhere in a zod schema. */
function propertyNames(schema: z.core.$ZodType): string[] {
  const def = schema._zod.def as unknown as Record<string, unknown> & { type: string };
  const children = (...keys: string[]) => keys.map((key) => def[key]).filter(Boolean) as z.core.$ZodType[];
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, z.core.$ZodType>;
      return Object.entries(shape).flatMap(([key, child]) => [key, ...propertyNames(child)]);
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
      return children('innerType').flatMap(propertyNames);
    case 'array':
      return children('element').flatMap(propertyNames);
    case 'record':
      return children('valueType').flatMap(propertyNames);
    case 'union':
      return (def.options as z.core.$ZodType[]).flatMap(propertyNames);
    case 'pipe':
      return children('in', 'out').flatMap(propertyNames);
    default:
      return [];
  }
}

const FORBIDDEN_FIELD = /raw|^samples$|samples$|^data$|valence|arousal|emotion|affect|mood|^state$|inzone|zonescore|serial|mac$|peripheral/i;

describe('EEG recording schema', () => {
  it('reads and writes a valid stored recording', () => {
    const raw = storedEegRecording();

    expect(eegRecordingWriteSchema.parse(raw)).toEqual(raw);
    expect(readEegRecording(raw)).toEqual(raw);
  });

  it('requires a gameSessionId', () => {
    const { gameSessionId: _gameSessionId, ...unlinked } = storedEegRecording();

    expect(() => readEegRecording(unlinked)).toThrow(/gameSessionId/);
    expect(() => readEegRecording({ ...storedEegRecording(), gameSessionId: null })).toThrow(/gameSessionId/);
    expect(() => readEegRecording({ ...storedEegRecording(), gameSessionId: '' })).toThrow(/gameSessionId/);
  });

  it('records measured or simulated provenance, and nothing else', () => {
    expect(readEegRecording({ ...storedEegRecording(), source: 'measured' }).source).toBe('measured');
    expect(readEegRecording({ ...storedEegRecording(), source: 'simulated' }).source).toBe('simulated');

    const { source: _source, ...unsourced } = storedEegRecording();
    expect(() => readEegRecording(unsourced)).toThrow(/source/);
    expect(() => readEegRecording({ ...storedEegRecording(), source: 'demo' })).toThrow(/source/);
  });

  it('keeps device.model for the actual headset, never simulation', () => {
    const raw = storedEegRecording();
    const simulated = readEegRecording({ ...raw, source: 'simulated' });

    expect(simulated.device.model).toBe('muse-2');
    expect(() => readEegRecording({ ...raw, device: { ...(raw.device as object), model: 'simulated' } }))
      .toThrow(/model/);
  });

  it('has no raw-sample, device-identifier or affective-state fields', () => {
    const names = propertyNames(eegRecordingWriteSchema);

    expect(names).toContain('gameSessionId');
    expect(names).toContain('mindfulness');
    expect(names.filter((name) => FORBIDDEN_FIELD.test(name))).toEqual([]);
  });

  it('refuses to write raw samples or affective labels, and never reads them back', () => {
    const raw = storedEegRecording();
    const summary = raw.summary as object;
    const cases: Record<string, unknown>[] = [
      { ...raw, rawSamples: [[1, 2, 3, 4]] },
      { ...raw, samples: [0.1, 0.2] },
      { ...raw, summary: { ...summary, valence: { mean: 0.1, median: 0.1, p10: 0, p90: 0.2, n: 5 } } },
      { ...raw, summary: { ...summary, arousal: null } },
      { ...raw, summary: { ...summary, emotion: 'calm' } },
      { ...raw, summary: { ...summary, state: 'focused' } },
      { ...raw, timeline: { ...(raw.timeline as object), valence: [0.1] } },
      { ...raw, affectiveState: 'relaxed' },
    ];

    for (const candidate of cases) {
      expect(eegRecordingWriteSchema.safeParse(candidate).success).toBe(false);
      expect(readEegRecording(candidate)).toEqual(raw);
    }
  });

  it('bounds the timeline and ties quality to the recorded channels', () => {
    const raw = storedEegRecording();
    const long = Array.from({ length: 361 }, () => 0.5);

    expect(() => readEegRecording({ ...raw, timeline: { bucketSeconds: 10, mindfulness: long, restfulness: long } }))
      .toThrow(/timeline/);
    expect(() => readEegRecording({
      ...raw,
      quality: { ...(raw.quality as object), channelGoodFraction: { Fp1: 0.9 } },
    })).toThrow(/channel/);
  });
});
