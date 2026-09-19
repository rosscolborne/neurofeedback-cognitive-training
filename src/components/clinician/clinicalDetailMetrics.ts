import type { QEEGBrainMap, SessionRecord } from '../../types';

export const DISPLAY_BANDS = ['delta', 'theta', 'alpha', 'beta'] as const;
export type DisplayBand = (typeof DISPLAY_BANDS)[number];

export interface SessionBandRow {
  id: string;
  label: string;
  bands: Record<DisplayBand, number> | null;
  issue?: string;
}

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function deriveSessionBandRows(sessions: SessionRecord[]): SessionBandRow[] {
  return sessions.slice(0, 4).reverse().map((session, index) => {
    const source = session.averageBands as unknown as Record<string, unknown> | null | undefined;
    const values = DISPLAY_BANDS.map((band) => source?.[band]);
    const missing = DISPLAY_BANDS.filter((_, bandIndex) => !isFiniteNonNegative(values[bandIndex]));

    if (missing.length > 0) {
      return {
        id: session.id || `session-${index}`,
        label: session.date || `Session ${index + 1}`,
        bands: null,
        issue: `Band power unavailable: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or invalid.`,
      };
    }

    return {
      id: session.id || `session-${index}`,
      label: session.date || `Session ${index + 1}`,
      bands: Object.fromEntries(DISPLAY_BANDS.map((band, bandIndex) => [band, values[bandIndex]])) as Record<DisplayBand, number>,
    };
  });
}

export interface LearningScorePoint {
  id: string;
  label: string;
  value: number;
}

export function deriveLearningScorePoints(sessions: SessionRecord[]): { points: LearningScorePoint[]; invalidCount: number } {
  let invalidCount = 0;
  const points = sessions.flatMap((session, index) => {
    const value = session.learningRateScore;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      invalidCount += 1;
      return [];
    }
    return [{ id: session.id || `session-${index}`, label: session.date || `Session ${index + 1}`, value }];
  });
  return { points, invalidCount };
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

export function assessQeegRecord(map: QEEGBrainMap): QeegRecordAssessment {
  const rawScores = map.zScores as unknown as Record<string, unknown> | null | undefined;
  const zScores: Partial<Record<QeegZScoreField, number>> = {};
  const issues: string[] = [];

  for (const field of QEEG_FIELDS) {
    const value = rawScores?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) zScores[field] = value;
    else issues.push(`${field} is missing or invalid`);
  }

  const dominantAlphaPeakHz = typeof map.dominantAlphaPeakHz === 'number' && Number.isFinite(map.dominantAlphaPeakHz)
    ? map.dominantAlphaPeakHz
    : null;
  if (dominantAlphaPeakHz == null) issues.push('dominant alpha peak is missing or invalid');

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
