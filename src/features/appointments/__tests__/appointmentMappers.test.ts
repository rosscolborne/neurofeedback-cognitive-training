import { describe, expect, it } from 'vitest';
import { persistedTimestampToMillis, readAnyAppointmentDocument, readAppointmentDocument, sortAppointments } from '../appointmentMappers';

const canonical = (overrides: Record<string, unknown> = {}) => ({
  clinicianId: 'clinician-1', patientId: 'patient-1', patientDisplayName: 'Patient One',
  startsAt: { seconds: 1_789_473_600, nanoseconds: 500_000_000 }, timezone: 'UTC',
  durationMinutes: 45, type: 'consultation', status: 'scheduled', createdBy: 'clinician-1',
  createdAt: 1, updatedAt: 2, revision: 1, schemaVersion: 1, ...overrides,
});
describe('appointment persistence mapper', () => {
  it('maps Firestore timestamp shapes without changing the represented instant', () => {
    expect(persistedTimestampToMillis({ seconds: 10, nanoseconds: 500_000_000 })).toBe(10_500);
    expect(persistedTimestampToMillis({ toMillis: () => 42 })).toBe(42);
    expect(readAppointmentDocument(canonical(), 'appt-1')?.startsAtMillis).toBe(1_789_473_600_500);
  });

  it('rejects malformed timestamp components and unsafe final milliseconds', () => {
    expect(persistedTimestampToMillis({ seconds: 10.5, nanoseconds: 0 })).toBeNull();
    expect(persistedTimestampToMillis({ seconds: 10, nanoseconds: -1 })).toBeNull();
    expect(persistedTimestampToMillis({ seconds: 10, nanoseconds: 1_000_000_000 })).toBeNull();
    expect(persistedTimestampToMillis({ seconds: Number.MAX_SAFE_INTEGER, nanoseconds: 0 })).toBeNull();
  });

  it('rejects malformed, timezone-less, and incomplete cancelled documents', () => {
    expect(readAppointmentDocument(canonical({ timezone: undefined }), 'appt-1')).toBeNull();
    expect(readAppointmentDocument(canonical({ durationMinutes: 5 }), 'appt-1')).toBeNull();
    expect(readAppointmentDocument(canonical({ status: 'cancelled' }), 'appt-1')).toBeNull();
  });

  it('maps a cancellation only with its server audit fields', () => {
    const mapped = readAppointmentDocument(canonical({ status: 'cancelled', cancelledAt: 99, cancelledBy: 'clinician-1' }), 'appt-1');
    expect(mapped).toMatchObject({ status: 'cancelled', cancelledAtMillis: 99, cancelledBy: 'clinician-1' });
  });

  it('orders equal instants deterministically by stable ID', () => {
    const a = readAppointmentDocument(canonical(), 'a')!;
    const b = readAppointmentDocument(canonical({ startsAt: 50 }), 'b')!;
    const c = readAppointmentDocument(canonical(), 'c')!;
    expect(sortAppointments([c, a, b]).map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('maps legacy wall-clock fields without inventing a timezone or instant', () => {
    const legacy = readAnyAppointmentDocument({
      clinicianId: 'clinician-1', clientId: 'patient-1', clientName: 'Patient One',
      date: '2026-10-01', time: '09:00', durationMinutes: 45, type: 'consultation', status: 'scheduled',
    }, 'legacy-1');
    expect(legacy).toEqual(expect.objectContaining({
      dataKind: 'legacy', legacyDate: '2026-10-01', legacyTime: '09:00',
      readOnlyReason: 'Timezone unavailable — migration required',
    }));
    expect(legacy).not.toHaveProperty('timezone');
    expect(legacy).not.toHaveProperty('startsAtMillis');
  });
});
