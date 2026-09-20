import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import { readAnyAppointmentDocument, readAppointmentDocument, sortAppointments } from './appointmentMappers';
import { resolveAppointmentInstant } from './appointmentTime';
import type { AppointmentDraft, AppointmentEdit, AppointmentListRole, AppointmentRecord, ProductionAppointment } from './appointmentTypes';

const APPOINTMENT_ID_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
const CANCELLATION_ID_PATTERN = /^cancel_[A-Za-z0-9_-]{20,100}$/;
const APPOINTMENT_TYPES = ['remote-training', 'in-clinic-evaluation', 'qeeg-mapping', 'protocol-review', 'consultation'];

function signedInUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid || uid === 'demo-clinician') throw new Error('Sign in to manage appointments');
  return uid;
}

function normalizeText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(`Text must be ${maxLength} characters or fewer`);
  return normalized;
}

function validateDraft(input: AppointmentDraft | AppointmentEdit): { startsAtMillis: number; notes?: string } {
  if (!APPOINTMENT_TYPES.includes(input.type)) throw new Error('Select a valid appointment type');
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 240) {
    throw new Error('Duration must be between 15 and 240 minutes');
  }
  return {
    startsAtMillis: resolveAppointmentInstant(input.localDate, input.localTime, input.timezone, input.timeDisambiguation),
    notes: normalizeText(input.notes, 2_000),
  };
}

function isLinkedToClinician(raw: Record<string, unknown>, clinicianId: string): boolean {
  if (typeof raw.clinicianId === 'string') return raw.clinicianId === clinicianId;
  return (raw.clinicianId == null) && raw.linkedClinicianCode === clinicianId;
}

export function createAppointmentRequestId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure appointment IDs are unavailable in this browser');
  return `appt_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
}

export function createCancellationRequestId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure cancellation IDs are unavailable in this browser');
  return `cancel_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
}

export class AppointmentRepository {
  async list(role: AppointmentListRole): Promise<AppointmentRecord[]> {
    const uid = signedInUserId();
    const constraints = role === 'clinician'
      ? [[where('clinicianId', '==', uid)]]
      : [
          [where('patientId', '==', uid)],
          // Canonical ownership takes precedence. Firestore does not match a
          // missing field to null, so legacy rows require a trusted
          // `patientId: null` backfill before patient-side enumeration.
          [where('clientId', '==', uid), where('patientId', '==', null)],
        ];
    const snapshots = await Promise.all(constraints.map((filters) => getDocs(query(collection(db, 'appointments'), ...filters))));
    const documents = new Map<string, { id: string; data: () => unknown }>();
    for (const snapshot of snapshots) for (const item of snapshot.docs) documents.set(item.id, item);
    const appointments = [...documents.values()].map((item) => {
      const appointment = readAnyAppointmentDocument(item.data(), item.id);
      if (!appointment) throw new Error(`Appointment ${item.id} has invalid persisted data`);
      return appointment;
    });
    return sortAppointments(appointments);
  }

  async create(input: AppointmentDraft): Promise<ProductionAppointment> {
    const clinicianId = signedInUserId();
    if (!APPOINTMENT_ID_PATTERN.test(input.requestId)) throw new Error('Appointment request ID is invalid');
    if (typeof input.patientId !== 'string' || !input.patientId || input.patientId.length > 128 || input.patientId.includes('/') || input.patientId.startsWith('demo-')) {
      throw new Error('Select a linked production patient');
    }
    const normalized = validateDraft(input);
    const appointmentRef = doc(db, 'appointments', input.requestId);
    const patientRef = doc(db, 'clients', input.patientId);

    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(appointmentRef);
      const patient = await transaction.get(patientRef);
      if (!patient.exists() || !isLinkedToClinician(patient.data(), clinicianId)) {
        throw new Error('You can only schedule appointments for a linked patient');
      }
      const patientDisplayName = typeof patient.data().name === 'string' ? patient.data().name.trim() : '';
      if (!patientDisplayName || patientDisplayName.length > 160) throw new Error('The linked patient profile has no valid name');
      if (existing.exists()) {
        const appointment = readAppointmentDocument(existing.data(), existing.id);
        if (
          !appointment || appointment.createdBy !== clinicianId || appointment.patientId !== input.patientId ||
          appointment.patientDisplayName !== patientDisplayName ||
          appointment.startsAtMillis !== normalized.startsAtMillis || appointment.timezone !== input.timezone ||
          appointment.durationMinutes !== input.durationMinutes || appointment.type !== input.type ||
          (appointment.notes ?? '') !== (normalized.notes ?? '')
        ) {
          throw new Error('Appointment ID is already in use');
        }
        return;
      }
      const clinicianDisplayName = normalizeText(auth.currentUser?.displayName ?? undefined, 160);
      transaction.set(appointmentRef, {
        clinicianId,
        patientId: input.patientId,
        patientDisplayName,
        ...(clinicianDisplayName ? { clinicianDisplayName } : {}),
        startsAt: Timestamp.fromMillis(normalized.startsAtMillis),
        timezone: input.timezone,
        durationMinutes: input.durationMinutes,
        type: input.type,
        status: 'scheduled',
        ...(normalized.notes ? { notes: normalized.notes } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: clinicianId,
        revision: 1,
        schemaVersion: 1,
      });
    });
    return this.getOwned(input.requestId, clinicianId);
  }

  async edit(id: string, input: AppointmentEdit, expectedRevision: number): Promise<ProductionAppointment> {
    const clinicianId = signedInUserId();
    const normalized = validateDraft(input);
    const appointmentRef = doc(db, 'appointments', id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      const current = snapshot.exists() ? readAppointmentDocument(snapshot.data(), snapshot.id) : null;
      if (!current || current.clinicianId !== clinicianId) throw new Error('Appointment not found');
      if (current.revision !== expectedRevision) throw new Error('This appointment changed elsewhere. Reload the calendar before editing it');
      if (current.status !== 'scheduled') throw new Error('Only scheduled appointments can be edited');
      const patient = await transaction.get(doc(db, 'clients', current.patientId));
      if (!patient.exists() || !isLinkedToClinician(patient.data(), clinicianId)) {
        throw new Error('You can only edit appointments for a linked patient');
      }
      transaction.update(appointmentRef, {
        startsAt: Timestamp.fromMillis(normalized.startsAtMillis),
        timezone: input.timezone,
        durationMinutes: input.durationMinutes,
        type: input.type,
        notes: normalized.notes ?? '',
        updatedAt: serverTimestamp(),
        revision: current.revision + 1,
      });
    });
    return this.getOwned(id, clinicianId);
  }

  async cancel(id: string, expectedRevision: number, cancellationRequestId: string): Promise<ProductionAppointment> {
    const clinicianId = signedInUserId();
    if (!CANCELLATION_ID_PATTERN.test(cancellationRequestId)) throw new Error('Cancellation request ID is invalid');
    const appointmentRef = doc(db, 'appointments', id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(appointmentRef);
      const current = snapshot.exists() ? readAppointmentDocument(snapshot.data(), snapshot.id) : null;
      if (!current || current.clinicianId !== clinicianId) throw new Error('Appointment not found');
      if (current.status === 'cancelled') {
        if (
          current.revision === expectedRevision + 1 &&
          current.cancelledBy === clinicianId &&
          current.cancellationRequestId === cancellationRequestId
        ) return;
        throw new Error('This appointment changed elsewhere. Reload the calendar before cancelling it');
      }
      if (current.revision !== expectedRevision) throw new Error('This appointment changed elsewhere. Reload the calendar before cancelling it');
      if (current.status !== 'scheduled') throw new Error('Only scheduled appointments can be cancelled');
      const patient = await transaction.get(doc(db, 'clients', current.patientId));
      if (!patient.exists() || !isLinkedToClinician(patient.data(), clinicianId)) {
        throw new Error('You can only cancel appointments for a linked patient');
      }
      transaction.update(appointmentRef, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledBy: clinicianId,
        cancellationRequestId,
        updatedAt: serverTimestamp(),
        revision: current.revision + 1,
      });
    });
    return this.getOwned(id, clinicianId);
  }

  private async getOwned(id: string, uid: string): Promise<ProductionAppointment> {
    const snapshot = await getDoc(doc(db, 'appointments', id));
    const appointment = snapshot.exists() ? readAppointmentDocument(snapshot.data(), snapshot.id) : null;
    if (!appointment || (appointment.clinicianId !== uid && appointment.patientId !== uid)) {
      throw new Error('The appointment could not be confirmed. Retry loading the calendar');
    }
    return appointment;
  }
}

export const appointmentRepository = new AppointmentRepository();
