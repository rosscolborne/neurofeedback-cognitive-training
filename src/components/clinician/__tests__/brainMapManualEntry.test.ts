import { describe, expect, it, vi } from 'vitest';
import { buildManualBrainMap, EMPTY_MANUAL_BRAIN_MAP, persistAndAppendBrainMap, submitManualBrainMap } from '../brainMapManualEntry';

const validInput = {
  ...EMPTY_MANUAL_BRAIN_MAP,
  recordingDate: '2026-09-18', deviceSource: 'Clinic system',
  frontalTheta: '0', centralBeta: '-0.5', occipitalAlpha: '1.25', temporalDelta: '0', sensorimotorSMR: '2', dominantAlphaPeakHz: '9.75',
};

describe('manual QEEG entry validation and persistence shape', () => {
  it('starts with every clinical value blank and rejects incomplete entry', () => {
    expect(Object.values(EMPTY_MANUAL_BRAIN_MAP).every((value) => value === '')).toBe(true);
    const result = buildManualBrainMap(EMPTY_MANUAL_BRAIN_MAP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });

  it('preserves entered zero values exactly in the persisted map', () => {
    const result = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-fixed');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map).toMatchObject({
        id: 'q-fixed', uploadDate: '2026-09-19T12:00:00.000Z', recordingDate: '2026-09-18', deviceSource: 'Clinic system', fileName: '',
        zScores: { frontalTheta: 0, centralBeta: -0.5, occipitalAlpha: 1.25, temporalDelta: 0, sensorimotorSMR: 2 }, dominantAlphaPeakHz: 9.75,
      });
    }
  });

  it('rejects non-finite and out-of-bound clinical values', () => {
    const result = buildManualBrainMap({
      ...EMPTY_MANUAL_BRAIN_MAP,
      recordingDate: '2026-09-18', deviceSource: 'Clinic system',
      frontalTheta: 'Infinity', centralBeta: '-11', occipitalAlpha: '0', temporalDelta: '0', sensorimotorSMR: '0', dominantAlphaPeakHz: '0',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(buildManualBrainMap({ ...validInput, recordingDate: '2026-02-30' }).ok).toBe(false);
  });

  it('reports success only after async persistence succeeds', async () => {
    const persisted: unknown[] = [];
    const save = vi.fn(async (map) => { persisted.push(map); });
    const result = await submitManualBrainMap(validInput, save, new Date('2026-09-19T12:00:00.000Z'), 'q-persisted');
    expect(result.ok).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: 'q-persisted', zScores: { frontalTheta: 0 } });
  });

  it('keeps the record unsaved and exposes persistence failure for retry', async () => {
    const save = vi.fn(async () => { throw new Error('permission denied'); });
    const result = await submitManualBrainMap(validInput, save);
    expect(result).toEqual({ ok: false, errors: ['The QEEG record could not be saved. permission denied'] });
    expect(save).toHaveBeenCalledOnce();
  });

  it('updates reloadable local state only after authoritative persistence', async () => {
    const built = buildManualBrainMap(validInput, new Date('2026-09-19T12:00:00.000Z'), 'q-new');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const existing = [{ ...built.map, id: 'q-existing' }];
    const saved = await persistAndAppendBrainMap(built.map, existing, vi.fn(async () => undefined));
    expect(saved.map((map) => map.id)).toEqual(['q-new', 'q-existing']);

    await expect(persistAndAppendBrainMap(built.map, existing, vi.fn(async () => { throw new Error('offline'); }))).rejects.toThrow('offline');
    expect(existing.map((map) => map.id)).toEqual(['q-existing']);
  });
});
