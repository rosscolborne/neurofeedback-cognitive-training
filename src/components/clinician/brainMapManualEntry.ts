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

export type ManualBrainMapSave = (map: QEEGBrainMap) => void | Promise<void>;

export type SubmitManualBrainMapResult =
  | { ok: true; map: QEEGBrainMap }
  | { ok: false; errors: string[] };

export const Z_SCORE_MIN = -10;
export const Z_SCORE_MAX = 10;
export const ALPHA_PEAK_MIN_EXCLUSIVE = 0;
export const ALPHA_PEAK_MAX = 30;

export const isValidZScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= Z_SCORE_MIN && value <= Z_SCORE_MAX;

export const isValidAlphaPeak = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > ALPHA_PEAK_MIN_EXCLUSIVE && value <= ALPHA_PEAK_MAX;

export function isValidRecordingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const Z_SCORE_FIELDS = [
  ['frontalTheta', 'Frontal theta Z-score'],
  ['centralBeta', 'Central beta Z-score'],
  ['occipitalAlpha', 'Occipital alpha Z-score'],
  ['temporalDelta', 'Temporal delta Z-score'],
  ['sensorimotorSMR', 'Sensorimotor SMR Z-score'],
] as const;

export function buildManualBrainMap(input: ManualBrainMapInput, now = new Date(), id = `qeeg-${now.getTime()}`): BuildResult {
  const errors: string[] = [];
  if (!isValidRecordingDate(input.recordingDate)) errors.push('A valid recording date is required.');
  if (!input.deviceSource.trim()) errors.push('Acquisition device/source is required.');

  const scores: Partial<QEEGBrainMap['zScores']> = {};
  for (const [field, label] of Z_SCORE_FIELDS) {
    const value = input[field].trim() === '' ? Number.NaN : Number(input[field]);
    if (!isValidZScore(value)) errors.push(`${label} must be between ${Z_SCORE_MIN} and ${Z_SCORE_MAX}.`);
    else scores[field] = value;
  }

  const alphaPeak = input.dominantAlphaPeakHz.trim() === '' ? Number.NaN : Number(input.dominantAlphaPeakHz);
  if (!isValidAlphaPeak(alphaPeak)) {
    errors.push(`Dominant alpha peak must be greater than ${ALPHA_PEAK_MIN_EXCLUSIVE} and no more than ${ALPHA_PEAK_MAX} Hz.`);
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

export async function submitManualBrainMap(
  input: ManualBrainMapInput,
  onSave: ManualBrainMapSave,
  now = new Date(),
  id?: string,
): Promise<SubmitManualBrainMapResult> {
  const built = buildManualBrainMap(input, now, id ?? `qeeg-${now.getTime()}`);
  if (!built.ok) return built;

  try {
    await onSave(built.map);
    return built;
  } catch (error) {
    const detail = error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : '';
    return { ok: false, errors: [`The QEEG record could not be saved.${detail}`] };
  }
}

/** Returns local display state only after the authoritative append completes. */
export async function persistAndAppendBrainMap(
  map: QEEGBrainMap,
  existing: unknown,
  append: ManualBrainMapSave,
): Promise<QEEGBrainMap[]> {
  await append(map);
  const current = Array.isArray(existing)
    ? existing.filter((entry): entry is QEEGBrainMap => entry != null && typeof entry === 'object')
    : [];
  return [map, ...current];
}
