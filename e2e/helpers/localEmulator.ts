import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-neurasticity-protocol-e2e';
if (process.env.GCLOUD_PROJECT !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Local browser E2E requires Auth and Firestore emulators for the demo project.');
}

const adminApp = initializeApp({ projectId }, `local-e2e-${randomUUID()}`);
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);

export type LocalPatientFixture = {
  clinician: { uid: string; email: string; password: string };
  patient: { uid: string; email: string; password: string };
  name: string;
};

export async function seedLinkedPatient(extra: Record<string, unknown> = {}): Promise<LocalPatientFixture> {
  const id = randomUUID().slice(0, 12);
  const clinicianUid = `clinician-${id}`;
  const patientUid = `patient-${id}`;
  const clinician = { uid: clinicianUid, email: `clinician-${id}@example.test`, password: 'LocalEmulator!123' };
  const patient = { uid: patientUid, email: `patient-${id}@example.test`, password: 'LocalEmulator!123' };
  const name = `Protocol Patient ${id}`;
  await Promise.all([
    adminAuth.createUser({ ...clinician, displayName: 'Local Clinician' }),
    adminAuth.createUser({ ...patient, displayName: name }),
  ]);
  await Promise.all([
    adminDb.doc(`users/${clinicianUid}`).set({ role: 'clinician' }),
    adminDb.doc(`users/${patientUid}`).set({ role: 'patient' }),
    adminDb.doc(`clinics/${clinicianUid}`).set({ id: clinicianUid, name: 'Local E2E Clinic', practitionerIds: [clinicianUid], timezone: 'America/Toronto' }),
    adminDb.doc(`practitioners/${clinicianUid}`).set({ id: clinicianUid, userId: clinicianUid, clinicId: clinicianUid, displayName: 'Local Clinician', credentials: [] }),
    adminDb.doc(`clients/${patientUid}`).set({
      id: patientUid, name, email: patient.email, status: 'active',
      clinicianId: clinicianUid, clinicId: clinicianUid,
      condition: 'ADHD (Inattentive)', allowedExperiences: ['skyline-drift'],
      prescribedSessionsPerWeek: 3, completedSessionsCount: 0, currentStreak: 0,
      brainMaps: [], badges: [], isDemo: false, ...extra,
    }),
  ]);
  return { clinician, patient, name };
}

/** Provision records only in the isolated emulator for rules-bound persistence tests. */
export async function seedPersistenceRecords(fixture: LocalPatientFixture, marker: string): Promise<string> {
  const { patient, clinician } = fixture;
  const invitationCode = `invitation-${randomUUID()}`;
  const thread = `messageThreads/${patient.uid}/relationships/${clinician.uid}`;
  await Promise.all([
    adminDb.doc(`users/${patient.uid}`).set({ role: 'patient', email: patient.email }),
    adminDb.doc(`users/${clinician.uid}`).set({ role: 'clinician', email: clinician.email }),
    adminDb.doc(`clients/${patient.uid}`).update({ recentCompletedSessionIds: [`session-${marker}`], acceptedInvitationId: invitationCode }),
    adminDb.doc(`clinics/${clinician.uid}`).update({ branding: { name: `Brand ${marker}` } }),
    adminDb.doc(`sessions/session-${marker}`).set({ patientId: patient.uid, clinicianId: clinician.uid, clinicId: clinician.uid, patientNotes: marker, isDemo: true }),
    adminDb.doc(`appointments/appointment-${marker}`).set({ patientId: patient.uid, clinicianId: clinician.uid, createdBy: clinician.uid, notes: marker, status: 'scheduled', durationMinutes: 45, type: 'remote-training' }),
    adminDb.doc(`patientInvitations/${invitationCode}`).set({ patientEmail: patient.email, patientName: marker, patientId: patient.uid, clinicianId: clinician.uid, status: 'accepted' }),
    adminDb.doc(thread).set({ patientId: patient.uid, clinicianId: clinician.uid, lastMessageText: marker }),
    adminDb.doc(`${thread}/messages/message-${marker}`).set({ text: marker, senderRole: 'patient', senderId: patient.uid }),
  ]);
  return invitationCode;
}
