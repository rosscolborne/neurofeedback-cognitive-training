import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../types';

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

const savedPatient = (): ClientProfile => createBlankProfile('patient-1', 'patient@example.test', 'Patient One');

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
    // A new profile holds identity only: no training assignment, session aggregates or rewards.
    expect(Object.keys(saved).sort()).toEqual(['brainMaps', 'email', 'id', 'isDemo', 'name', 'patientId', 'status']);
  });

  it('persists a profile change across a repository reload', async () => {
    const stored: Record<string, unknown> = {};
    firestore.setDoc.mockImplementationOnce(async (_ref: unknown, payload: Record<string, unknown>) => {
      Object.assign(stored, payload);
    });
    firestore.getDoc.mockImplementationOnce(async () => ({
      id: 'patient-1', exists: () => true, data: () => stored,
    }));
    await storageEngine.saveClient({ ...savedPatient(), avatarUrl: 'data:image/png;base64,AAAA' });
    await expect(storageEngine.getClient('patient-1')).resolves.toMatchObject({
      id: 'patient-1', name: 'Patient One', avatarUrl: 'data:image/png;base64,AAAA',
    });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { type: 'doc', path: 'clients', id: 'patient-1' },
      expect.objectContaining({ avatarUrl: 'data:image/png;base64,AAAA' }),
      { merge: true },
    );
  });

  it('propagates profile write failures', async () => {
    firestore.setDoc.mockRejectedValueOnce(new Error('profile save unavailable'));
    await expect(storageEngine.saveClient(savedPatient())).rejects.toThrow('profile save unavailable');
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
      data: () => ({ id: user.uid, email: user.email, name: '', status: 'active' }) });
    firestore.updateDoc.mockRejectedValueOnce(new Error('profile no longer exists'));

    await expect(storageEngine.getCurrentClient(user)).rejects.toThrow('profile no longer exists');
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

});
