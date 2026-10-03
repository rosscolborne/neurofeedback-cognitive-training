import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'patient-1' } as null | { uid: string } } }));
const firestore = vi.hoisted(() => ({ getDocs: vi.fn() }));

vi.mock('../../../services/firebase', () => ({ auth: state.auth, db: { path: 'db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ type: 'collection', path }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  where: (field: string, op: string, value: string) => ({ field, op, value }),
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

describe('production appointment repository', () => {
  const repository = new AppointmentRepository();
  beforeEach(() => { vi.clearAllMocks(); state.auth.currentUser = { uid: 'patient-1' }; });

  it('queries only the signed-in patient and returns stable ordering', async () => {
    firestore.getDocs.mockResolvedValueOnce({ docs: [
      document('later', canonical({ startsAt: 200 })), document('same-b', canonical({ startsAt: 100 })), document('same-a', canonical({ startsAt: 100 })),
    ] }).mockResolvedValueOnce({ docs: [] });
    expect((await repository.list()).map((item) => item.id)).toEqual(['same-a', 'same-b', 'later']);
    expect(firestore.getDocs.mock.calls[0][0].constraints).toEqual([{ field: 'patientId', op: '==', value: 'patient-1' }]);
    expect(firestore.getDocs.mock.calls[1][0].constraints).toEqual([
      { field: 'clientId', op: '==', value: 'patient-1' },
      { field: 'patientId', op: '==', value: null },
    ]);
  });

  it('refuses a signed-out list', async () => {
    state.auth.currentUser = null;
    await expect(repository.list()).rejects.toThrow('Sign in');
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('propagates query failures instead of presenting an empty calendar', async () => {
    firestore.getDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.list()).rejects.toThrow('offline');
  });

  it('reports malformed persisted data rather than disguising it as an empty calendar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    firestore.getDocs.mockResolvedValueOnce({ docs: [document('broken', { clinicianId: 'clinician-1' })] }).mockResolvedValueOnce({ docs: [] });
    const failure = repository.list();
    await expect(failure).rejects.toThrow('Appointment details could not be read');
    await expect(failure).rejects.not.toThrow(/broken/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid persisted data'), ['broken']);
    warn.mockRestore();
  });

  it('keeps readable appointments when one document is malformed and reports how many were skipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onUnreadable = vi.fn();
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [document('good', canonical()), document('broken', { clinicianId: 'clinician-1', type: 'unknown' })] })
      .mockResolvedValueOnce({ docs: [] });
    const listed = await repository.list({ onUnreadable });
    expect(listed.map((item) => item.id)).toEqual(['good']);
    expect(onUnreadable).toHaveBeenCalledWith(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipped 1'), ['broken']);
    warn.mockRestore();
  });

});
