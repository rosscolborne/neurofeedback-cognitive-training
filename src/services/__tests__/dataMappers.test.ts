import { describe, expect, it } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../types';
import {
  applySessionCompletionToClient,
  getPatientClinicianId,
  isPatientInvitationExpired,
  readClientProfile,
  readPatientInvitation,
  readSessionRecord,
  removeUndefined,
  timestampToIso,
  timestampToMillis,
} from '../dataMappers';
import { CLINICAL_PROTOCOL_TEMPLATES } from '../clinicalProtocolTemplates';

const clientFixture = (): ClientProfile => ({
  id: 'patient-1',
  name: 'Patient One',
  email: 'patient@example.test',
  avatarUrl: '',
  condition: 'Peak Performance',
  status: 'active',
  assignedProtocol: 'theta-beta-ratio',
  brainMaps: [],
  allowedExperiences: ['skyline-drift'],
  prescribedSessionsPerWeek: 4,
  completedSessionsCount: 0,
  currentStreak: 0,
  streakFreezeRemaining: 0,
  brainCapacityScore: 0,
  lastSessionDate: '',
  nextSessionDate: '',
  tidalGardenState: { stage: 1, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [],
  badges: [],
});

const sessionFixture = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1',
  patientId: 'patient-1',
  patientName: 'Patient One',
  clinicId: 'clinic-1',
  clinicianId: 'clinician-1',
  date: 'Sep 15, 2026',
  timestamp: 1_789_493_400_000,
  protocol: 'theta-beta-ratio',
  experience: 'skyline-drift',
  durationSeconds: 1_500,
  timeInZonePercent: 82,
  averageCoherence: null,
  peakFocusScore: 70,
  averageBands: { delta: 1, theta: 2, alpha: 3, smr: 4, beta: 5, gamma: 6 },
  timeSeries: [],
  adaptiveAdjustmentsCount: 0,
  finalThreshold: 1.8,
  ...overrides,
});

describe('production data migration readers', () => {
  it('normalizes every supported persisted timestamp representation', () => {
    expect(timestampToMillis('2026-09-15T12:00:00.000Z')).toBe(1_789_473_600_000);
    expect(timestampToMillis(new Date('2026-09-15T12:00:00.000Z'))).toBe(1_789_473_600_000);
    expect(timestampToMillis({ seconds: 1_789_473_600, nanoseconds: 500_000_000 })).toBe(1_789_473_600_500);
    expect(timestampToIso({ seconds: 1_789_473_600 })).toBe('2026-09-15T12:00:00.000Z');
    expect(timestampToMillis('not-a-date')).toBeNull();
  });

  it('reads legacy client experience names without mutating the document', () => {
    const legacy = { ...clientFixture(), id: undefined, allowedExperiences: ['spatial-audio'] };
    const migrated = readClientProfile(legacy, 'document-patient');

    expect(migrated.id).toBe('document-patient');
    expect(migrated.allowedExperiences).toEqual(['generative-music', 'neuro-gambit']);
    expect(legacy.allowedExperiences).toEqual(['spatial-audio']);
    expect(migrated.schemaVersion).toBe(1);
  });

  it('preserves and resolves legacy clinician relationship fields', () => {
    const legacy = { ...clientFixture(), clinicianId: undefined, linkedClinicianCode: 'legacy-clinician' };
    const migrated = readClientProfile(legacy);

    expect(migrated.linkedClinicianCode).toBe('legacy-clinician');
    expect(migrated.clinicianId).toBeUndefined();
    expect(getPatientClinicianId(migrated)).toBe('legacy-clinician');
    expect(getPatientClinicianId({ clinicianId: 'canonical', linkedClinicianCode: 'legacy' })).toBe('canonical');
  });

  it('marks current expired invitations while tolerating legacy invitations without expiry', () => {
    const expired = readPatientInvitation({
      clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending', expiresAt: 99,
    }, 'CODE', 100);
    const legacy = readPatientInvitation({
      clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending',
    }, 'LEGACY', 100);
    const canonical = readPatientInvitation({
      clinicianId: 'clinician-1', clinicId: ' clinic-1 ', patientEmail: 'patient@example.com', status: 'pending',
    }, 'CANONICAL', 100);

    expect(expired.status).toBe('expired');
    expect(isPatientInvitationExpired(expired, 100)).toBe(true);
    expect(legacy.status).toBe('pending');
    expect(legacy.clinicId).toBeUndefined();
    expect(canonical.clinicId).toBe('clinic-1');
    expect(legacy.schemaVersion).toBe(1);
  });

  it('repairs the broad mode for legacy custom protocol records on read', () => {
    const sterman = CLINICAL_PROTOCOL_TEMPLATES.find((template) => template.id === 'proto-sterman-smr');
    expect(sterman).toBeDefined();

    const legacy = {
      ...clientFixture(),
      assignedProtocol: 'theta-beta-ratio' as const,
      customProtocolConfig: {
        ...sterman!,
        id: 'custom-legacy',
        protocolType: undefined,
      },
    };

    const migrated = readClientProfile(legacy);

    expect(migrated.assignedProtocol).toBe('smr-enhancement');
    expect(legacy.assignedProtocol).toBe('theta-beta-ratio');
  });

  it('does not invent a protocol for an incomplete unrecognized custom template', () => {
    const raw = {
      ...clientFixture(),
      assignedProtocol: undefined,
      customProtocolConfig: {
        id: 'legacy-unknown',
        name: '',
        clinicalName: '',
      },
    };

    expect(readClientProfile(raw).assignedProtocol).toBeUndefined();
  });

  it('prefers completedAt over legacy epoch timestamps and fills safe collection defaults', () => {
    const migrated = readSessionRecord({
      ...sessionFixture(),
      id: undefined,
      timestamp: 1,
      completedAt: { seconds: 1_789_473_600 },
      timeSeries: undefined,
      averageCoherence: undefined,
    }, 'document-session');

    expect(migrated.id).toBe('document-session');
    expect(migrated.timestamp).toBe(1_789_473_600_000);
    expect(migrated.timeSeries).toEqual([]);
    expect(migrated.averageCoherence).toBeNull();
  });

  it('removes nested undefined values without damaging Dates or timestamp sentinels', () => {
    const date = new Date('2026-09-15T12:00:00.000Z');
    const sentinel = Object.create({ firestoreSentinel: true }) as { value?: string };
    const cleaned = removeUndefined({ a: undefined, nested: { keep: 1, drop: undefined }, date, sentinel });

    expect(cleaned).toEqual({ nested: { keep: 1 }, date, sentinel });
    expect(cleaned.date).toBe(date);
    expect(cleaned.sentinel).toBe(sentinel);
  });
});

describe('session aggregate migration behavior', () => {
  it('returns a new profile and leaves the source profile untouched', () => {
    const client = clientFixture();
    const updated = applySessionCompletionToClient(client, sessionFixture());

    expect(updated).not.toBe(client);
    expect(updated.completedSessionsCount).toBe(1);
    expect(updated.badges).toContain('first-light');
    expect(updated.badges).toContain('deep-focus');
    expect(updated.brainCapacityScore).toBe(client.brainCapacityScore);
    expect(client.completedSessionsCount).toBe(0);
    expect(client.badges).toEqual([]);
  });

  it('does not invent score, streak, or garden state for a blank profile', () => {
    const blank = {
      ...clientFixture(),
      brainCapacityScore: undefined,
      currentStreak: 0,
      tidalGardenState: undefined,
      skylineBiomesUnlocked: undefined,
    };
    const updated = applySessionCompletionToClient(blank, sessionFixture({ experience: 'tidal-garden' }));

    expect(updated.brainCapacityScore).toBeUndefined();
    expect(updated.currentStreak).toBe(0);
    expect(updated.tidalGardenState).toBeUndefined();
    expect(updated.skylineBiomesUnlocked).toBeUndefined();
  });
});
