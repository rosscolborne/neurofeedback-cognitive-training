import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../types';

const state = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; email?: string } },
}));

const MockTimestamp = vi.hoisted(() => class MockTimestamp {
  constructor(private readonly millis: number) {}
  toMillis() { return this.millis; }
  static fromDate(date: Date) { return { __timestamp: date.toISOString() }; }
});

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

vi.mock('../firebase', () => ({ auth: state.auth, db: { name: 'test-db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ type: 'collection', path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({
    type: 'doc',
    path: segments.slice(0, -1).join('/'),
    id: segments.at(-1),
  }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  Timestamp: MockTimestamp,
  ...firestore,
}));

import { createBlankProfile, storageEngine } from '../storageEngine';
import { buildPatientProgressDisplayModel } from '../../components/patient/patientMetrics';
import { getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';
import { EXPERIENCE_IDS } from '../experienceIds';

// A saved patient profile with a clinical assignment, as the legacy client record stores it.
const assignedPatient = (): ClientProfile => ({
  ...createBlankProfile('patient-1', 'patient@example.test', 'Patient One'),
  condition: 'ADHD (Inattentive)',
  prescribedSessionsPerWeek: 3,
  customProtocolConfig: getClinicalProtocolTemplate('theta-beta-ratio'),
});

describe('patient account deletion preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'old-uid', email: 'same@example.com' };
  });

  it('marks the profile, clears legacy relationship fields and scrubs the account record, touching nothing else', async () => {
    // A profile linked under the retired clinician product still carries relationship fields.
    const profile = { ...createBlankProfile('old-uid', 'same@example.com'), clinicianId: 'clinician-1',
      clinicId: 'clinic-1', linkedClinicianCode: 'clinician-1', acceptedInvitationId: 'OLD-CODE' };
    firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => profile });
    const deactivated = vi.fn();
    await storageEngine.preparePatientAccountDeletion('old-uid', deactivated);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: 'old-uid' },
      expect.objectContaining({ clinicianId: null, clinicId: null, linkedClinicianCode: null,
        acceptedInvitationId: null, accountDeletionStartedAt: expect.anything() }));
    expect(deactivated).toHaveBeenCalledWith(expect.objectContaining({ clinicianId: undefined,
      clinicId: undefined, accountDeletionStartedAt: expect.anything() }));
    expect(firestore.setDoc).toHaveBeenCalledWith({ type: 'doc', path: 'users', id: 'old-uid' },
      expect.objectContaining({ role: 'patient', email: null, displayName: null }), { merge: true });
    // The retired clinician collections are default-deny, so deletion must not query them.
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });

  it('resumes a marked profile without rewriting its relationship', async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({
      ...createBlankProfile('old-uid', 'same@example.com'), accountDeletionStartedAt: new MockTimestamp(1),
    }) });
    await storageEngine.preparePatientAccountDeletion('old-uid');
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).toHaveBeenCalledOnce();
  });

  it('retries after the account-record scrub fails without rewriting the marked profile', async () => {
    const marked = { ...createBlankProfile('old-uid', 'same@example.com'),
      accountDeletionStartedAt: new MockTimestamp(1), clinicianId: null, clinicId: null };
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => marked });
    firestore.setDoc.mockRejectedValueOnce(new Error('users offline')).mockResolvedValueOnce(undefined);
    await expect(storageEngine.preparePatientAccountDeletion('old-uid')).rejects.toThrow('users offline');
    await expect(storageEngine.preparePatientAccountDeletion('old-uid')).resolves.toBeUndefined();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
  });

  it('stops before writing if the signed-in UID changes during the profile read', async () => {
    let resolveRead!: (value: unknown) => void;
    firestore.getDoc.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const pending = storageEngine.preparePatientAccountDeletion('old-uid');
    state.auth.currentUser = { uid: 'other-uid', email: 'other@example.com' };
    resolveRead({ exists: () => true, data: () => createBlankProfile('old-uid', 'same@example.com') });
    await expect(pending).rejects.toThrow('signed-in account changed');
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });


});

const sessionDocument = (id: string, patientId: string) => ({
  id,
  exists: () => true,
  data: (): SessionRecord => ({
    id, patientId, patientName: patientId, clinicId: 'self-guided',
    date: '', timestamp: 100, protocol: 'theta-beta-ratio', experience: 'neuro-gambit',
    durationSeconds: 10, timeInZonePercent: 10, averageCoherence: null, peakFocusScore: 10,
    averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
    timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0,
  }),
});

describe('patient profile and session repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'patient-1' };
  });

  it('persists a profile change across a repository reload with its protocol assignment', async () => {
    const stored: Record<string, unknown> = {};
    firestore.setDoc.mockImplementationOnce(async (_ref: unknown, payload: Record<string, unknown>) => {
      Object.assign(stored, payload);
    });
    firestore.getDoc.mockImplementationOnce(async () => ({
      id: 'patient-1', exists: () => true, data: () => stored,
    }));
    const customProtocolConfig = { ...getClinicalProtocolTemplate('alpha-enhancement')!, alias: 'Evening Alpha' };
    const updated = {
      ...assignedPatient(),
      condition: 'Generalized Anxiety' as const, assignedProtocol: 'alpha-enhancement' as const,
      customProtocolConfig,
    };
    await storageEngine.saveClient(updated);
    const reloaded = await storageEngine.getClient('patient-1');
    expect(reloaded).toMatchObject({
      id: 'patient-1', condition: 'Generalized Anxiety', assignedProtocol: 'alpha-enhancement',
      customProtocolConfig: { alias: 'Evening Alpha' },
    });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: 'patient-1' },
      expect.objectContaining({ condition: 'Generalized Anxiety', assignedProtocol: 'alpha-enhancement',
        customProtocolConfig: expect.objectContaining({ alias: 'Evening Alpha', ratioReward: { __deleteField: true } }) }),
      { merge: true },
    );
  });

  it('clears a prior ratio reward through a Firestore merge so default and custom single-band assignments reload', async () => {
    const ratio = getClinicalProtocolTemplate('theta-beta-ratio')!;
    const stored: Record<string, unknown> = {
      ...assignedPatient(),
      assignedProtocol: 'theta-beta-ratio',
      customProtocolConfig: { ...ratio, customRewardEnabled: true, ratioReward: { numerator: { freqMin: 4, freqMax: 8 }, denominator: { freqMin: 13, freqMax: 30 }, targetCondition: 'below' as const, targetThreshold: 1.85 } },
    };
    const merge = (target: Record<string, unknown>, update: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(update)) {
        if (value && typeof value === 'object' && '__deleteField' in value) {
          delete target[key];
        } else if (value && typeof value === 'object' && !Array.isArray(value)
          && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else {
          target[key] = value;
        }
      }
    };
    firestore.setDoc.mockImplementation(async (_ref: unknown, payload: Record<string, unknown>) => merge(stored, payload));
    firestore.getDoc.mockImplementation(async () => ({ id: 'patient-1', exists: () => true, data: () => stored }));

    const smr = { ...getClinicalProtocolTemplate('smr-enhancement')!, customRewardEnabled: false };
    await storageEngine.saveClient({ ...assignedPatient(),
      assignedProtocol: 'smr-enhancement', customProtocolConfig: smr });
    const defaultReloaded = await storageEngine.getClient('patient-1');
    expect(stored.customProtocolConfig).not.toHaveProperty('ratioReward');
    expect(defaultReloaded?.customProtocolConfig?.customRewardEnabled).toBe(false);
    expect(defaultReloaded?.assignedProtocol).toBe('smr-enhancement');

    // Recreate the old merged state before editing a single-band reward.
    (stored.customProtocolConfig as Record<string, unknown>).ratioReward = { numerator: { freqMin: 4, freqMax: 8 }, denominator: { freqMin: 13, freqMax: 30 }, targetCondition: 'below' as const, targetThreshold: 1.85 };
    const beta = getClinicalProtocolTemplate('beta-downtraining')!;
    const custom = { ...beta, customRewardEnabled: true,
      rewardBand: { ...beta.rewardBand, freqMin: 9, freqMax: 12, targetCondition: 'below' as const, targetThreshold: 2 } };
    await storageEngine.saveClient({ ...defaultReloaded!, assignedProtocol: 'beta-downtraining', customProtocolConfig: custom });
    const customReloaded = await storageEngine.getClient('patient-1');
    expect(stored.customProtocolConfig).not.toHaveProperty('ratioReward');
    expect(customReloaded?.customProtocolConfig?.rewardBand).toMatchObject({ freqMin: 9, freqMax: 12, targetThreshold: 2 });
  });

  it('returns only the signed-in patient\'s own sessions, newest first', async () => {
    const newer = sessionDocument('newer', 'patient-1');
    firestore.getDocs.mockResolvedValueOnce({ docs: [
      sessionDocument('older', 'patient-1'), { ...newer, data: () => ({ ...newer.data(), timestamp: 200 }) },
    ] });

    const sessions = await storageEngine.getSessions('patient-1');

    expect(sessions.map((session) => session.id)).toEqual(['newer', 'older']);
    expect(firestore.getDocs).toHaveBeenCalledWith({
      source: { type: 'collection', path: 'sessions' }, constraints: [{ field: 'patientId', op: '==', value: 'patient-1' }],
    });
  });

  it('reads no other account\'s sessions', async () => {
    await expect(storageEngine.getSessions('patient-2')).resolves.toEqual([]);
    state.auth.currentUser = null;
    await expect(storageEngine.getSessions('patient-1')).resolves.toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('rejects when the session query fails instead of reporting empty', async () => {
    firestore.getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(storageEngine.getSessions('patient-1')).rejects.toThrow('offline');
  });

});

describe('idempotent compatibility session saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'patient-1' };
  });

  it('patches only the patient\'s notes when a completed session is saved again', async () => {
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    const set = vi.fn((ref, payload) => writes.push({ ref, payload }));
    firestore.runTransaction
      .mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) => callback({
        get: vi.fn().mockResolvedValue({ id: 'patient-1', exists: () => true,
          data: () => ({ ...createBlankProfile('patient-1', 'patient@example.test'), recentCompletedSessionIds: ['session-1'] }) }),
        set,
      }))
      .mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) => callback({
        get: vi.fn().mockResolvedValue(sessionDocument('session-1', 'patient-1')),
        set,
      }));

    await storageEngine.saveSession({ ...sessionDocument('session-1', 'patient-1').data(), patientNotes: 'Updated once', clinicianNotes: 'Not the patient\'s' });

    expect(writes).toEqual([{
      ref: { type: 'doc', path: 'sessions', id: 'session-1' },
      payload: { patientNotes: 'Updated once', updatedAt: { __serverTimestamp: true } },
    }]);
  });
});

describe('patient profile persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'patient-1', email: 'patient@example.test' };
  });

  it('creates a blank patient profile only after a successful missing-document read', async () => {
    const user = { uid: 'new-patient', email: 'new@example.com', displayName: 'New Patient' };
    firestore.getDoc.mockResolvedValueOnce({ id: user.uid, exists: () => false });

    await expect(storageEngine.getCurrentClient(user)).resolves.toMatchObject({
      id: user.uid,
      patientId: user.uid,
      email: user.email,
    });
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: user.uid },
      expect.objectContaining({ id: user.uid, patientId: user.uid }),
    );
    const saved = firestore.setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(saved.assignedProtocol).toBe('theta-beta-ratio');
    expect(saved.allowedExperiences).toEqual(getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences);
    expect(saved).not.toHaveProperty('avatarUrl');
    expect(saved).not.toHaveProperty('condition');
    expect(saved).not.toHaveProperty('prescribedSessionsPerWeek');
    expect(saved).not.toHaveProperty('brainCapacityScore');
    expect(saved.tidalGardenState).toEqual({ stage: 1, plantsUnlocked: [], growthPoints: 0, lastWatered: '' });
    expect(saved).not.toHaveProperty('skylineBiomesUnlocked');
  });

  it('propagates profile write failures', async () => {
    firestore.setDoc.mockRejectedValueOnce(new Error('profile save unavailable'));
    await expect(storageEngine.saveClient(assignedPatient())).rejects.toThrow('profile save unavailable');
  });

  it('persists explicit clinical-field clearing with Firestore deletion sentinels', async () => {
    const cleared = {
      ...assignedPatient(),
      condition: undefined,
      assignedProtocol: undefined,
      prescribedSessionsPerWeek: undefined,
      customProtocolConfig: undefined,
    };
    await storageEngine.saveClient(cleared);

    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: cleared.id },
      expect.objectContaining({
        condition: { __deleteField: true },
        assignedProtocol: { __deleteField: true },
        prescribedSessionsPerWeek: { __deleteField: true },
        customProtocolConfig: { __deleteField: true },
      }),
      { merge: true },
    );

    firestore.getDoc.mockResolvedValueOnce({
      id: cleared.id,
      exists: () => true,
      data: () => ({ id: cleared.id, name: cleared.name, email: cleared.email, status: 'active' }),
    });
    const reloaded = await storageEngine.getClient(cleared.id);
    expect(reloaded?.assignedProtocol).toBeUndefined();
    expect(reloaded?.condition).toBeUndefined();
  });

  it('retains the full-catalogue legacy missing-field save fallback, but preserves an explicit empty list', async () => {
    const legacy = createBlankProfile('patient-1', 'patient@example.test') as Partial<ClientProfile>;
    delete legacy.allowedExperiences;
    await storageEngine.saveClient(legacy as ClientProfile);
    expect(new Set((firestore.setDoc.mock.calls[0][1] as ClientProfile).allowedExperiences)).toEqual(new Set(EXPERIENCE_IDS));

    await storageEngine.saveClient({ ...createBlankProfile('patient-2', 'other@example.test'), allowedExperiences: [] });
    expect((firestore.setDoc.mock.calls[1][1] as ClientProfile).allowedExperiences).toEqual([]);
  });

  it('saves and reloads a template assignment exactly', async () => {
    const template = getClinicalProtocolTemplate('alpha-enhancement')!;
    const patient = { ...createBlankProfile('patient-1', 'patient@example.test'),
      allowedExperiences: [...template.recommendedExperiences] };
    let persisted!: ClientProfile;
    firestore.setDoc.mockImplementationOnce(async (_ref: unknown, payload: ClientProfile) => { persisted = payload; });
    await storageEngine.saveClient(patient);
    expect(persisted.allowedExperiences).toEqual(template.recommendedExperiences);
    firestore.getDoc.mockResolvedValueOnce({ id: patient.id, exists: () => true, data: () => persisted });
    const reloaded = await storageEngine.getClient(patient.id);
    expect(reloaded?.allowedExperiences).toEqual(template.recommendedExperiences);
  });

  it('deletes a stale custom template when switching protocol and reloads the selected assignment', async () => {
    const switched = {
      ...assignedPatient(),
      assignedProtocol: 'alpha-enhancement' as const,
      customProtocolConfig: undefined,
    };
    await storageEngine.saveClient(switched);
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: switched.id },
      expect.objectContaining({
        assignedProtocol: 'alpha-enhancement',
        customProtocolConfig: { __deleteField: true },
      }),
      { merge: true },
    );

    firestore.getDoc.mockResolvedValueOnce({
      id: switched.id,
      exists: () => true,
      data: () => ({ ...switched, customProtocolConfig: undefined }),
    });
    await expect(storageEngine.getClient(switched.id)).resolves.toMatchObject({
      assignedProtocol: 'alpha-enhancement',
    });
  });

  it('propagates patient profile read and initialization failures without fabricating a profile', async () => {
    const user = { uid: 'new-patient', email: 'new@example.com', displayName: 'New Patient' };
    firestore.getDoc.mockRejectedValueOnce(new Error('profile read unavailable'));
    await expect(storageEngine.getCurrentClient(user)).rejects.toThrow('profile read unavailable');
    expect(firestore.setDoc).not.toHaveBeenCalled();

    firestore.getDoc.mockResolvedValueOnce({ id: user.uid, exists: () => false });
    firestore.setDoc.mockRejectedValueOnce(new Error('profile write unavailable'));
    await expect(storageEngine.getCurrentClient(user)).rejects.toThrow('profile write unavailable');

    firestore.getDoc.mockResolvedValueOnce({
      id: user.uid,
      exists: () => true,
      data: () => ({ ...createBlankProfile(user.uid, user.email), name: '' }),
    });
    firestore.updateDoc.mockRejectedValueOnce(new Error('profile enrichment unavailable'));
    await expect(storageEngine.getCurrentClient(user)).rejects.toThrow('profile enrichment unavailable');
  });

  it('enriches an existing blank display name with a minimal server-safe patch', async () => {
    const user = { uid: 'patient-1', email: 'patient@example.com', displayName: 'patient.one' };
    firestore.getDoc.mockResolvedValueOnce({
      id: user.uid,
      exists: () => true,
      data: () => ({ id: user.uid, email: user.email, name: '', status: 'active' }),
    });

    await expect(storageEngine.getCurrentClient(user)).resolves.toMatchObject({ name: 'Patient One' });
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: user.uid },
      { name: 'Patient One' },
    );
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not recreate a profile deleted while its blank name is being repaired', async () => {
    const user = { uid: 'patient-1', email: 'patient@example.test', displayName: 'Patient One' };
    firestore.getDoc.mockResolvedValueOnce({ id: user.uid, exists: () => true,
      data: () => ({ id: user.uid, email: user.email, name: '', status: 'active', allowedExperiences: [] }) });
    firestore.updateDoc.mockRejectedValueOnce(new Error('profile no longer exists'));

    await expect(storageEngine.getCurrentClient(user)).rejects.toThrow('profile no longer exists');
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

});

describe('authenticated simulator session persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'patient-1' };
  });

  it('persists a completed Try Demo Mode session and reloads it into Progress/History aggregates', async () => {
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    const transactionGet = vi.fn().mockResolvedValue({
      id: 'patient-1',
      exists: () => true,
      data: () => createBlankProfile('patient-1', 'patient@example.com'),
    });
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: transactionGet,
        set: vi.fn((ref, payload) => writes.push({ ref, payload })),
      })
    );
    const session = {
      ...sessionDocument('simulated-session', 'patient-1').data(),
      experience: 'neuro-gambit' as const,
      protocol: 'alpha-enhancement' as const,
      timeInZonePercent: 80,
      isDemo: true,
      clinicianId: undefined,
      clinicId: 'self-guided',
    };

    await expect(storageEngine.createSession(session)).resolves.toMatchObject({ created: true });
    expect(firestore.runTransaction).toHaveBeenCalledOnce();
    expect(transactionGet).toHaveBeenCalledOnce();
    expect(transactionGet).toHaveBeenCalledWith({ type: 'doc', path: 'clients', id: 'patient-1' });
    expect(writes[0]?.ref).toEqual({ type: 'doc', path: 'sessions', id: 'simulated-session' });
    expect(writes[0]?.payload).toMatchObject({ isDemo: true, patientId: 'patient-1' });
    expect(writes[1]?.payload).toMatchObject({ recentCompletedSessionIds: ['simulated-session'] });
    // A legacy in-zone figure on the record grows nothing: no progression comes from EEG.
    expect(writes[1]?.payload).toMatchObject({ completedSessionsCount: 1, tidalGardenState: { stage: 1, growthPoints: 0, plantsUnlocked: [], lastWatered: '' } });

    firestore.getDoc.mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => writes[1].payload });
    expect((await storageEngine.getClient('patient-1'))?.tidalGardenState?.growthPoints).toBe(0);

    firestore.getDocs.mockResolvedValueOnce({
      docs: [{ id: session.id, data: () => writes[0].payload }],
    });
    const reloaded = await storageEngine.getSessions('patient-1');
    expect(reloaded).toEqual([expect.objectContaining({ id: session.id, isDemo: true })]);
    const progress = buildPatientProgressDisplayModel('ready', reloaded, {
      period: 'all', chartWidth: 320, chartHeight: 120, timeZone: 'UTC', nowMs: 1_000,
    });
    expect(progress.validSessions).toEqual([expect.objectContaining({ id: session.id, isDemo: true })]);
    expect(progress.summary?.sessionCount).toBe(1);
  });

  it('does not apply session aggregates twice when a completed session is retried', async () => {
    const transactionSet = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValue({
          id: 'patient-1',
          exists: () => true,
          data: () => ({ ...createBlankProfile('patient-1', 'patient@example.com'), recentCompletedSessionIds: ['simulated-session'] }),
        }),
        set: transactionSet,
      })
    );
    const session = {
      ...sessionDocument('simulated-session', 'patient-1').data(),
      isDemo: true,
      clinicianId: undefined,
      clinicId: 'self-guided',
    };

    await expect(storageEngine.createSession(session)).resolves.toMatchObject({ created: false });
    expect(transactionSet).not.toHaveBeenCalled();
  });
});

describe('write authorization safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'other-account' };
  });

  it('rejects session creation by any account other than the session\'s patient', async () => {
    const session = {
      ...sessionDocument('session-1', 'patient-1').data(),
    };

    await expect(storageEngine.createSession(session)).rejects.toThrow('Not authorized');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('limits patient note patches to patient-owned fields', async () => {
    state.auth.currentUser = { uid: 'patient-1' };
    const writes: Array<Record<string, unknown>> = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce(sessionDocument('session-1', 'patient-1')),
        set: vi.fn((_ref, payload) => writes.push(payload)),
      })
    );

    await storageEngine.patchSessionNotes('session-1', {
      patientNotes: 'Patient note', clinicianNotes: 'Attempted clinician note', moodRating: 4,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ patientNotes: 'Patient note', moodRating: 4 });
    expect(writes[0]).not.toHaveProperty('clinicianNotes');
  });

  it('refuses a note patch on another account\'s session', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({ get: vi.fn().mockResolvedValueOnce(sessionDocument('session-1', 'patient-1')), set }));

    await expect(storageEngine.patchSessionNotes('session-1', { patientNotes: 'Not mine' })).rejects.toThrow('Not authorized');
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a signed-out note patch without reporting success', async () => {
    state.auth.currentUser = null;
    await expect(storageEngine.patchSessionNotes('session-1', { patientNotes: 'Draft' }))
      .rejects.toThrow('Sign in');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

});
