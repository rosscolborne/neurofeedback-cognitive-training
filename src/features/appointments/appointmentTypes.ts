import type { AppointmentStatus, AppointmentType } from '../../types';

export type AppointmentTimeDisambiguation = 'earlier' | 'later' | 'reject';

export interface ProductionAppointment {
  dataKind: 'canonical';
  id: string;
  clinicianId: string;
  patientId: string;
  patientDisplayName: string;
  clinicianDisplayName?: string;
  startsAtMillis: number;
  timezone: string;
  durationMinutes: number;
  type: AppointmentType;
  status: AppointmentStatus;
  notes?: string;
  createdAtMillis: number | null;
  updatedAtMillis: number | null;
  createdBy: string;
  cancelledAtMillis?: number | null;
  cancelledBy?: string;
  cancellationRequestId?: string;
  revision: number;
  schemaVersion: 1;
}

export interface LegacyAppointment {
  dataKind: 'legacy';
  id: string;
  clinicianId: string;
  patientId: string;
  patientDisplayName: string;
  legacyDate: string;
  legacyTime: string;
  durationMinutes: number | null;
  type: AppointmentType | null;
  status: AppointmentStatus;
  notes?: string;
  readOnlyReason: string;
}

export type AppointmentRecord = ProductionAppointment | LegacyAppointment;

export function isCanonicalAppointment(appointment: AppointmentRecord): appointment is ProductionAppointment {
  return appointment.dataKind === 'canonical';
}

export interface AppointmentDraft {
  requestId: string;
  patientId: string;
  localDate: string;
  localTime: string;
  timezone: string;
  timeDisambiguation?: AppointmentTimeDisambiguation;
  durationMinutes: number;
  type: AppointmentType;
  notes?: string;
}

export interface AppointmentEdit {
  localDate: string;
  localTime: string;
  timezone: string;
  timeDisambiguation?: AppointmentTimeDisambiguation;
  durationMinutes: number;
  type: AppointmentType;
  notes?: string;
}

export type AppointmentListRole = 'clinician' | 'patient';
