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

export async function persistedMessages(patientId: string, clinicianId: string) {
  const thread = `messageThreads/${patientId}/relationships/${clinicianId}`;
  const summary = await adminDb.doc(thread).get();
  const messages = await adminDb.collection(`${thread}/messages`).get();
  return { summary: summary.data(), messages: messages.docs.map((entry) => entry.data()) };
}
