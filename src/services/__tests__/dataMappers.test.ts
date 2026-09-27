import { describe, expect, it } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../types';
import {
  applySessionCompletionToClient,
  getCalibrationDisplayState,
  getReusableBaselineModel,
  getPatientClinicianId,
  isPatientInvitationExpired,
  readClientProfile,
  readPatientInvitation,
  readSessionRecord,
  removeUndefined,
  timestampToIso,
  timestampToMillis,
} from '../dataMappers';
import { CLINICAL_PROTOCOL_TEMPLATES, getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';
import { resolveProtocolRuntime } from '../adaptiveEngine';
import { DEFAULT_RATIO_REWARDS } from '../protocols';

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
  it('restores only finite, unexpired calibrations across legacy timestamp shapes', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const model = { alphaPeakHz: 10.2, oneOverFSlope: 1.1, lastCalibratedAt: '2026-09-26T12:00:00Z', thetaMean: 2, betaMean: 4 };
    expect(getReusableBaselineModel(model, now)).toBe(model);
    for (const expiresAt of [now + 1, new Date(now + 1).toISOString(), { seconds: (now + 1000) / 1000 }, { toDate: () => new Date(now + 1) }]) {
      expect(getReusableBaselineModel({ ...model, status: 'valid', expiresAt }, now)).toMatchObject(model);
    }
    for (const expiresAt of [now, now - 1, 'bad-date']) {
      expect(getReusableBaselineModel({ ...model, status: 'valid', expiresAt }, now)).toBeNull();
    }
    for (const status of ['invalid', 'collecting', 'expired', 'unknown']) {
      expect(getReusableBaselineModel({ ...model, status }, now)).toBeNull();
    }
    expect(getReusableBaselineModel({ ...model, alphaPeakHz: Infinity }, now)).toBeNull();
    expect(getReusableBaselineModel({ ...model, oneOverFSlope: NaN }, now)).toBeNull();
    expect(getReusableBaselineModel({ ...model, lastCalibratedAt: 'bad-date' }, now)).toBeNull();
    const gambit = { algorithmVersion: 'neurogambit-15s-v1', lastCalibratedAt: model.lastCalibratedAt, thetaMean: 0, betaMean: 4, alphaMean: 6 };
    expect(getReusableBaselineModel(gambit, now)).toBe(gambit);
    expect(getCalibrationDisplayState(gambit, now).status).toBe('valid');
    expect(getReusableBaselineModel({ ...gambit, thetaMean: NaN }, now)).toBeNull();
    expect(getReusableBaselineModel({ ...gambit, algorithmVersion: 'unknown' }, now)).toBeNull();
    expect(getCalibrationDisplayState(undefined, now)).toMatchObject({ status: 'not-calibrated', calibratedAt: null });
    expect(getCalibrationDisplayState({ ...model, expiresAt: now }, now)).toMatchObject({ status: 'expired', calibratedAt: Date.parse(model.lastCalibratedAt) });
  });
  it('removes ratio residue from merged default and single-band assignments on read', () => {
    const ratioReward = DEFAULT_RATIO_REWARDS['theta-beta-ratio']!;
    for (const protocol of ['smr-enhancement', 'alpha-enhancement', 'beta-downtraining'] as const) {
      const template = getClinicalProtocolTemplate(protocol)!;
      const persisted = { ...clientFixture(), assignedProtocol: protocol,
        customProtocolConfig: { ...template, customRewardEnabled: false, ratioReward } };
      const loaded = readClientProfile(persisted);
      expect(loaded.customProtocolConfig?.ratioReward).toBeUndefined();
      expect(resolveProtocolRuntime(loaded)).toMatchObject({ ok: true, config: { protocol, rewardBand: undefined } });
      expect(persisted.customProtocolConfig.ratioReward).toBe(ratioReward);
    }
    const beta = getClinicalProtocolTemplate('beta-downtraining')!;
    const customized = readClientProfile({ ...clientFixture(), assignedProtocol: 'beta-downtraining',
      customProtocolConfig: { ...beta, customRewardEnabled: true, ratioReward,
        rewardBand: { ...beta.rewardBand, freqMin: 13, freqMax: 30, targetCondition: 'below', targetThreshold: 2 } } });
    expect(customized.customProtocolConfig?.ratioReward).toBeUndefined();
    expect(resolveProtocolRuntime(customized)).toMatchObject({ ok: true,
      config: { protocol: 'beta-downtraining', initialThreshold: 2, rewardBand: { freqMin: 13, freqMax: 30 } } });
  });

  it('keeps unsupported unmarked ratio configurations visible to the runtime guard', () => {
    const alpha = getClinicalProtocolTemplate('alpha-enhancement')!;
    const loaded = readClientProfile({ ...clientFixture(), assignedProtocol: 'alpha-enhancement',
      customProtocolConfig: { ...alpha, ratioReward: DEFAULT_RATIO_REWARDS['theta-beta-ratio'] } });
    expect(loaded.customProtocolConfig?.ratioReward).toBeDefined();
    expect(resolveProtocolRuntime(loaded)).toMatchObject({ ok: false });
  });
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
    expect(migrated.allowedExperiences).toEqual(['generative-music']);
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
  it('grows only from finite completed measurements and crosses the existing strict stage thresholds', () => {
    const gardenSession = sessionFixture({ experience: 'tidal-garden', protocol: 'alpha-enhancement', timeInZonePercent: 1 });
    for (const [points, expectedStage, expectedBadge] of [
      [300, 1, false], [301, 2, false], [500, 2, false], [501, 3, true], [800, 3, true], [801, 4, true],
    ] as const) {
      const start = { ...clientFixture(), tidalGardenState: { stage: 1, growthPoints: points - 2, plantsUnlocked: [], lastWatered: '' } };
      const updated = applySessionCompletionToClient(start, gardenSession);
      expect(updated.tidalGardenState?.growthPoints).toBe(points);
      expect(updated.tidalGardenState?.stage).toBe(expectedStage);
      expect(updated.badges.includes('garden-keeper')).toBe(expectedBadge);
    }
    for (const invalid of [0, Number.NaN, Infinity, undefined]) {
      const updated = applySessionCompletionToClient(clientFixture(), { ...gardenSession, timeInZonePercent: invalid as number });
      expect(updated.tidalGardenState?.growthPoints).toBe(0);
    }
    expect(applySessionCompletionToClient(clientFixture(), { ...gardenSession, isDemo: true }).tidalGardenState?.growthPoints).toBe(2);
  });
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
