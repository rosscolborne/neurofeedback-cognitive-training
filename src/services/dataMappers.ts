import type {
  ClientProfile,
  PatientInvitation,
  PersistedTimestamp,
  SessionRecord,
} from '../types';
import { inferProtocolTypeForTemplate } from './protocols';

const LEGACY_EXPERIENCE_RENAMES: Record<string, string> = {
  'spatial-audio': 'generative-music',
};

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

/** Read both current and legacy client documents without mutating Firestore data. */
export function readClientProfile(data: unknown, documentId?: string): ClientProfile {
  const raw = { ...(data as Record<string, unknown>) } as unknown as ClientProfile;
  const allowed = Array.isArray(raw.allowedExperiences)
    ? raw.allowedExperiences.map((experience) =>
        (LEGACY_EXPERIENCE_RENAMES[experience] ?? experience) as ClientProfile['allowedExperiences'][number]
      )
    : [];

  // Preserve the pre-foundation compatibility behavior for existing accounts.
  if (raw.allowedExperiences && !allowed.includes('neuro-gambit')) {
    allowed.push('neuro-gambit');
  }

  // Custom protocol IDs were historically generated as `custom-*`, so older
  // saves could incorrectly persist Theta/Beta as the broad training mode.
  // Treat the saved custom configuration as authoritative when reading those
  // records, matching the protocol catalog's existing override semantics.
  const assignedProtocol = raw.customProtocolConfig
    ? inferProtocolTypeForTemplate(raw.customProtocolConfig) ?? raw.assignedProtocol
    : raw.assignedProtocol;

  return {
    ...raw,
    id: raw.id || documentId || '',
    assignedProtocol,
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

  if (client.tidalGardenState && (session.experience === 'tidal-garden' || session.protocol === 'alpha-enhancement')) {
    client.tidalGardenState.growthPoints += Math.round(session.timeInZonePercent * 1.5);
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

  if ((client.skylineBiomesUnlocked?.length ?? 0) >= 5) addBadge('skyline-explorer');
  return client;
}
