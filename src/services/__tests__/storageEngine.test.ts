import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  collection: (_db: unknown, path: string) => ({ type: 'collection', path }),
  doc: (_db: unknown, path: string, id: string) => ({ type: 'doc', path, id }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  ...firestore,
}));

import { INITIAL_DEMO_CLIENTS, createBlankProfile, storageEngine } from '../storageEngine';

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
      clinicianName: 'Dr. Example',
      patientName: 'Patient One',
      patientEmail: ' Patient@One.Example ',
      condition: 'Peak Performance',
      assignedProtocol: 'theta-beta-ratio',
      prescribedSessionsPerWeek: 3,
    });

    expect(invitation.id).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(invitation).toMatchObject({ clinicianId: 'clinician-1', patientEmail: 'patient@one.example', status: 'pending' });
    expect(invitation.uniquenessClaimId).toBe('clinician-1__patient@one.example');
    expect(writes).toContainEqual({
      ref: { type: 'doc', path: 'patientInvitations', id: invitation.id },
      payload: expect.objectContaining({ patientEmail: 'patient@one.example', status: 'pending', expiresAt: expect.any(Date) }),
    });
    expect(writes).toContainEqual({
      ref: { type: 'doc', path: 'patientInvitationClaims', id: invitation.uniquenessClaimId },
      payload: expect.objectContaining({ patientEmail: 'patient@one.example', invitationId: invitation.id }),
    });
  });

  it('rejects self invitations and duplicate pending invitations', async () => {
    await expect(storageEngine.createPatientInvitation({
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
      clinicianName: 'Dr. Example', patientName: 'Patient', patientEmail: 'patient@example.com',
      condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
    })).resolves.toMatchObject({ status: 'pending' });
    expect(writes).toHaveLength(2);
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
            data: () => ({ clinicianId: 'clinician-1', clinicianName: 'Dr. Example', patientEmail: 'patient@example.com', patientName: 'Patient One', condition: 'Peak Performance', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending', uniquenessClaimId: 'claim-1', schemaVersion: 1 }),
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

    expect(linked).toMatchObject({ id: 'patient-1', clinicianId: 'clinician-1', acceptedInvitationId: 'ABCD-EFGH-JKLM' });
    expect(writes[0]).toMatchObject({ ref: { type: 'doc', path: 'clients', id: 'patient-1' }, payload: expect.objectContaining({ clinicianId: 'clinician-1' }) });
    expect(writes[1]).toMatchObject({ ref: { type: 'doc', path: 'patientInvitations', id: 'ABCD-EFGH-JKLM' }, payload: expect.objectContaining({ status: 'accepted', patientId: 'patient-1' }) });
    expect(deletes).toEqual([{ type: 'doc', path: 'patientInvitationClaims', id: 'claim-1' }]);
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
    expect(deletes).toEqual([{ type: 'doc', path: 'patientInvitationClaims', id: 'claim-1' }]);
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
      clinicianId: 'clinician-1', acceptedInvitationId: 'ABCD-EFGH-JKLM',
    };
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) =>
      callback({
        get: vi.fn()
          .mockResolvedValueOnce({
            id: 'ABCD-EFGH-JKLM', exists: () => true,
            data: () => ({ clinicianId: 'clinician-1', patientId: 'patient-1', patientEmail: 'patient@example.com', status: 'accepted' }),
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
      expect.objectContaining({ clinicianId: null, acceptedInvitationId: null }),
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
