import { describe, expect, it } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../types';
import {
  applySessionCompletionToClient,
  readClientProfile,
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

const sessionFixture = (): SessionRecord => ({
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
    expect(client.completedSessionsCount).toBe(0);
    expect(client.badges).toEqual([]);
  });
});
