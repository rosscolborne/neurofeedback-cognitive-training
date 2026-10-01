import type {
  ClientProfile,
  IndividualBaselineModel,
  PatientInvitation,
  PersistedTimestamp,
  SessionRecord,
} from '../types';
import { inferProtocolTypeForTemplate } from './protocols';
import { DEFAULT_ALLOWED_EXPERIENCES } from './experienceIds';

export function timestampToMillis(value: PersistedTimestamp | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  return Number.isFinite(value.seconds) ? value.seconds * 1000 + (value.nanoseconds ?? 0) / 1e6 : null;
}

export function timestampToIso(value: PersistedTimestamp | null | undefined): string | null {
  const millis = timestampToMillis(value);
  return millis == null ? null : new Date(millis).toISOString();
}

export type CalibrationDisplayState = {
  status: 'valid' | 'expired' | 'invalid' | 'not-calibrated';
  calibratedAt: number | null;
  expiresAt: number | null;
};

/** Inspect legacy and current records without changing the saved calibration. */
export function getCalibrationDisplayState(model: unknown, now = Date.now()): CalibrationDisplayState {
  if (model == null) return { status: 'not-calibrated', calibratedAt: null, expiresAt: null };
  if (typeof model !== 'object' || Array.isArray(model)) return { status: 'invalid', calibratedAt: null, expiresAt: null };
  const value = model as Record<string, unknown>;
  const calibratedAt = typeof value.lastCalibratedAt === 'string'
    ? timestampToMillis(value.lastCalibratedAt) : null;
  let expiresAt: number | null = null;
  if (value.expiresAt != null) {
    try { expiresAt = timestampToMillis(value.expiresAt as PersistedTimestamp); } catch { /* Malformed legacy timestamp. */ }
  }
  const isNeuroGambitCalibration = value.algorithmVersion === 'neurogambit-15s-v1';
  const numericValuesAreValid = isNeuroGambitCalibration
    ? Number.isFinite(value.thetaMean) && Number.isFinite(value.betaMean) && Number.isFinite(value.alphaMean)
      && (value.thetaStd == null || Number.isFinite(value.thetaStd))
      && (value.betaStd == null || Number.isFinite(value.betaStd))
      && (value.alphaStd == null || Number.isFinite(value.alphaStd))
    : Number.isFinite(value.alphaPeakHz)
      && Number.isFinite(value.oneOverFSlope)
      && (value.alphaPeakHz as number) > 0
      && (value.oneOverFSlope as number) > 0;
  const validStatus = value.status == null || value.status === 'valid';
  if (value.status === 'expired' || (expiresAt != null && expiresAt <= now)) {
    return { status: 'expired', calibratedAt, expiresAt };
  }
  if (!validStatus || !numericValuesAreValid || calibratedAt == null || (value.expiresAt != null && expiresAt == null)) {
    return { status: 'invalid', calibratedAt, expiresAt };
  }
  return { status: 'valid', calibratedAt, expiresAt };
}

export function getReusableBaselineModel(model: unknown, now = Date.now()): IndividualBaselineModel | null {
  return getCalibrationDisplayState(model, now).status === 'valid' ? model as IndividualBaselineModel : null;
}

/** Read both current and legacy client documents without mutating Firestore data. */
export function readClientProfile(data: unknown, documentId?: string): ClientProfile {
  const raw = { ...(data as Record<string, unknown>) } as unknown as ClientProfile;
  // A missing legacy field retains the former open catalogue. A present empty
  // list is an intentional assignment of no experiences.
  const allowed = Array.isArray(raw.allowedExperiences)
    ? [...raw.allowedExperiences]
    : Object.prototype.hasOwnProperty.call(raw, 'allowedExperiences') ? [] : [...DEFAULT_ALLOWED_EXPERIENCES];

  // Custom protocol IDs were historically generated as `custom-*`, so older
  // saves could incorrectly persist Theta/Beta as the broad training mode.
  // Treat the saved custom configuration as authoritative when reading those
  // records, matching the protocol catalog's existing override semantics.
  const assignedProtocol = raw.customProtocolConfig
    ? inferProtocolTypeForTemplate(raw.customProtocolConfig) ?? raw.assignedProtocol
    : raw.assignedProtocol;
  const savedConfig = raw.customProtocolConfig;
  // Older merged saves could retain a ratio rule after switching to a
  // single-band protocol or explicitly disabling custom rewards.
  const knownMergedRatioResidue = Boolean(savedConfig?.ratioReward && (
    savedConfig.customRewardEnabled === false
    || (savedConfig.customRewardEnabled === true
      && (assignedProtocol === 'smr-enhancement' || assignedProtocol === 'alpha-enhancement' || assignedProtocol === 'beta-downtraining'))
  ));
  const customProtocolConfig = knownMergedRatioResidue && savedConfig ? { ...savedConfig } : savedConfig;
  if (knownMergedRatioResidue && customProtocolConfig) delete customProtocolConfig.ratioReward;

  return {
    ...raw,
    id: raw.id || documentId || '',
    assignedProtocol,
    customProtocolConfig,
    allowedExperiences: [...new Set(allowed)],
    brainMaps: Array.isArray(raw.brainMaps) ? raw.brainMaps : [],
    badges: Array.isArray(raw.badges) ? raw.badges : [],
    schemaVersion: raw.schemaVersion ?? 1,
  };
}

/** Return the canonical owner while retaining legacy link fields on the profile itself. */
export function getPatientClinicianId(profile: Pick<ClientProfile, 'clinicianId' | 'linkedClinicianCode'>): string | undefined {
  return profile.clinicianId || profile.linkedClinicianCode;
}

export function isPatientInvitationExpired(
  invitation: Pick<PatientInvitation, 'expiresAt'>,
  now = Date.now()
): boolean {
  const expiresAt = timestampToMillis(invitation.expiresAt);
  return expiresAt != null && expiresAt <= now;
}

/** Read current and pre-expiry invitation documents without rewriting them. */
export function readPatientInvitation(
  data: unknown,
  documentId: string,
  now = Date.now()
): PatientInvitation {
  const raw = { ...(data as Record<string, unknown>) } as unknown as PatientInvitation;
  const invitation: PatientInvitation = {
    ...raw,
    id: raw.id || documentId,
    clinicId: typeof raw.clinicId === 'string' && raw.clinicId.trim() ? raw.clinicId.trim() : undefined,
    clinicianName: raw.clinicianName ?? '',
    patientName: raw.patientName ?? '',
    schemaVersion: raw.schemaVersion ?? 1,
  };
  if (invitation.status === 'pending' && isPatientInvitationExpired(invitation, now)) {
    return { ...invitation, status: 'expired' };
  }
  return invitation;
}

/** Normalize Firestore Timestamp fields while retaining legacy numeric timestamps for the UI. */
export function readSessionRecord(data: unknown, documentId?: string): SessionRecord {
  const raw = { ...(data as Record<string, unknown>) } as unknown as SessionRecord;
  const completedAtMillis = timestampToMillis(raw.completedAt);
  const createdAtMillis = timestampToMillis(raw.createdAt);
  const legacyTimestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : null;

  return {
    ...raw,
    id: raw.id || documentId || '',
    timestamp: completedAtMillis ?? legacyTimestamp ?? createdAtMillis ?? 0,
    averageCoherence: raw.averageCoherence ?? null,
    timeSeries: Array.isArray(raw.timeSeries) ? raw.timeSeries : [],
    schemaVersion: raw.schemaVersion ?? 1,
  };
}

/** Firestore rejects undefined values, including nested ones. */
export function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefined(item)) as T;
  }
  if (value instanceof Date || value === null || typeof value !== 'object') {
    return value;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, removeUndefined(entry)])
  ) as T;
}

/** Whole Garden XP earned from verified time against the prescribed runtime. */
export function getTidalGardenSessionXp(
  inZoneSeconds: number,
  configuredDurationSeconds: number,
  elapsedSeconds: number,
): number {
  if (!Number.isFinite(inZoneSeconds) || !Number.isFinite(configuredDurationSeconds)
    || !Number.isFinite(elapsedSeconds) || configuredDurationSeconds <= 0) return 0;
  const rewardableSeconds = Math.max(0, Math.min(inZoneSeconds, configuredDurationSeconds, elapsedSeconds));
  return Math.floor((150 * rewardableSeconds) / configuredDurationSeconds);
}

/** Legacy aggregate behavior, made pure so it can be applied atomically and tested. */
export function applySessionCompletionToClient(
  current: ClientProfile,
  session: SessionRecord
): ClientProfile {
  const client: ClientProfile = {
    ...current,
    badges: [...(current.badges ?? [])],
    ...(current.skylineBiomesUnlocked
      ? { skylineBiomesUnlocked: [...current.skylineBiomesUnlocked] }
      : {}),
    ...(current.tidalGardenState
      ? { tidalGardenState: {
          ...current.tidalGardenState,
          plantsUnlocked: [...current.tidalGardenState.plantsUnlocked],
        } }
      : {}),
    recentCompletedSessionIds: [
      session.id,
      ...(current.recentCompletedSessionIds ?? []).filter((id) => id !== session.id),
    ].slice(0, 100),
  };

  client.completedSessionsCount = (client.completedSessionsCount || 0) + 1;
  client.lastSessionDate = new Date(session.timestamp).toISOString();

  const addBadge = (badge: string) => {
    if (!client.badges.includes(badge)) client.badges.push(badge);
  };

  if (client.completedSessionsCount >= 1) addBadge('first-light');
  if (session.protocol === 'theta-beta-ratio' && session.timeInZonePercent >= 80) addBadge('deep-focus');
  if (
    session.protocol === 'alpha-enhancement' &&
    session.durationSeconds >= 900 &&
    session.timeInZonePercent >= 60
  ) addBadge('still-waters');

  if (client.tidalGardenState && session.protocol === 'alpha-enhancement') {
    const earnedXp = session.inZoneSeconds !== undefined && session.configuredDurationSeconds !== undefined
      ? getTidalGardenSessionXp(session.inZoneSeconds, session.configuredDurationSeconds, session.durationSeconds)
      : session.inZoneSeconds === undefined && session.configuredDurationSeconds === undefined
        ? Math.round((typeof session.timeInZonePercent === 'number' && Number.isFinite(session.timeInZonePercent)
          ? Math.max(0, Math.min(100, session.timeInZonePercent)) : 0) * 1.5)
        : 0;
    client.tidalGardenState.growthPoints += earnedXp;
    if (client.tidalGardenState.growthPoints > 300 && client.tidalGardenState.stage < 2) {
      client.tidalGardenState.stage = 2;
    }
    if (client.tidalGardenState.growthPoints > 500 && client.tidalGardenState.stage < 3) {
      client.tidalGardenState.stage = 3;
    }
    if (client.tidalGardenState.growthPoints > 800 && client.tidalGardenState.stage < 4) {
      client.tidalGardenState.stage = 4;
    }
    if (client.tidalGardenState.stage >= 3) addBadge('garden-keeper');
  }

  return client;
}
