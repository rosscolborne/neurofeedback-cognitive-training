import { describe, expect, it } from 'vitest';
import type { QEEGBrainMap, SessionRecord } from '../../../types';
import { assessQeegRecord, deriveLearningScorePoints, deriveSessionBandRows, formatSigned, getSessionContentState } from '../clinicalDetailMetrics';

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1', patientId: 'p1', patientName: 'Patient', clinicId: 'c1', date: 'Sep 19, 2026', timestamp: 1,
  protocol: 'theta-beta-ratio', experience: 'skyline-drift', durationSeconds: 60, timeInZonePercent: 0,
  averageCoherence: null, peakFocusScore: 0,
  averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
  metricProvenance: { averageBands: { algorithm: 'welch-psd', version: '1', source: 'brainflow' } },
  timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0, ...overrides,
});

describe('clinical detail metric boundaries', () => {
  it('preserves legitimate zero band powers and learning scores', () => {
    expect(deriveSessionBandRows([session()])[0].bands).toEqual({ delta: 0, theta: 0, alpha: 0, beta: 0 });
    expect(deriveLearningScorePoints([session({ learningRateScore: 0 })])).toEqual({
      points: [{ id: 's1', label: 'Sep 19, 2026', value: 0, timestamp: 1 }], invalidCount: 0, invalidDateCount: 0,
    });
    expect(formatSigned(0)).toBe('+0');
  });

  it('identifies partial or malformed session metrics without substituting data', () => {
    const partial = session({ averageBands: { delta: 1, theta: Number.NaN } as SessionRecord['averageBands'] });
    const row = deriveSessionBandRows([partial])[0];
    expect(row.bands).toBeNull();
    expect(row.issue).toContain('theta');
    expect(row.issue).toContain('alpha');
    expect(deriveLearningScorePoints([session({ learningRateScore: 101 }), session({ id: 's2', learningRateScore: undefined })])).toEqual({ points: [], invalidCount: 2, invalidDateCount: 0 });
  });

  it('withholds band values without measured provenance, including zero sentinels', () => {
    const row = deriveSessionBandRows([session({ metricProvenance: undefined })])[0];
    expect(row.bands).toBeNull();
    expect(row.issue).toContain('provenance');
  });

  it('sorts learning points oldest-to-newest and rejects invalid dates', () => {
    const result = deriveLearningScorePoints([
      session({ id: 'newest', timestamp: 300, date: 'Sep 20, 2026', learningRateScore: 30 }),
      session({ id: 'timestamp-only', timestamp: 250, date: 'bad-but-timestamp-valid', learningRateScore: 25 }),
      session({ id: 'invalid', timestamp: 0, date: 'not-a-date', learningRateScore: 20 }),
      session({ id: 'oldest', timestamp: 100, date: 'Sep 18, 2026', learningRateScore: 10 }),
      session({ id: 'middle', timestamp: 200, date: 'Sep 19, 2026', learningRateScore: 0 }),
    ]);
    expect(result.points.map((point) => point.id)).toEqual(['oldest', 'middle', 'timestamp-only', 'newest']);
    expect(result.points.find((point) => point.id === 'timestamp-only')?.label).not.toBe('bad-but-timestamp-valid');
    expect(result.invalidDateCount).toBe(1);
  });

  it('models detail loading, error, empty, and data states', () => {
    expect(getSessionContentState('loading', [])).toBe('loading');
    expect(getSessionContentState('error', [])).toBe('error');
    expect(getSessionContentState('ready', [])).toBe('empty');
    expect(getSessionContentState('ready', [session()])).toBe('data');
  });

  it('assesses complete, partial, and malformed QEEG records while preserving zeros', () => {
    const complete: QEEGBrainMap = {
      id: 'q1', uploadDate: '2026-09-19', fileName: '', recordingDate: '2026-09-18', deviceSource: 'Manual', technicianNotes: '',
      zScores: { frontalTheta: 0, centralBeta: -1, occipitalAlpha: 2, temporalDelta: 0, sensorimotorSMR: 1 }, dominantAlphaPeakHz: 10,
    };
    expect(assessQeegRecord(complete)).toMatchObject({ status: 'complete', dominantAlphaPeakHz: 10 });
    expect(assessQeegRecord({ ...complete, zScores: { frontalTheta: 0 } as QEEGBrainMap['zScores'] }).status).toBe('partial');
    expect(assessQeegRecord({ ...complete, zScores: undefined as unknown as QEEGBrainMap['zScores'], dominantAlphaPeakHz: Number.NaN }).status).toBe('malformed');
    const outOfRange = assessQeegRecord({ ...complete, recordingDate: 'bad-date', zScores: { ...complete.zScores, frontalTheta: 11 }, dominantAlphaPeakHz: 31 });
    expect(outOfRange).toMatchObject({ status: 'partial', dominantAlphaPeakHz: null });
    expect(outOfRange.zScores.frontalTheta).toBeUndefined();
    expect(assessQeegRecord(null).status).toBe('malformed');
  });
});
