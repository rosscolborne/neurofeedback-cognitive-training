import type { QEEGBrainMap } from '../../types';
import { timestampToMillis } from '../../services/dataMappers';

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

export type ManualBrainMapSave = (map: QEEGBrainMap) => QEEGBrainMap | void | Promise<QEEGBrainMap | void>;

export type SubmitManualBrainMapResult =
  | { ok: true; map: QEEGBrainMap }
  | { ok: false; errors: string[] };

export interface ManualBrainMapSubmissionState {
  isSaving: boolean;
  errors: string[];
}

export const INITIAL_MANUAL_BRAIN_MAP_SUBMISSION_STATE: ManualBrainMapSubmissionState = {
  isSaving: false,
  errors: [],
};

export const beginManualBrainMapSubmission = (): ManualBrainMapSubmissionState => ({ isSaving: true, errors: [] });

export function finishManualBrainMapSubmission(result: SubmitManualBrainMapResult): ManualBrainMapSubmissionState {
  return result.ok ? { isSaving: false, errors: [] } : { isSaving: false, errors: result.errors };
}

export const Z_SCORE_MIN = -10;
export const Z_SCORE_MAX = 10;
export const ALPHA_PEAK_MIN_EXCLUSIVE = 0;
export const ALPHA_PEAK_MAX = 30;

export function createManualBrainMapRequestId(): string {
  if (globalThis.crypto?.randomUUID) return `qeeg-${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `qeeg-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `qeeg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const isValidZScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= Z_SCORE_MIN && value <= Z_SCORE_MAX;

export const isValidAlphaPeak = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > ALPHA_PEAK_MIN_EXCLUSIVE && value <= ALPHA_PEAK_MAX;

export function isValidRecordingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const LEGACY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Legacy records used en-US short-month dates such as `Sep 19, 2026`; new writes remain ISO date-only. */
export function parsePersistedRecordingDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidRecordingDate(trimmed) ? trimmed : null;

  const legacy = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(trimmed);
  if (!legacy) return null;
  const monthIndex = LEGACY_MONTHS.indexOf(legacy[1] as (typeof LEGACY_MONTHS)[number]);
  const day = Number(legacy[2]);
  const year = Number(legacy[3]);
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  const isExactCalendarDate = parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === monthIndex
    && parsed.getUTCDate() === day;
  return isExactCalendarDate ? trimmed : null;
}

export function comparePersistedBrainMaps(a: unknown, b: unknown): number {
  const left = a != null && typeof a === 'object' ? a as Partial<QEEGBrainMap> : {};
  const right = b != null && typeof b === 'object' ? b as Partial<QEEGBrainMap> : {};
  const timeFor = (map: Partial<QEEGBrainMap>) => {
    const created = timestampToMillis(map.createdAt);
    if (created != null) return created;
    const uploaded = typeof map.uploadDate === 'string' ? Date.parse(map.uploadDate) : Number.NaN;
    if (Number.isFinite(uploaded)) return uploaded;
    const recorded = parsePersistedRecordingDate(map.recordingDate);
    const parsedRecorded = recorded == null ? Number.NaN : Date.parse(recorded);
    return Number.isFinite(parsedRecorded) ? parsedRecorded : 0;
  };
  const byTime = timeFor(right) - timeFor(left);
  if (byTime !== 0) return byTime;
  const leftId = typeof left.id === 'string' ? left.id : '';
  const rightId = typeof right.id === 'string' ? right.id : '';
  return leftId.localeCompare(rightId);
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
    const persisted = await onSave(built.map);
    return { ok: true, map: persisted ?? built.map };
  } catch (error) {
    const detail = error instanceof Error && error.message.trim() ? ` ${error.message.trim()}` : '';
    return { ok: false, errors: [`The QEEG record could not be saved.${detail}`] };
  }
}

export async function runManualBrainMapSubmission(
  input: ManualBrainMapInput,
  onSave: ManualBrainMapSave,
  onSuccess: (map: QEEGBrainMap) => void,
  requestId?: string,
  requestCreatedAt = new Date(),
): Promise<SubmitManualBrainMapResult> {
  const result = await submitManualBrainMap(input, onSave, requestCreatedAt, requestId);
  if (result.ok) onSuccess(result.map);
  return result;
}

export async function appendBrainMapForDisplay(
  map: QEEGBrainMap,
  append: ManualBrainMapSave | undefined,
  showPersisted: (map: QEEGBrainMap) => void,
): Promise<QEEGBrainMap> {
  if (!append) throw new Error('Authorized QEEG persistence is not configured yet. No local record was added.');
  const persisted = await append(map);
  const canonical = persisted ?? map;
  showPersisted(canonical);
  return canonical;
}

/** Returns local display state only after the authoritative append completes. */
export async function persistAndAppendBrainMap(
  map: QEEGBrainMap,
  existing: unknown,
  append: ManualBrainMapSave,
): Promise<QEEGBrainMap[]> {
  const persisted = await append(map);
  const current = Array.isArray(existing)
    ? existing.filter((entry): entry is QEEGBrainMap => entry != null && typeof entry === 'object')
    : [];
  return [persisted ?? map, ...current];
}
