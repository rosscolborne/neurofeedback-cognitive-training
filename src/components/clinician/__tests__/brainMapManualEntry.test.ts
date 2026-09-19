import { describe, expect, it } from 'vitest';
import { buildManualBrainMap, EMPTY_MANUAL_BRAIN_MAP } from '../brainMapManualEntry';

describe('manual QEEG entry validation and persistence shape', () => {
  it('starts with every clinical value blank and rejects incomplete entry', () => {
    expect(Object.values(EMPTY_MANUAL_BRAIN_MAP).every((value) => value === '')).toBe(true);
    const result = buildManualBrainMap(EMPTY_MANUAL_BRAIN_MAP);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });

  it('preserves entered zero values exactly in the persisted map', () => {
    const result = buildManualBrainMap({
      ...EMPTY_MANUAL_BRAIN_MAP,
      recordingDate: '2026-09-18', deviceSource: 'Clinic system',
      frontalTheta: '0', centralBeta: '-0.5', occipitalAlpha: '1.25', temporalDelta: '0', sensorimotorSMR: '2', dominantAlphaPeakHz: '9.75',
    }, new Date('2026-09-19T12:00:00.000Z'), 'q-fixed');
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
});
