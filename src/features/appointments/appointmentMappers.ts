import type { AppointmentStatus, AppointmentType } from '../../types';
import type { ProductionAppointment } from './appointmentTypes';
import { isValidTimezone } from './appointmentTime';

const TYPES: AppointmentType[] = ['remote-training', 'in-clinic-evaluation', 'qeeg-mapping', 'protocol-review', 'consultation'];
const STATUSES: AppointmentStatus[] = ['scheduled', 'in-progress', 'completed', 'cancelled', 'missed'];

export function persistedTimestampToMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof timestamp.toMillis === 'function') {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : null;
    }
    if (Number.isFinite(timestamp.seconds)) {
      return (timestamp.seconds as number) * 1_000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000);
    }
  }
  return null;
}
export function readAppointmentDocument(raw: unknown, documentId: string): ProductionAppointment | null {
  if (!raw || typeof raw !== 'object' || !documentId) return null;
  const value = raw as Record<string, unknown>;
  const startsAtMillis = persistedTimestampToMillis(value.startsAt);
  const createdAtMillis = persistedTimestampToMillis(value.createdAt);
  const updatedAtMillis = persistedTimestampToMillis(value.updatedAt);
  const cancelledAtMillis = persistedTimestampToMillis(value.cancelledAt);
  const durationMinutes = Number(value.durationMinutes);
  const revision = Number(value.revision ?? 1);
  const type = value.type as AppointmentType;
  const status = value.status as AppointmentStatus;

  if (
    typeof value.clinicianId !== 'string' || !value.clinicianId ||
    typeof value.patientId !== 'string' || !value.patientId ||
    typeof value.patientDisplayName !== 'string' || !value.patientDisplayName.trim() ||
    typeof value.timezone !== 'string' || !isValidTimezone(value.timezone) ||
    startsAtMillis == null ||
    !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240 ||
    !TYPES.includes(type) || !STATUSES.includes(status) ||
    typeof value.createdBy !== 'string' || !value.createdBy ||
    !Number.isInteger(revision) || revision < 1
  ) {
    return null;
  }

  if (status === 'cancelled' && (cancelledAtMillis == null || typeof value.cancelledBy !== 'string')) return null;

  return {
    id: documentId,
    clinicianId: value.clinicianId,
    patientId: value.patientId,
    patientDisplayName: value.patientDisplayName.trim(),
    clinicianDisplayName: typeof value.clinicianDisplayName === 'string' ? value.clinicianDisplayName.trim() || undefined : undefined,
    startsAtMillis,
    timezone: value.timezone,
    durationMinutes,
    type,
    status,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    createdAtMillis,
    updatedAtMillis,
    createdBy: value.createdBy,
    cancelledAtMillis: status === 'cancelled' ? cancelledAtMillis : undefined,
    cancelledBy: status === 'cancelled' ? value.cancelledBy as string : undefined,
    revision,
    schemaVersion: 1,
  };
}

export function sortAppointments(appointments: ProductionAppointment[]): ProductionAppointment[] {
  return [...appointments].sort((a, b) => a.startsAtMillis - b.startsAtMillis || a.id.localeCompare(b.id));
}
