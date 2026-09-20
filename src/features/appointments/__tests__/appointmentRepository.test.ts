import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'clinician-1' } as null | { uid: string } } }));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })) }));

vi.mock('../../../services/firebase', () => ({ auth: state.auth, db: { path: 'db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ type: 'collection', path }),
  doc: (_db: unknown, path: string, id: string) => ({ type: 'doc', path, id }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
  Timestamp: { fromMillis: (millis: number) => ({ __timestamp: millis }) },
  ...firestore,
}));

import { AppointmentRepository } from '../appointmentRepository';

const canonical = (overrides: Record<string, unknown> = {}) => ({
  clinicianId: 'clinician-1', patientId: 'patient-1', patientDisplayName: 'Patient One',
  startsAt: { toMillis: () => Date.parse('2026-09-19T14:30:00.000Z') }, timezone: 'America/Toronto',
  durationMinutes: 45, type: 'consultation', status: 'scheduled', notes: 'Check in',
  createdBy: 'clinician-1', createdAt: 10, updatedAt: 20, revision: 1, schemaVersion: 1, ...overrides,
});
const document = (id: string, data: Record<string, unknown>, exists = true) => ({ id, exists: () => exists, data: () => data });
const draft = {
  requestId: 'appt_12345678901234567890123456789012', patientId: 'patient-1',
  localDate: '2026-09-19', localTime: '10:30', timezone: 'America/Toronto', durationMinutes: 45,
  type: 'consultation' as const, notes: 'Check in',
};

describe('production appointment repository', () => {
  const repository = new AppointmentRepository();
  beforeEach(() => { vi.clearAllMocks(); state.auth.currentUser = { uid: 'clinician-1' }; });

  it('queries only the authenticated participant and returns stable ordering', async () => {
    firestore.getDocs.mockResolvedValueOnce({ docs: [
      document('later', canonical({ startsAt: 200 })), document('same-b', canonical({ startsAt: 100 })), document('same-a', canonical({ startsAt: 100 })),
    ] });
    expect((await repository.list('clinician')).map((item) => item.id)).toEqual(['same-a', 'same-b', 'later']);
    expect(firestore.getDocs.mock.calls[0][0].constraints).toContainEqual({ field: 'clinicianId', op: '==', value: 'clinician-1' });

    state.auth.currentUser = { uid: 'patient-1' };
    firestore.getDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({ docs: [] });
    await repository.list('patient');
    expect(firestore.getDocs.mock.calls[1][0].constraints).toContainEqual({ field: 'patientId', op: '==', value: 'patient-1' });
    expect(firestore.getDocs.mock.calls[2][0].constraints).toContainEqual({ field: 'clientId', op: '==', value: 'patient-1' });
  });

  it('propagates query failures instead of presenting an empty calendar', async () => {
    firestore.getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.list('clinician')).rejects.toThrow('offline');
  });

  it('reports malformed persisted data rather than disguising it as an empty calendar', async () => {
    firestore.getDocs.mockResolvedValueOnce({ docs: [document('broken', { clinicianId: 'clinician-1' })] });
    await expect(repository.list('clinician')).rejects.toThrow(/broken.*invalid persisted data/);
  });

  it('creates a linked-patient appointment with normalized time and server-owned metadata', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce(document(draft.requestId, {}, false)).mockResolvedValueOnce(document('patient-1', { clinicianId: 'clinician-1', name: 'Patient One' })),
      set,
    }));
    firestore.getDoc.mockResolvedValueOnce(document(draft.requestId, canonical()));

    await expect(repository.create(draft)).resolves.toMatchObject({ id: draft.requestId, patientId: 'patient-1' });
    expect(set).toHaveBeenCalledWith({ type: 'doc', path: 'appointments', id: draft.requestId }, expect.objectContaining({
      startsAt: { __timestamp: Date.parse('2026-09-19T14:30:00.000Z') },
      createdAt: { __serverTimestamp: true }, updatedAt: { __serverTimestamp: true }, createdBy: 'clinician-1', status: 'scheduled',
    }));
  });

  it('rejects an unrelated patient before any appointment write', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce(document(draft.requestId, {}, false)).mockResolvedValueOnce(document('patient-1', { clinicianId: 'other', name: 'Patient One' })), set,
    }));
    await expect(repository.create(draft)).rejects.toThrow(/linked patient/);
    expect(set).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('does not return a failed create as persisted and keeps the stable request ID retryable', async () => {
    firestore.runTransaction.mockRejectedValueOnce(new Error('permission denied'));
    await expect(repository.create(draft)).rejects.toThrow('permission denied');
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('persists cancellation as a terminal audited status instead of deleting', async () => {
    const update = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce(document('appt-1', canonical())).mockResolvedValueOnce(document('patient-1', { clinicianId: 'clinician-1' })), update,
    }));
    firestore.getDoc.mockResolvedValueOnce(document('appt-1', canonical({ status: 'cancelled', cancelledAt: 30, cancelledBy: 'clinician-1', revision: 2 })));
    await expect(repository.cancel('appt-1', 1, 'cancel_12345678901234567890123456789012')).resolves.toMatchObject({ status: 'cancelled', revision: 2 });
    expect(update).toHaveBeenCalledWith({ type: 'doc', path: 'appointments', id: 'appt-1' }, expect.objectContaining({ status: 'cancelled', cancelledAt: { __serverTimestamp: true }, cancelledBy: 'clinician-1', revision: 2 }));
  });

  it('rejects stale edits and cancellation attempts with an actionable conflict', async () => {
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValue(document('appt-1', canonical({ revision: 4 }))), update: vi.fn(),
    }));
    await expect(repository.edit('appt-1', draft, 3)).rejects.toThrow(/changed elsewhere.*Reload/);
    await expect(repository.cancel('appt-1', 3, 'cancel_12345678901234567890123456789012')).rejects.toThrow(/changed elsewhere.*Reload/);
  });

  it('accepts only an exact idempotent retry of the same completed cancellation', async () => {
    const cancellationRequestId = 'cancel_12345678901234567890123456789012';
    const cancelled = canonical({ status: 'cancelled', revision: 2, cancelledAt: 30, cancelledBy: 'clinician-1', cancellationRequestId });
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValue(document('appt-1', cancelled)), update: vi.fn(),
    }));
    firestore.getDoc.mockResolvedValueOnce(document('appt-1', cancelled));
    await expect(repository.cancel('appt-1', 1, cancellationRequestId)).resolves.toMatchObject({ status: 'cancelled', revision: 2 });

    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValue(document('appt-1', cancelled)), update: vi.fn(),
    }));
    await expect(repository.cancel('appt-1', 1, 'cancel_abcdefghijklmnopqrstuvwxyz123456')).rejects.toThrow(/changed elsewhere.*Reload/);
  });

  it('persists an edit with a new normalized instant, server update time, and revision', async () => {
    const update = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce(document('appt-1', canonical())).mockResolvedValueOnce(document('patient-1', { clinicianId: 'clinician-1' })), update,
    }));
    firestore.getDoc.mockResolvedValueOnce(document('appt-1', canonical({ startsAt: Date.parse('2026-09-19T15:30:00.000Z'), revision: 2 })));

    await expect(repository.edit('appt-1', { ...draft, localTime: '11:30' }, 1)).resolves.toMatchObject({
      startsAtMillis: Date.parse('2026-09-19T15:30:00.000Z'), revision: 2,
    });
    expect(update).toHaveBeenCalledWith({ type: 'doc', path: 'appointments', id: 'appt-1' }, expect.objectContaining({
      startsAt: { __timestamp: Date.parse('2026-09-19T15:30:00.000Z') }, updatedAt: { __serverTimestamp: true }, revision: 2,
    }));
  });

  it('prevents edits to cancelled appointments and validates duration before persistence', async () => {
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce(document('appt-1', canonical({ status: 'cancelled', cancelledAt: 30, cancelledBy: 'clinician-1' }))), update: vi.fn(),
    }));
    await expect(repository.edit('appt-1', draft, 1)).rejects.toThrow(/scheduled appointments/);
    await expect(repository.edit('appt-2', { ...draft, durationMinutes: 5 }, 1)).rejects.toThrow(/between 15 and 240/);
  });
});
