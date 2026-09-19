import type { QEEGBrainMap, SessionRecord } from '../../types';
import { isValidAlphaPeak, isValidRecordingDate, isValidZScore } from './brainMapManualEntry';

export const DISPLAY_BANDS = ['delta', 'theta', 'alpha', 'beta'] as const;
export type DisplayBand = (typeof DISPLAY_BANDS)[number];

export interface SessionBandRow {
  id: string;
  label: string;
  bands: Record<DisplayBand, number> | null;
  issue?: string;
}

export type SessionLoadState = 'loading' | 'ready' | 'error';
export type SessionContentState = 'loading' | 'error' | 'empty' | 'data';

export function getSessionContentState(loadState: SessionLoadState, sessions: SessionRecord[]): SessionContentState {
  if (loadState === 'loading') return 'loading';
  if (loadState === 'error') return 'error';
  return sessions.length > 0 ? 'data' : 'empty';
}

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function deriveSessionBandRows(sessions: SessionRecord[]): SessionBandRow[] {
  return sessions.slice(0, 4).reverse().map((session, index) => {
    const source = session.averageBands as unknown as Record<string, unknown> | null | undefined;
    const provenance = session.metricProvenance?.averageBands;
    const hasMeasuredProvenance = provenance != null
      && provenance.source !== 'legacy'
      && typeof provenance.algorithm === 'string'
      && provenance.algorithm.trim().length > 0
      && typeof provenance.version === 'string'
      && provenance.version.trim().length > 0;
    if (!hasMeasuredProvenance) {
      return {
        id: session.id || `session-${index}`,
        label: normalizeSessionLabel(session),
        bands: null,
        issue: 'Band power unavailable: measured-value provenance is missing or unverified.',
      };
    }
    const values = DISPLAY_BANDS.map((band) => source?.[band]);
    const missing = DISPLAY_BANDS.filter((_, bandIndex) => !isFiniteNonNegative(values[bandIndex]));

    if (missing.length > 0) {
      return {
        id: session.id || `session-${index}`,
        label: normalizeSessionLabel(session),
        bands: null,
        issue: `Band power unavailable: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or invalid.`,
      };
    }

    return {
      id: session.id || `session-${index}`,
      label: normalizeSessionLabel(session),
      bands: Object.fromEntries(DISPLAY_BANDS.map((band, bandIndex) => [band, values[bandIndex]])) as Record<DisplayBand, number>,
    };
  });
}

export interface LearningScorePoint {
  id: string;
  label: string;
  value: number;
  timestamp: number;
}

export function normalizeSessionTimestamp(session: SessionRecord): number | null {
  if (typeof session.timestamp === 'number' && Number.isFinite(session.timestamp) && session.timestamp > 0) return session.timestamp;
  if (typeof session.date !== 'string' || !session.date.trim()) return null;
  const parsed = Date.parse(session.date);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSessionLabel(session: SessionRecord): string {
  if (typeof session.date === 'string' && session.date.trim() && Number.isFinite(Date.parse(session.date))) return session.date;
  const timestamp = normalizeSessionTimestamp(session);
  return timestamp == null ? 'Date unavailable' : new Date(timestamp).toLocaleDateString();
}

export function deriveLearningScorePoints(sessions: SessionRecord[]): { points: LearningScorePoint[]; invalidCount: number; invalidDateCount: number } {
  let invalidCount = 0;
  let invalidDateCount = 0;
  const points = sessions.flatMap((session, index) => {
    const value = session.learningRateScore;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      invalidCount += 1;
      return [];
    }
    const timestamp = normalizeSessionTimestamp(session);
    if (timestamp == null) {
      invalidDateCount += 1;
      return [];
    }
    return [{ id: session.id || `session-${index}`, label: normalizeSessionLabel(session), value, timestamp }];
  }).sort((a, b) => a.timestamp - b.timestamp);
  return { points, invalidCount, invalidDateCount };
}

export const QEEG_FIELDS = [
  'frontalTheta',
  'centralBeta',
  'occipitalAlpha',
  'temporalDelta',
  'sensorimotorSMR',
] as const;

export type QeegZScoreField = (typeof QEEG_FIELDS)[number];

export interface QeegRecordAssessment {
  status: 'complete' | 'partial' | 'malformed';
  zScores: Partial<Record<QeegZScoreField, number>>;
  dominantAlphaPeakHz: number | null;
  issues: string[];
}

export function assessQeegRecord(value: unknown): QeegRecordAssessment {
  const map = value != null && typeof value === 'object' ? value as Partial<QEEGBrainMap> : {};
  const rawScores = map.zScores as unknown as Record<string, unknown> | null | undefined;
  const zScores: Partial<Record<QeegZScoreField, number>> = {};
  const issues: string[] = [];

  for (const field of QEEG_FIELDS) {
    const value = rawScores?.[field];
    if (isValidZScore(value)) zScores[field] = value;
    else issues.push(`${field} is missing, invalid, or out of range`);
  }

  const dominantAlphaPeakHz = isValidAlphaPeak(map.dominantAlphaPeakHz)
    ? map.dominantAlphaPeakHz
    : null;
  if (dominantAlphaPeakHz == null) issues.push('dominant alpha peak is missing, invalid, or out of range');
  if (typeof map.deviceSource !== 'string' || !map.deviceSource.trim()) issues.push('acquisition source is missing');
  if (!isValidRecordingDate(map.recordingDate)) issues.push('recording date is missing or invalid');

  const presentCount = Object.keys(zScores).length + (dominantAlphaPeakHz == null ? 0 : 1);
  return {
    status: presentCount === 0 ? 'malformed' : issues.length > 0 ? 'partial' : 'complete',
    zScores,
    dominantAlphaPeakHz,
    issues,
  };
}

export function formatSigned(value: number | undefined): string {
  if (value == null) return 'Unavailable';
  return `${value >= 0 ? '+' : ''}${value}`;
}

export function finiteMetric(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : 'Unavailable';
}
