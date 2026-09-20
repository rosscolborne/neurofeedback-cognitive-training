import type { AppointmentStatus, AppointmentType } from '../../types';
import type { AppointmentRecord, LegacyAppointment, ProductionAppointment } from './appointmentTypes';
import { isValidTimezone } from './appointmentTime';

const TYPES: AppointmentType[] = ['remote-training', 'in-clinic-evaluation', 'qeeg-mapping', 'protocol-review', 'consultation'];
const STATUSES: AppointmentStatus[] = ['scheduled', 'in-progress', 'completed', 'cancelled', 'missed'];

export function persistedTimestampToMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof timestamp.toMillis === 'function') {
      try {
        const millis = timestamp.toMillis();
        return Number.isFinite(millis) && Number.isSafeInteger(millis) ? millis : null;
      } catch {
        return null;
      }
    }
    if (timestamp.seconds !== undefined || timestamp.nanoseconds !== undefined) {
      if (!Number.isInteger(timestamp.seconds) || !Number.isInteger(timestamp.nanoseconds ?? 0)) return null;
      if ((timestamp.nanoseconds ?? 0) < 0 || (timestamp.nanoseconds ?? 0) > 999_999_999) return null;
      const millis = (timestamp.seconds as number) * 1_000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000);
      return Number.isFinite(millis) && Number.isSafeInteger(millis) ? millis : null;
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
    dataKind: 'canonical',
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
    cancellationRequestId: status === 'cancelled' && typeof value.cancellationRequestId === 'string' ? value.cancellationRequestId : undefined,
    revision,
    schemaVersion: 1,
  };
}

export function readLegacyAppointmentDocument(raw: unknown, documentId: string): LegacyAppointment | null {
  if (!raw || typeof raw !== 'object' || !documentId) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.clientId !== 'string' || !value.clientId ||
    typeof value.clientName !== 'string' || !value.clientName.trim() ||
    typeof value.date !== 'string' || !isValidLegacyDate(value.date) ||
    typeof value.time !== 'string' || !isValidLegacyTime(value.time) ||
    !STATUSES.includes(value.status as AppointmentStatus) ||
    value.startsAt !== undefined
  ) return null;
  const status = value.status as AppointmentStatus;
  const type = TYPES.includes(value.type as AppointmentType) ? value.type as AppointmentType : null;
  const duration = Number(value.durationMinutes);
  return {
    dataKind: 'legacy',
    id: documentId,
    clinicianId: typeof value.clinicianId === 'string' ? value.clinicianId : '',
    patientId: value.clientId,
    patientDisplayName: value.clientName.trim(),
    legacyDate: value.date,
    legacyTime: value.time,
    durationMinutes: Number.isInteger(duration) && duration >= 15 && duration <= 240 ? duration : null,
    type,
    status,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    readOnlyReason: 'Timezone unavailable — migration required',
  };
}

function isValidLegacyDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return year >= 1 && year <= 9999 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isValidLegacyTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export function readAnyAppointmentDocument(raw: unknown, documentId: string): AppointmentRecord | null {
  return readAppointmentDocument(raw, documentId) ?? readLegacyAppointmentDocument(raw, documentId);
}

function sortKey(appointment: AppointmentRecord): string {
  if (appointment.dataKind === 'canonical') return new Date(appointment.startsAtMillis).toISOString();
  return `${appointment.legacyDate}T${appointment.legacyTime}`;
}

export function sortAppointments(appointments: AppointmentRecord[]): AppointmentRecord[] {
  return [...appointments].sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.id.localeCompare(b.id));
}
