import type { AppointmentRecord, ProductionAppointment } from './appointmentTypes';

export type AppointmentSurfaceState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'content'; appointments: AppointmentRecord[] };

export function resolveAppointmentSurfaceState(
  loadState: 'loading' | 'ready' | 'error',
  appointments: AppointmentRecord[],
  error: string,
): AppointmentSurfaceState {
  if (loadState === 'loading') return { kind: 'loading' };
  if (loadState === 'error') return { kind: 'error', message: error };
  if (appointments.length === 0) return { kind: 'empty' };
  return { kind: 'content', appointments };
}
export function applyConfirmedAppointment(
  appointments: AppointmentRecord[],
  confirmed: ProductionAppointment,
): AppointmentRecord[] {
  return [...appointments.filter((item) => item.id !== confirmed.id), confirmed]
    .sort((a, b) => {
      const aKey = a.dataKind === 'canonical' ? new Date(a.startsAtMillis).toISOString() : `${a.legacyDate}T${a.legacyTime}`;
      const bKey = b.dataKind === 'canonical' ? new Date(b.startsAtMillis).toISOString() : `${b.legacyDate}T${b.legacyTime}`;
      return aKey.localeCompare(bKey) || a.id.localeCompare(b.id);
    });
}
