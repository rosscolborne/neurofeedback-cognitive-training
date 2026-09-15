import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../types';

const state = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string } },
}));

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

vi.mock('../firebase', () => ({ auth: state.auth, db: { name: 'test-db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ type: 'collection', path }),
  doc: (_db: unknown, path: string, id: string) => ({ type: 'doc', path, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  ...firestore,
}));

import { INITIAL_DEMO_CLIENTS, storageEngine } from '../storageEngine';

const sessionDocument = (id: string, patientId: string) => ({
  id,
  exists: () => true,
  data: (): SessionRecord => ({
    id, patientId, patientName: patientId, clinicId: 'clinic-1', clinicianId: 'clinician-1',
    date: '', timestamp: 100, protocol: 'theta-beta-ratio', experience: 'skyline-drift',
    durationSeconds: 10, timeInZonePercent: 10, averageCoherence: null, peakFocusScore: 10,
    averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
    timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0,
  }),
});

describe('role-aware session repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'clinician-1' };
    storageEngine.resetToDefaultSeed();
  });

  it('rejects a clinician scope that does not match the authenticated clinician', async () => {
    const sessions = await storageEngine.getSessionsFor({ role: 'clinician', clinicianId: 'clinician-2' });
    expect(sessions).toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('checks patient ownership before a clinician patient-scoped query', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-2' }),
    });

    const sessions = await storageEngine.getSessionsFor({
      role: 'clinician', clinicianId: 'clinician-1', patientId: 'patient-1',
    });

    expect(sessions).toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('keeps an authorized clinician patient query constrained to that patient', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }),
    });
    firestore.getDocs.mockResolvedValueOnce({ docs: [sessionDocument('session-1', 'patient-1')] });

    const sessions = await storageEngine.getSessionsFor({
      role: 'clinician', clinicianId: 'clinician-1', patientId: 'patient-1',
    });

    expect(sessions.map((session) => session.id)).toEqual(['session-1']);
    const queryArg = firestore.getDocs.mock.calls[0][0] as { constraints: Array<{ field: string; value: string }> };
    expect(queryArg.constraints).toContainEqual({ field: 'patientId', op: '==', value: 'patient-1' });
  });

  it('keeps the legacy getSessions(clientId) call clinician-scoped', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }),
    });
    firestore.getDocs.mockResolvedValueOnce({ docs: [sessionDocument('session-1', 'patient-1')] });

    const sessions = await storageEngine.getSessions('patient-1');

    expect(sessions.map((session) => session.id)).toEqual(['session-1']);
    expect(firestore.getDoc).toHaveBeenCalledWith({ type: 'doc', path: 'clients', id: 'patient-1' });
  });

  it('deduplicates direct clinician sessions and owned legacy patient sessions', async () => {
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [sessionDocument('same-session', 'patient-1')] })
      .mockResolvedValueOnce({ docs: [{ id: 'patient-1' }] })
      .mockResolvedValueOnce({ docs: [sessionDocument('same-session', 'patient-1')] });

    const sessions = await storageEngine.getSessionsFor({ role: 'clinician', clinicianId: 'clinician-1' });
    expect(sessions.map((session) => session.id)).toEqual(['same-session']);
    const directQuery = firestore.getDocs.mock.calls[0][0] as { constraints: Array<{ field: string; value: string }> };
    expect(directQuery.constraints).toContainEqual({ field: 'clinicianId', op: '==', value: 'clinician-1' });
  });

  it('does not let clinic patient scope escape the requested clinic', async () => {
    state.auth.currentUser = { uid: 'clinic-1' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicId: 'clinic-2' }),
    });

    const sessions = await storageEngine.getSessionsFor({
      role: 'clinic', clinicId: 'clinic-1', patientId: 'patient-1',
    });
    expect(sessions).toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('allows an authenticated clinic member to query the clinic scope', async () => {
    state.auth.currentUser = { uid: 'practitioner-1' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'clinic-1', exists: () => true,
      data: () => ({ id: 'clinic-1', name: 'Clinic', timezone: 'UTC', practitionerIds: ['practitioner-1'] }),
    });
    firestore.getDocs.mockResolvedValueOnce({ docs: [sessionDocument('clinic-session', 'patient-1')] });

    const sessions = await storageEngine.getSessionsFor({ role: 'clinic', clinicId: 'clinic-1' });

    expect(sessions.map((session) => session.id)).toEqual(['clinic-session']);
    const queryArg = firestore.getDocs.mock.calls[0][0] as { constraints: Array<{ field: string; value: string }> };
    expect(queryArg.constraints).toContainEqual({ field: 'clinicId', op: '==', value: 'clinic-1' });
  });
});

describe('idempotent compatibility session saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'demo-clinician' };
    storageEngine.resetToDefaultSeed();
  });

  it('patches notes on repeated save without incrementing client aggregates twice', async () => {
    const patient = INITIAL_DEMO_CLIENTS[0];
    const startingCount = patient.completedSessionsCount;
    const session = {
      id: 'idempotency-test', patientId: patient.id, patientName: patient.name, clinicId: 'demo-clinic',
      date: '', timestamp: 100, protocol: 'theta-beta-ratio' as const, experience: 'skyline-drift' as const,
      durationSeconds: 10, timeInZonePercent: 50, averageCoherence: null, peakFocusScore: 50,
      averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 }, timeSeries: [],
      adaptiveAdjustmentsCount: 0, finalThreshold: 0, isDemo: true,
    };

    await storageEngine.saveSession(session);
    await storageEngine.saveSession({ ...session, patientNotes: 'Updated once' });

    const updatedPatient = await storageEngine.getClient(patient.id);
    const sessions = await storageEngine.getSessions(patient.id);
    expect(updatedPatient?.completedSessionsCount).toBe(startingCount + 1);
    expect(sessions.find((entry) => entry.id === session.id)?.patientNotes).toBe('Updated once');
  });
});

describe('authenticated simulator session persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'patient-1' };
  });

  it('persists a demo-mode training session for a real patient instead of routing it to demo memory', async () => {
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({ exists: () => false })
          .mockResolvedValueOnce({ exists: () => false }),
        set: vi.fn((ref, payload) => writes.push({ ref, payload })),
      })
    );
    const session = {
      ...sessionDocument('simulated-session', 'patient-1').data(),
      isDemo: true,
      clinicianId: undefined,
      clinicId: 'self-guided',
    };

    await expect(storageEngine.createSession(session)).resolves.toMatchObject({ created: true });
    expect(firestore.runTransaction).toHaveBeenCalledOnce();
    expect(writes[0]?.ref).toEqual({ type: 'doc', path: 'sessions', id: 'simulated-session' });
    expect(writes[0]?.payload).toMatchObject({ isDemo: true, patientId: 'patient-1' });
  });
});

describe('write authorization safeguards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'clinician-1' };
  });

  it('rejects device assignment writes for a clinician who does not own the patient', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-2' }),
    });

    await expect(storageEngine.saveDeviceAssignment({
      patientId: 'patient-1', deviceId: 'device-1', model: 'Muse S',
    })).rejects.toThrow('Not authorized');
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('derives assignment provenance from the authenticated owner', async () => {
    firestore.getDoc
      .mockResolvedValueOnce({
        id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }),
      })
      .mockResolvedValueOnce({ exists: () => false });

    await storageEngine.saveDeviceAssignment({
      patientId: 'patient-1', deviceId: 'device-1', model: 'Muse S', assignedByUserId: 'spoofed-user',
    });

    const payload = firestore.setDoc.mock.calls[0][1] as { assignedByUserId: string; patientId: string };
    expect(payload.patientId).toBe('patient-1');
    expect(payload.assignedByUserId).toBe('clinician-1');
  });

  it('rejects session creation for a caller-supplied clinicianId without client ownership', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-2' }),
    });
    const session = {
      ...sessionDocument('session-1', 'patient-1').data(), clinicianId: 'clinician-1', clinicId: '',
    };

    await expect(storageEngine.createSession(session)).rejects.toThrow('Not authorized');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('allows a real clinic member to create only for a patient in that clinic', async () => {
    state.auth.currentUser = { uid: 'practitioner-1' };
    firestore.getDoc
      .mockRejectedValueOnce(new Error('direct clinician lookup denied'))
      .mockResolvedValueOnce({
        id: 'clinic-1', exists: () => true,
        data: () => ({ id: 'clinic-1', name: 'Clinic', timezone: 'UTC', practitionerIds: ['practitioner-1'] }),
      })
      .mockResolvedValueOnce({
        id: 'patient-1', exists: () => true, data: () => ({ clinicId: 'clinic-1' }),
      });
    firestore.runTransaction.mockResolvedValueOnce({ created: true, session: {} });
    const session = { ...sessionDocument('session-1', 'patient-1').data(), clinicId: 'clinic-1' };

    await expect(storageEngine.createSession(session)).resolves.toMatchObject({ created: true });
    expect(firestore.runTransaction).toHaveBeenCalledOnce();
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

  it('allows an owning clinician to patch legacy sessions without clinicianId', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const legacySession = sessionDocument('legacy-session', 'patient-1');
    const legacyData = legacySession.data();
    delete (legacyData as { clinicianId?: string }).clinicianId;
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({ ...legacySession, data: () => legacyData })
          .mockResolvedValueOnce({
            id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }),
          }),
        set: vi.fn((_ref, payload) => writes.push(payload)),
      })
    );

    await storageEngine.patchSessionNotes('legacy-session', {
      patientNotes: 'Attempted patient note', clinicianNotes: 'Clinician note',
    });

    expect(writes[0]).toMatchObject({ clinicianNotes: 'Clinician note' });
    expect(writes[0]).not.toHaveProperty('patientNotes');
  });
});
