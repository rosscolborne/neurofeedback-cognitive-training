import type { QEEGBrainMap } from '../../types';

export interface ManualBrainMapInput {
  recordingDate: string;
  deviceSource: string;
  technicianNotes: string;
  frontalTheta: string;
  centralBeta: string;
  occipitalAlpha: string;
  temporalDelta: string;
  sensorimotorSMR: string;
  dominantAlphaPeakHz: string;
}

export const EMPTY_MANUAL_BRAIN_MAP: ManualBrainMapInput = {
  recordingDate: '',
  deviceSource: '',
  technicianNotes: '',
  frontalTheta: '',
  centralBeta: '',
  occipitalAlpha: '',
  temporalDelta: '',
  sensorimotorSMR: '',
  dominantAlphaPeakHz: '',
};

type BuildResult = { ok: true; map: QEEGBrainMap } | { ok: false; errors: string[] };

const Z_SCORE_FIELDS = [
  ['frontalTheta', 'Frontal theta Z-score'],
  ['centralBeta', 'Central beta Z-score'],
  ['occipitalAlpha', 'Occipital alpha Z-score'],
  ['temporalDelta', 'Temporal delta Z-score'],
  ['sensorimotorSMR', 'Sensorimotor SMR Z-score'],
] as const;

export function buildManualBrainMap(input: ManualBrainMapInput, now = new Date(), id = `qeeg-${now.getTime()}`): BuildResult {
  const errors: string[] = [];
  if (!input.recordingDate) errors.push('Recording date is required.');
  if (!input.deviceSource.trim()) errors.push('Acquisition device/source is required.');

  const scores: Partial<QEEGBrainMap['zScores']> = {};
  for (const [field, label] of Z_SCORE_FIELDS) {
    const value = input[field].trim() === '' ? Number.NaN : Number(input[field]);
    if (!Number.isFinite(value) || value < -10 || value > 10) errors.push(`${label} must be between -10 and 10.`);
    else scores[field] = value;
  }

  const alphaPeak = input.dominantAlphaPeakHz.trim() === '' ? Number.NaN : Number(input.dominantAlphaPeakHz);
  if (!Number.isFinite(alphaPeak) || alphaPeak <= 0 || alphaPeak > 30) {
    errors.push('Dominant alpha peak must be greater than 0 and no more than 30 Hz.');
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    map: {
      id,
      uploadDate: now.toISOString(),
      fileName: '',
      recordingDate: input.recordingDate,
      deviceSource: input.deviceSource.trim(),
      technicianNotes: input.technicianNotes.trim(),
      zScores: scores as QEEGBrainMap['zScores'],
      dominantAlphaPeakHz: alphaPeak,
    },
  };
}
