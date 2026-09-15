import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  data: () => ({
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
