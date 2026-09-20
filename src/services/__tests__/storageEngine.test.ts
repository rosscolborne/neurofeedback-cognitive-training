import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../types';

const state = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; email?: string } },
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
  collection: (_db: unknown, ...segments: string[]) => ({ type: 'collection', path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({
    type: 'doc',
    path: segments.slice(0, -1).join('/'),
    id: segments.at(-1),
  }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  Timestamp: { fromDate: (date: Date) => ({ __timestamp: date.toISOString() }) },
  ...firestore,
}));

import { INITIAL_DEMO_CLIENTS, createBlankProfile, storageEngine } from '../storageEngine';
import { activateClinicianDemoWorkspace, deactivateClinicianDemoWorkspace } from '../clinicianDemoBoundary';
import { buildPatientProgressDisplayModel } from '../../components/patient/patientMetrics';
import { BRAND_PRESETS } from '../brandEngine';

afterEach(() => deactivateClinicianDemoWorkspace());

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
    activateClinicianDemoWorkspace();
    storageEngine.resetToDefaultSeed();
    deactivateClinicianDemoWorkspace();
    state.auth.currentUser = { uid: 'clinician-1' };
  });

  it('rejects a clinician scope that does not match the authenticated clinician', async () => {
    const sessions = await storageEngine.getSessionsFor({ role: 'clinician', clinicianId: 'clinician-2' });
    expect(sessions).toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('loads only the requested clinic brand and falls back to the product default', async () => {
    const clinicBrand = { ...BRAND_PRESETS[0], clinicId: 'clinic-1', name: 'Clinic One' };
    firestore.getDoc
      .mockResolvedValueOnce({ id: 'clinic-1', exists: () => true, data: () => ({ id: 'clinic-1', practitionerIds: [], branding: clinicBrand }) })
      .mockResolvedValueOnce({ id: 'clinic-2', exists: () => false });

    await expect(storageEngine.getClinicBrandConfig('clinic-1')).resolves.toMatchObject({ clinicId: 'clinic-1', name: 'Clinic One' });
    await expect(storageEngine.getClinicBrandConfig('clinic-2')).resolves.toEqual(BRAND_PRESETS[0]);
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

  it('rejects when an authorized Firestore session query fails instead of reporting empty', async () => {
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }),
    });
    firestore.getDocs.mockRejectedValueOnce(new Error('offline'));

    await expect(storageEngine.getSessionsFor({
      role: 'clinician', clinicianId: 'clinician-1', patientId: 'patient-1',
    })).rejects.toThrow('offline');
  });

  it('appends an authorized QEEG record once with server and actor provenance', async () => {
    const set = vi.fn();
    const map = {
      id: 'qeeg-request-1', uploadDate: '2026-09-19T12:00:00.000Z', fileName: '',
      recordingDate: '2026-09-18', deviceSource: 'Validated source', technicianNotes: '',
      zScores: { frontalTheta: 0, centralBeta: 1, occipitalAlpha: -1, temporalDelta: 2, sensorimotorSMR: 0 },
      dominantAlphaPeakHz: 10,
    };
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }) })
          .mockResolvedValueOnce({ id: map.id, exists: () => false }),
        set,
      })
    );
    firestore.getDoc.mockResolvedValueOnce({
      id: map.id, exists: () => true,
      data: () => ({ ...map, createdBy: 'clinician-1', createdAt: 100, updatedAt: 100, schemaVersion: 1 }),
    });

    await expect(storageEngine.appendBrainMap('patient-1', map)).resolves.toMatchObject({
      id: map.id, createdBy: 'clinician-1', createdAt: 100,
    });
    expect(set).toHaveBeenCalledWith(
      { type: 'doc', path: `clients/patient-1/brainMaps`, id: map.id },
      expect.objectContaining({
        id: map.id,
        createdBy: 'clinician-1',
        createdAt: { __serverTimestamp: true },
        updatedAt: { __serverTimestamp: true },
        recordingDate: { __timestamp: '2026-09-18T00:00:00.000Z' },
      })
    );
  });

  it('rejects malformed QEEG keys before opening a transaction', async () => {
    const malformed = {
      id: 'qeeg-request-1', uploadDate: '2026-09-19T12:00:00.000Z', fileName: '',
      recordingDate: '2026-02-30', deviceSource: 'Validated source', technicianNotes: '',
      zScores: { frontalTheta: 0, centralBeta: 1, occipitalAlpha: -1, temporalDelta: 2, wrongBand: 0 },
      dominantAlphaPeakHz: 10,
    } as unknown as import('../../types').QEEGBrainMap;
    await expect(storageEngine.appendBrainMap('patient-1', malformed)).rejects.toThrow('invalid clinical values');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects a same-id QEEG collision when the persisted payload differs', async () => {
    const map = {
      id: 'qeeg-request-1', uploadDate: '2026-09-19T12:00:00.000Z', fileName: '',
      recordingDate: '2026-09-18', deviceSource: 'Validated source', technicianNotes: '',
      zScores: { frontalTheta: 0, centralBeta: 1, occipitalAlpha: -1, temporalDelta: 2, sensorimotorSMR: 0 },
      dominantAlphaPeakHz: 10,
    };
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }) })
          .mockResolvedValueOnce({
            id: map.id, exists: () => true,
            data: () => ({ ...map, dominantAlphaPeakHz: 11, createdBy: 'clinician-1' }),
          }),
        set: vi.fn(),
      })
    );
    await expect(storageEngine.appendBrainMap('patient-1', map)).rejects.toThrow('identifier is already in use');
  });

  it('returns the existing QEEG record for an idempotent same-payload retry', async () => {
    const map = {
      id: 'qeeg-request-1', uploadDate: '2026-09-19T12:00:00.000Z', fileName: '',
      recordingDate: '2026-09-18', deviceSource: 'Validated source', technicianNotes: 'same',
      zScores: { frontalTheta: 0, centralBeta: 1, occipitalAlpha: -1, temporalDelta: 2, sensorimotorSMR: 0 },
      dominantAlphaPeakHz: 10,
    };
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => ({ clinicianId: 'clinician-1' }) })
          .mockResolvedValueOnce({
            id: map.id, exists: () => true,
            data: () => ({
              ...map,
              uploadDate: '2026-09-19T12:00:01.000Z',
              createdBy: 'clinician-1',
              // Firestore returns map keys in sorted order, not insertion order.
              zScores: {
                centralBeta: 1,
                frontalTheta: 0,
                occipitalAlpha: -1,
                sensorimotorSMR: 0,
                temporalDelta: 2,
              },
            }),
          }),
        set,
      })
    );
    await expect(storageEngine.appendBrainMap('patient-1', map)).resolves.toMatchObject({ id: map.id, technicianNotes: 'same' });
    expect(set).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('propagates canonical QEEG read failures and orders equal timestamps by id', async () => {
    firestore.getDocs.mockResolvedValueOnce({
      docs: [
        { id: 'b', data: () => ({ uploadDate: 100, recordingDate: 100 }) },
        { id: 'a', data: () => ({ uploadDate: 100, recordingDate: 100 }) },
      ],
    });
    await expect(storageEngine.getBrainMaps('patient-1')).resolves.toEqual([
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b' }),
    ]);
    firestore.getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(storageEngine.getBrainMaps('patient-1')).rejects.toThrow('offline');
  });

  it('queries sessions only through the current canonical and explicit-null legacy roster', async () => {
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ id: 'patient-1', data: () => ({ clinicianId: 'clinician-1' }) }] })
      .mockResolvedValueOnce({ docs: [{ id: 'patient-2', data: () => ({ clinicianId: null, linkedClinicianCode: 'clinician-1' }) }] })
      .mockResolvedValueOnce({ docs: [sessionDocument('session-1', 'patient-1')] })
      .mockResolvedValueOnce({ docs: [sessionDocument('session-2', 'patient-2')] });

    const sessions = await storageEngine.getSessionsFor({ role: 'clinician', clinicianId: 'clinician-1' });
    expect(sessions.map((session) => session.id)).toEqual(['session-1', 'session-2']);
    const queries = firestore.getDocs.mock.calls.map(([argument]) => argument as { source: { path: string }; constraints: Array<{ field: string; value: string | null }> });
    expect(queries[0].constraints).toContainEqual({ field: 'clinicianId', op: '==', value: 'clinician-1' });
    expect(queries[1].constraints).toEqual(expect.arrayContaining([
      { field: 'linkedClinicianCode', op: '==', value: 'clinician-1' },
      { field: 'clinicianId', op: '==', value: null },
    ]));
    expect(queries.slice(2).map((entry) => entry.constraints)).toEqual([
      [{ field: 'patientId', op: '==', value: 'patient-1' }],
      [{ field: 'patientId', op: '==', value: 'patient-2' }],
    ]);
    expect(queries.some((entry) => entry.source.path === 'sessions' && entry.constraints.some((constraint) => constraint.field === 'clinicianId'))).toBe(false);
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

  it('constrains an authorized clinic patient session query by both patient and clinic', async () => {
    state.auth.currentUser = { uid: 'practitioner-1' };
    firestore.getDoc
      .mockResolvedValueOnce({
        id: 'clinic-1', exists: () => true,
        data: () => ({ id: 'clinic-1', name: 'Clinic', timezone: 'UTC', practitionerIds: ['practitioner-1'] }),
      })
      .mockResolvedValueOnce({
        id: 'patient-1', exists: () => true, data: () => ({ clinicId: 'clinic-1' }),
      });
    firestore.getDocs.mockResolvedValueOnce({ docs: [sessionDocument('clinic-session', 'patient-1')] });

    await expect(storageEngine.getSessionsFor({
      role: 'clinic', clinicId: 'clinic-1', patientId: 'patient-1',
    })).resolves.toEqual([expect.objectContaining({ id: 'clinic-session' })]);
    const queryArg = firestore.getDocs.mock.calls[0][0] as { constraints: Array<{ field: string; value: string }> };
    expect(queryArg.constraints).toEqual(expect.arrayContaining([
      { field: 'patientId', op: '==', value: 'patient-1' },
      { field: 'clinicId', op: '==', value: 'clinic-1' },
    ]));
  });

  it('allows an authenticated clinic member to query the clinic scope', async () => {
    state.auth.currentUser = { uid: 'practitioner-1' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'clinic-1', exists: () => true,
      data: () => ({ id: 'clinic-1', name: 'Clinic', timezone: 'UTC', practitionerIds: ['practitioner-1'] }),
    });
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ id: 'patient-1', data: () => ({ clinicId: 'clinic-1' }) }] })
      .mockResolvedValueOnce({ docs: [sessionDocument('clinic-session', 'patient-1')] });

    const sessions = await storageEngine.getSessionsFor({ role: 'clinic', clinicId: 'clinic-1' });

    expect(sessions.map((session) => session.id)).toEqual(['clinic-session']);
    const rosterQuery = firestore.getDocs.mock.calls[0][0] as { source: { path: string }; constraints: Array<{ field: string; value: string }> };
    expect(rosterQuery.source.path).toBe('clients');
    expect(rosterQuery.constraints).toContainEqual({ field: 'clinicId', op: '==', value: 'clinic-1' });
    const sessionQuery = firestore.getDocs.mock.calls[1][0] as { source: { path: string }; constraints: Array<{ field: string; value: string }> };
    expect(sessionQuery.source.path).toBe('sessions');
    expect(sessionQuery.constraints).toContainEqual({ field: 'patientId', op: '==', value: 'patient-1' });
    expect(sessionQuery.constraints).toContainEqual({ field: 'clinicId', op: '==', value: 'clinic-1' });
  });
});

describe('idempotent compatibility session saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateClinicianDemoWorkspace();
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

describe('production and sample workspace separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateClinicianDemoWorkspace();
    storageEngine.resetToDefaultSeed();
    deactivateClinicianDemoWorkspace();
    state.auth.currentUser = { uid: 'clinician-1', email: 'clinician@example.com' };
  });

  it('never falls back to seeded records for an empty production account', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [] });

    await expect(storageEngine.getClients()).resolves.toEqual([]);
    await expect(storageEngine.getMessages()).resolves.toEqual([]);
    await expect(storageEngine.getAppointments()).resolves.toEqual([]);
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
    expect(saved).not.toHaveProperty('avatarUrl');
    expect(saved).not.toHaveProperty('condition');
    expect(saved).not.toHaveProperty('assignedProtocol');
    expect(saved).not.toHaveProperty('prescribedSessionsPerWeek');
    expect(saved).not.toHaveProperty('brainCapacityScore');
    expect(saved).not.toHaveProperty('tidalGardenState');
    expect(saved).not.toHaveProperty('skylineBiomesUnlocked');
  });

  it('propagates roster and profile write failures', async () => {
    firestore.getDocs.mockRejectedValueOnce(new Error('roster unavailable'));
    await expect(storageEngine.getClients()).rejects.toThrow('roster unavailable');

    firestore.setDoc.mockRejectedValueOnce(new Error('profile save unavailable'));
    await expect(storageEngine.saveClient(INITIAL_DEMO_CLIENTS[0])).rejects.toThrow('profile save unavailable');

    firestore.deleteDoc.mockRejectedValueOnce(new Error('delete unavailable'));
    await expect(storageEngine.deleteClient('patient-1')).rejects.toThrow('delete unavailable');
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
    firestore.setDoc.mockRejectedValueOnce(new Error('profile enrichment unavailable'));
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
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: user.uid },
      { name: 'Patient One' },
      { merge: true },
    );
  });

  it('blocks sample resets from a production account', () => {
    expect(() => storageEngine.clearDemoData()).toThrow('isolated sample clinician workspace');
    expect(() => storageEngine.resetToDefaultSeed()).toThrow('isolated sample clinician workspace');
  });

  it('does not classify legitimate production IDs or mutable flags as sample data', async () => {
    const productionClient = { ...INITIAL_DEMO_CLIENTS[0], id: 'demo-looking-production-id', clinicianId: 'clinician-1', isDemo: true };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ id: productionClient.id, data: () => productionClient }] })
      .mockResolvedValueOnce({ docs: [] });

    await expect(storageEngine.getClients()).resolves.toEqual([expect.objectContaining({ id: productionClient.id, isDemo: true })]);
    await storageEngine.saveClient(productionClient);
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: productionClient.id },
      productionClient,
      { merge: true },
    );
  });

  it('treats even the legacy demo-shaped UID as production unless the workspace authority is active', async () => {
    state.auth.currentUser = { uid: 'demo-clinician', email: 'real@example.com' };
    const client = { ...INITIAL_DEMO_CLIENTS[0], id: 'real-patient', clinicianId: 'demo-clinician', isDemo: false };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ id: client.id, data: () => client }] })
      .mockResolvedValueOnce({ docs: [] });

    await expect(storageEngine.getClients()).resolves.toEqual([expect.objectContaining({ id: 'real-patient' })]);
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('returns persisted messages and appointments even when legacy fields resemble sample data', async () => {
    const thread = { clientId: 'demo-looking-patient', clinicianId: 'clinician-1', clientName: 'Real patient', clientAvatar: '', lastMessageTime: '', unreadCount: 0, messages: [], isDemo: true };
    const appointment = { id: 'demo-looking-appointment', clientId: 'demo-looking-patient', clinicianId: 'clinician-1', clientName: 'Real patient', clientAvatar: '', clientCondition: '', date: '2026-09-19', time: '10:00', durationMinutes: 30, type: 'consultation' as const, protocol: 'theta-beta-ratio' as const, status: 'scheduled' as const, isDemo: true };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ data: () => thread }] })
      .mockResolvedValueOnce({ docs: [{ data: () => appointment }] });

    await expect(storageEngine.getMessages()).resolves.toEqual([thread]);
    await expect(storageEngine.getAppointments()).resolves.toEqual([appointment]);
  });

  it('keeps sample records available only inside the explicit demo workspace', async () => {
    activateClinicianDemoWorkspace();
    state.auth.currentUser = null;

    await expect(storageEngine.getClients()).resolves.toHaveLength(INITIAL_DEMO_CLIENTS.length);
    storageEngine.clearDemoData();
    await expect(storageEngine.getClients()).resolves.toEqual([]);
    storageEngine.resetToDefaultSeed();
    await expect(storageEngine.getClients()).resolves.toHaveLength(INITIAL_DEMO_CLIENTS.length);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('fails closed without network access for production repositories while demo is active', async () => {
    activateClinicianDemoWorkspace();
    state.auth.currentUser = { uid: 'underlying-real-session', email: 'real@example.com' };

    await expect(storageEngine.getClinic('clinic-1')).resolves.toBeNull();
    await expect(storageEngine.getPractitioner('practitioner-1')).resolves.toBeNull();
    await expect(storageEngine.getPatientInvitationsForClinician()).resolves.toEqual([]);
    await expect(storageEngine.createPatientInvitation({
      clinicId: 'clinic-1',
      clinicianName: 'Clinician', patientEmail: 'patient@example.com', patientName: 'Patient',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).rejects.toThrow('unavailable in the sample clinician workspace');
    await expect(storageEngine.saveDeviceAssignment({ patientId: 'patient-1', deviceId: 'device-1', model: 'Muse' }))
      .rejects.toThrow('unavailable in the sample clinician workspace');
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
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

describe('patient invitation linking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'clinician-1', email: 'clinician@example.com' };
  });

  it('creates a pending invitation for the entered patient email instead of a fake client', async () => {
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce({ exists: () => false }),
        set: vi.fn((ref, payload) => writes.push({ ref, payload })),
      })
    );

    const invitation = await storageEngine.createPatientInvitation({
      clinicId: 'clinic-1',
      clinicianName: 'Dr. Example',
      patientName: 'Patient One',
      patientEmail: ' Patient@One.Example ',
      condition: 'Peak Performance',
      assignedProtocol: 'theta-beta-ratio',
      prescribedSessionsPerWeek: 3,
    });

    expect(invitation.id).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(invitation).toMatchObject({ clinicianId: 'clinician-1', clinicId: 'clinic-1', patientEmail: 'patient@one.example', status: 'pending' });
    expect(invitation.uniquenessClaimId).toBe('patient@one.example');
    expect(writes).toContainEqual({
      ref: { type: 'doc', path: 'patientInvitations', id: invitation.id },
      payload: expect.objectContaining({ clinicId: 'clinic-1', patientEmail: 'patient@one.example', status: 'pending', expiresAt: expect.any(Date) }),
    });
    expect(writes).toContainEqual({
      ref: { type: 'doc', path: 'patientInvitationClaims/clinician-1/emails', id: invitation.uniquenessClaimId },
      payload: expect.objectContaining({ clinicId: 'clinic-1', patientEmail: 'patient@one.example', invitationId: invitation.id }),
    });
  });

  it('rejects self invitations and duplicate pending invitations', async () => {
    await expect(storageEngine.createPatientInvitation({
      clinicId: 'invalid/clinic',
      clinicianName: 'Dr. Example', patientName: 'Patient', patientEmail: 'patient@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).rejects.toThrow('Complete clinic setup');

    await expect(storageEngine.createPatientInvitation({
      clinicId: 'clinic-1',
      clinicianName: 'Dr. Example', patientName: 'Self', patientEmail: 'CLINICIAN@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).rejects.toThrow('cannot invite your own');

    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce({
          exists: () => true,
          data: () => ({ invitationId: 'ABCD-EFGH-JKLM', expiresAt: Date.now() + 60_000 }),
        }),
        set: vi.fn(),
      })
    );
    await expect(storageEngine.createPatientInvitation({
      clinicId: 'clinic-1',
      clinicianName: 'Dr. Example', patientName: 'Patient', patientEmail: 'Patient@Example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).rejects.toThrow('pending invitation already exists');
  });

  it('reuses only an expired uniqueness claim for a new invitation', async () => {
    const writes: unknown[] = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce({
          exists: () => true,
          data: () => ({ invitationId: 'EXPIRED-CODE', expiresAt: Date.now() - 1 }),
        }),
        set: vi.fn((...args) => writes.push(args)),
      })
    );

    await expect(storageEngine.createPatientInvitation({
      clinicId: 'clinic-1',
      clinicianName: 'Dr. Example', patientName: 'Patient', patientEmail: 'patient@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).resolves.toMatchObject({ status: 'pending' });
    expect(writes).toHaveLength(2);
  });

  it('isolates claim paths for clinician/email pairs that collide under flat delimiter concatenation', async () => {
    const claimRefs: unknown[] = [];
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        set: vi.fn((ref: { path?: string }) => {
          if (ref.path?.startsWith('patientInvitationClaims/')) claimRefs.push(ref);
        }),
      })
    );

    state.auth.currentUser = { uid: 'alpha', email: 'clinician-a@example.com' };
    await storageEngine.createPatientInvitation({
      clinicId: 'clinic-alpha',
      clinicianName: 'A', patientName: 'Patient', patientEmail: 'beta__gamma@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    });
    state.auth.currentUser = { uid: 'alpha__beta', email: 'clinician-b@example.com' };
    await storageEngine.createPatientInvitation({
      clinicId: 'clinic-alpha-beta',
      clinicianName: 'B', patientName: 'Patient', patientEmail: 'gamma@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    });

    expect(claimRefs).toEqual([
      { type: 'doc', path: 'patientInvitationClaims/alpha/emails', id: 'beta__gamma@example.com' },
      { type: 'doc', path: 'patientInvitationClaims/alpha__beta/emails', id: 'gamma@example.com' },
    ]);
  });

  it('atomically links the real patient profile and accepts the invitation', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'Patient@Example.COM' };
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    const deletes: unknown[] = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({
            id: 'ABCD-EFGH-JKLM', exists: () => true,
            data: () => ({ clinicianId: 'clinician-1', clinicId: 'clinic-1', clinicianName: 'Dr. Example', patientEmail: 'patient@example.com', patientName: 'Patient One', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending', uniquenessClaimId: 'claim-1', schemaVersion: 1 }),
          })
          .mockResolvedValueOnce({
            id: 'patient-1', exists: () => true,
            data: () => createBlankProfile('patient-1', 'patient@example.com', 'Patient One'),
          }),
        set: vi.fn((ref, payload) => writes.push({ ref, payload })),
        delete: vi.fn((ref) => deletes.push(ref)),
      })
    );

    const linked = await storageEngine.acceptPatientInvitation(
      'abcd-efgh-jklm',
      createBlankProfile('patient-1', 'patient@example.com', 'Patient One')
    );

    expect(linked).toMatchObject({ id: 'patient-1', clinicianId: 'clinician-1', clinicId: 'clinic-1', acceptedInvitationId: 'ABCD-EFGH-JKLM' });
    expect(writes[0]).toMatchObject({ ref: { type: 'doc', path: 'clients', id: 'patient-1' }, payload: expect.objectContaining({ clinicianId: 'clinician-1', clinicId: 'clinic-1' }) });
    expect(writes[1]).toMatchObject({ ref: { type: 'doc', path: 'patientInvitations', id: 'ABCD-EFGH-JKLM' }, payload: expect.objectContaining({ status: 'accepted', patientId: 'patient-1' }) });
    expect(deletes).toEqual([{ type: 'doc', path: 'patientInvitationClaims/clinician-1/emails', id: 'claim-1' }]);
  });

  it('atomically cancels an owned invitation and releases its uniqueness claim', async () => {
    const writes: Array<{ ref: unknown; payload: Record<string, unknown> }> = [];
    const deletes: unknown[] = [];
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce({
          id: 'ABCD-EFGH-JKLM', exists: () => true,
          data: () => ({ clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending', uniquenessClaimId: 'claim-1' }),
        }),
        set: vi.fn((ref, payload) => writes.push({ ref, payload })),
        delete: vi.fn((ref) => deletes.push(ref)),
      })
    );

    await storageEngine.cancelPatientInvitation('ABCD-EFGH-JKLM');
    expect(writes).toContainEqual({
      ref: { type: 'doc', path: 'patientInvitations', id: 'ABCD-EFGH-JKLM' },
      payload: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(deletes).toEqual([{ type: 'doc', path: 'patientInvitationClaims/clinician-1/emails', id: 'claim-1' }]);
  });

  it('refuses an invitation addressed to a different account email', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'other@example.com' };
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn().mockResolvedValueOnce({
          id: 'ABCD-EFGH-JKLM', exists: () => true,
          data: () => ({ clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending' }),
        }),
        set: vi.fn(),
      })
    );

    await expect(storageEngine.acceptPatientInvitation(
      'ABCD-EFGH-JKLM',
      createBlankProfile('patient-1', 'other@example.com')
    )).rejects.toThrow('different email address');
  });

  it('turns rule-level invitation privacy denials into an actionable account/code error', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'other@example.com' };
    firestore.runTransaction.mockRejectedValueOnce({ code: 'permission-denied' });

    await expect(storageEngine.acceptPatientInvitation(
      'ABCD-EFGH-JKLM', createBlankProfile('patient-1', 'other@example.com')
    )).rejects.toThrow('not found for this signed-in email');
  });

  it('returns the linked profile without writes when an accepted invitation is retried', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'patient@example.com' };
    const linked = {
      ...createBlankProfile('patient-1', 'patient@example.com'),
      clinicianId: 'clinician-1', clinicId: 'clinic-1', acceptedInvitationId: 'ABCD-EFGH-JKLM',
    };
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({
            id: 'ABCD-EFGH-JKLM', exists: () => true,
            data: () => ({ clinicianId: 'clinician-1', clinicId: 'clinic-1', patientId: 'patient-1', patientEmail: 'patient@example.com', status: 'accepted' }),
          })
          .mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => linked }),
        set,
      })
    );

    await expect(storageEngine.acceptPatientInvitation('ABCD-EFGH-JKLM', linked)).resolves.toMatchObject(linked);
    expect(set).not.toHaveBeenCalled();
  });

  it('surfaces cancelled, expired, used, invalid, and self-acceptance states', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'patient@example.com' };
    await expect(storageEngine.acceptPatientInvitation('bad-code', createBlankProfile('patient-1', 'patient@example.com')))
      .rejects.toThrow('XXXX-XXXX-XXXX format');

    const cases = [
      [{ clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'cancelled' }, 'cancelled'],
      [{ clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending', expiresAt: Date.now() - 1 }, 'expired'],
      [{ clinicianId: 'clinician-1', patientId: 'patient-2', patientEmail: 'patient@example.com', status: 'accepted' }, 'already been used'],
      [{ clinicianId: 'patient-1', patientEmail: 'patient@example.com', status: 'pending' }, 'cannot accept their own'],
    ] as const;

    for (const [invitation, message] of cases) {
      firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
        callback({
          get: vi.fn()
            .mockResolvedValueOnce({ id: 'ABCD-EFGH-JKLM', exists: () => true, data: () => invitation })
            .mockResolvedValueOnce({ id: 'patient-1', exists: () => true, data: () => createBlankProfile('patient-1', 'patient@example.com') }),
          set: vi.fn(),
        })
      );
      await expect(storageEngine.acceptPatientInvitation(
        'ABCD-EFGH-JKLM', createBlankProfile('patient-1', 'patient@example.com')
      )).rejects.toThrow(message);
    }
  });

  it('deduplicates canonical and legacy roster results for only the signed-in clinician', async () => {
    state.auth.currentUser = { uid: 'clinician-1', email: 'clinician@example.com' };
    const canonical = {
      id: 'patient-1', data: () => ({ ...createBlankProfile('patient-1', 'one@example.com'), clinicianId: 'clinician-1' }),
    };
    const legacy = {
      id: 'patient-2', data: () => ({ ...createBlankProfile('patient-2', 'two@example.com'), linkedClinicianCode: 'clinician-1' }),
    };
    const mixedOwnedByAnotherClinician = {
      id: 'patient-3', data: () => ({ ...createBlankProfile('patient-3', 'three@example.com'), clinicianId: 'clinician-2', linkedClinicianCode: 'clinician-1' }),
    };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [canonical] })
      .mockResolvedValueOnce({ docs: [canonical, legacy, mixedOwnedByAnotherClinician] });

    const roster = await storageEngine.getClients();
    expect(roster.map((entry) => entry.id)).toEqual(['patient-1', 'patient-2']);
    const legacyQuery = firestore.getDocs.mock.calls[1][0] as { constraints: Array<{ field: string; value: unknown }> };
    expect(legacyQuery.constraints).toContainEqual({ field: 'linkedClinicianCode', op: '==', value: 'clinician-1' });
    expect(legacyQuery.constraints).toContainEqual({ field: 'clinicianId', op: '==', value: null });
  });

  it('keeps canonical roster results when the separately constrained legacy query is denied', async () => {
    const canonical = {
      id: 'patient-1', data: () => ({ ...createBlankProfile('patient-1', 'one@example.com'), clinicianId: 'clinician-1' }),
    };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [canonical] })
      .mockRejectedValueOnce({ code: 'permission-denied' });

    await expect(storageEngine.getClients()).resolves.toEqual([
      expect.objectContaining({ id: 'patient-1', clinicianId: 'clinician-1' }),
    ]);
  });

  it('denies a legacy-field clinician when a different canonical clinician exists', async () => {
    state.auth.currentUser = { uid: 'clinician-legacy', email: 'legacy@example.com' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true,
      data: () => ({ clinicianId: 'clinician-canonical', linkedClinicianCode: 'clinician-legacy' }),
    });

    await expect(storageEngine.getSessionsFor({
      role: 'clinician', clinicianId: 'clinician-legacy', patientId: 'patient-1',
    })).resolves.toEqual([]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('refuses to replace a clinician link found in the persisted patient profile', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'patient@example.com' };
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({
            id: 'ABCD-EFGH-JKLM', exists: () => true,
            data: () => ({ clinicianId: 'clinician-2', patientEmail: 'patient@example.com', status: 'pending' }),
          })
          .mockResolvedValueOnce({
            id: 'patient-1', exists: () => true,
            data: () => ({ ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-1' }),
          }),
        set,
      })
    );

    await expect(storageEngine.acceptPatientInvitation(
      'ABCD-EFGH-JKLM',
      createBlankProfile('patient-1', 'patient@example.com')
    )).rejects.toThrow('current clinician');
    expect(set).not.toHaveBeenCalled();
  });

  it('does not rewrite a relationship for a duplicate pending invitation from the linked clinician', async () => {
    state.auth.currentUser = { uid: 'patient-1', email: 'patient@example.com' };
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({
            id: 'ABCD-EFGH-JKLM', exists: () => true,
            data: () => ({ clinicianId: 'clinician-1', patientEmail: 'patient@example.com', status: 'pending' }),
          })
          .mockResolvedValueOnce({
            id: 'patient-1', exists: () => true,
            data: () => ({ ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-1', acceptedInvitationId: 'OLD-CODE' }),
          }),
        set,
      })
    );

    await expect(storageEngine.acceptPatientInvitation(
      'ABCD-EFGH-JKLM', createBlankProfile('patient-1', 'patient@example.com')
    )).rejects.toThrow('already connected');
    expect(set).not.toHaveBeenCalled();
  });

  it('removes a roster relationship without deleting the patient profile', async () => {
    state.auth.currentUser = { uid: 'clinician-1', email: 'clinician@example.com' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true,
      data: () => ({ ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-1' }),
    });
    firestore.setDoc.mockResolvedValueOnce(undefined);

    await storageEngine.unlinkPatient('patient-1');

    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: 'patient-1' },
      expect.objectContaining({ clinicianId: null, clinicId: null, acceptedInvitationId: null }),
      { merge: true }
    );
  });

  it('does not let a split-brain legacy clinician unlink the canonical owner', async () => {
    state.auth.currentUser = { uid: 'clinician-legacy', email: 'legacy@example.com' };
    firestore.getDoc.mockResolvedValueOnce({
      id: 'patient-1', exists: () => true,
      data: () => ({ ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-canonical', linkedClinicianCode: 'clinician-legacy' }),
    });

    await expect(storageEngine.unlinkPatient('patient-1')).rejects.toThrow('not linked');
    expect(firestore.setDoc).not.toHaveBeenCalled();
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
