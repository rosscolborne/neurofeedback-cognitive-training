import type { AppointmentRecord } from './appointmentTypes';

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
