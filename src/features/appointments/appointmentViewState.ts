import type { ProductionAppointment } from './appointmentTypes';

export type AppointmentSurfaceState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'content'; appointments: ProductionAppointment[] };

export function resolveAppointmentSurfaceState(
  loadState: 'loading' | 'ready' | 'error',
  appointments: ProductionAppointment[],
  error: string,
): AppointmentSurfaceState {
  if (loadState === 'loading') return { kind: 'loading' };
  if (loadState === 'error') return { kind: 'error', message: error };
  if (appointments.length === 0) return { kind: 'empty' };
  return { kind: 'content', appointments };
}
export function applyConfirmedAppointment(
  appointments: ProductionAppointment[],
  confirmed: ProductionAppointment,
): ProductionAppointment[] {
  return [...appointments.filter((item) => item.id !== confirmed.id), confirmed]
    .sort((a, b) => a.startsAtMillis - b.startsAtMillis || a.id.localeCompare(b.id));
}
