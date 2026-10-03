import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import { readAnyAppointmentDocument, sortAppointments } from './appointmentMappers';
import type { AppointmentRecord } from './appointmentTypes';

function signedInUserId(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to manage appointments');
  return uid;
}

export interface AppointmentListOptions {
  /** Called with the number of documents that were skipped because they could not be read. */
  onUnreadable?: (count: number) => void;
}

export class AppointmentRepository {
  /**
   * The signed-in patient's appointments. Unreadable documents are skipped (ids logged for
   * support, never shown) and reported through `onUnreadable` so the view can say some
   * appointments are missing. If nothing is readable the list still fails, so malformed data
   * never looks like an empty calendar.
   */
  async list(options: AppointmentListOptions = {}): Promise<AppointmentRecord[]> {
    const uid = signedInUserId();
    const constraints = [
      [where('patientId', '==', uid)],
      // Canonical ownership takes precedence. Firestore does not match a
      // missing field to null, so legacy rows require a trusted
      // `patientId: null` backfill before patient-side enumeration.
      [where('clientId', '==', uid), where('patientId', '==', null)],
    ];
    const snapshots = await Promise.all(constraints.map((filters) => getDocs(query(collection(db, 'appointments'), ...filters))));
    const documents = new Map<string, { id: string; data: () => unknown }>();
    for (const snapshot of snapshots) for (const item of snapshot.docs) documents.set(item.id, item);
    const appointments: AppointmentRecord[] = [];
    const unreadableIds: string[] = [];
    for (const item of documents.values()) {
      const appointment = readAnyAppointmentDocument(item.data(), item.id);
      if (appointment) appointments.push(appointment);
      else unreadableIds.push(item.id);
    }
    if (unreadableIds.length > 0) {
      console.warn(`Skipped ${unreadableIds.length} appointment document(s) with invalid persisted data`, unreadableIds);
      if (appointments.length === 0) throw new Error('Appointment details could not be read');
      options.onUnreadable?.(unreadableIds.length);
    }
    return sortAppointments(appointments);
  }
}

export const appointmentRepository = new AppointmentRepository();
