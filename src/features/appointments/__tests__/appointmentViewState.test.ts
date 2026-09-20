import { describe, expect, it } from 'vitest';
import type { ProductionAppointment } from '../appointmentTypes';
import { applyConfirmedAppointment, resolveAppointmentSurfaceState } from '../appointmentViewState';

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

  it('adds a create only after repository confirmation', () => {
    const original: ProductionAppointment[] = [];
    expect(original).toEqual([]);
    expect(applyConfirmedAppointment(original, appointment())).toEqual([appointment()]);
  });

  it('replaces confirmed edits and cancellations without optimistic duplicates', () => {
    const original = [appointment()];
    const edited = appointment({ startsAtMillis: 200, revision: 2 });
    expect(applyConfirmedAppointment(original, edited)).toEqual([edited]);
    const cancelled = appointment({ startsAtMillis: 200, status: 'cancelled', cancelledAtMillis: 300, cancelledBy: 'clinician-1', revision: 3 });
    expect(applyConfirmedAppointment([edited], cancelled)).toEqual([cancelled]);
  });

  it('leaves the last confirmed UI data unchanged when a mutation fails', () => {
    const confirmed = [appointment()];
    const failedResult: ProductionAppointment | null = null;
    const visible = failedResult ? applyConfirmedAppointment(confirmed, failedResult) : confirmed;
    expect(visible).toBe(confirmed);
  });
});
