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

export interface AppointmentDisplayGroup {
  key: 'upcoming' | 'past' | 'cancelled';
  title: string;
  items: AppointmentRecord[];
}

/**
 * Display-only grouping: actionable appointments that have not ended, then past ones, then cancelled.
 * Each group keeps the repository's order; stored status and times are never changed.
 */
export function groupAppointmentsForDisplay(appointments: AppointmentRecord[], nowMs: number): AppointmentDisplayGroup[] {
  const isUpcoming = (appointment: AppointmentRecord) => appointment.dataKind === 'canonical'
    && (appointment.status === 'scheduled' || appointment.status === 'in-progress')
    && appointment.startsAtMillis + appointment.durationMinutes * 60_000 >= nowMs;
  const groups: AppointmentDisplayGroup[] = [
    { key: 'upcoming', title: 'Upcoming', items: appointments.filter(isUpcoming) },
    { key: 'past', title: 'Past', items: appointments.filter((appointment) => appointment.status !== 'cancelled' && !isUpcoming(appointment)) },
    { key: 'cancelled', title: 'Cancelled', items: appointments.filter((appointment) => appointment.status === 'cancelled') },
  ];
  return groups.filter((group) => group.items.length > 0);
}
