import { describe, expect, it } from 'vitest';
import type { ProductionAppointment } from '../appointmentTypes';
import { groupAppointmentsForDisplay, resolveAppointmentSurfaceState } from '../appointmentViewState';

const appointment = (overrides: Partial<ProductionAppointment> = {}): ProductionAppointment => ({
  dataKind: 'canonical',
  id: 'appt-1', clinicianId: 'clinician-1', patientId: 'patient-1', patientDisplayName: 'Patient One',
  startsAtMillis: 100, timezone: 'UTC', durationMinutes: 45, type: 'consultation', status: 'scheduled',
  createdAtMillis: 1, updatedAtMillis: 1, createdBy: 'clinician-1', revision: 1, schemaVersion: 1, ...overrides,
});
describe('appointment surface state', () => {
  it('keeps loading, empty, error/retry, and content states distinct', () => {
    expect(resolveAppointmentSurfaceState('loading', [], '')).toEqual({ kind: 'loading' });
    expect(resolveAppointmentSurfaceState('ready', [], '')).toEqual({ kind: 'empty' });
    expect(resolveAppointmentSurfaceState('error', [], 'offline')).toEqual({ kind: 'error', message: 'offline' });
    expect(resolveAppointmentSurfaceState('ready', [appointment()], '')).toMatchObject({ kind: 'content' });
  });

  it('groups for display without moving cancelled appointments into Upcoming', () => {
    const now = 10 * 60_000;
    const future = appointment({ id: 'future', startsAtMillis: now + 60_000 });
    const underway = appointment({ id: 'underway', startsAtMillis: now - 10 * 60_000, status: 'in-progress' });
    const cancelledFuture = appointment({ id: 'cancelled-future', startsAtMillis: now + 120_000, status: 'cancelled' });
    const finished = appointment({ id: 'finished', startsAtMillis: 0, durationMinutes: 5, status: 'completed' });
    const elapsed = appointment({ id: 'elapsed', startsAtMillis: 0, durationMinutes: 5 });
    const groups = groupAppointmentsForDisplay([finished, future, cancelledFuture, underway, elapsed], now);
    expect(groups.map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
      ['upcoming', ['future', 'underway']],
      ['past', ['finished', 'elapsed']],
      ['cancelled', ['cancelled-future']],
    ]);
    expect(groupAppointmentsForDisplay([future], now).map((group) => group.key)).toEqual(['upcoming']);
  });
});
