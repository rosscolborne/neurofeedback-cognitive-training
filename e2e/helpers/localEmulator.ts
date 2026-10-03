import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

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
  patient: { uid: string; email: string; password: string };
  name: string;
};

/**
 * A patient on the current pre-Phase-2 account model: an Auth account, a
 * users/{uid} role and a clients/{uid} profile with no clinician relationship.
 */
export async function seedPatient(extra: Record<string, unknown> = {}): Promise<LocalPatientFixture> {
  const id = randomUUID().slice(0, 12);
  const patient = { uid: `patient-${id}`, email: `patient-${id}@example.test`, password: 'LocalEmulator!123' };
  const name = `Protocol Patient ${id}`;
  await adminAuth.createUser({ ...patient, displayName: name });
  await Promise.all([
    adminDb.doc(`users/${patient.uid}`).set({ role: 'patient' }),
    adminDb.doc(`clients/${patient.uid}`).set({
      id: patient.uid, name, email: patient.email, status: 'active',
      allowedExperiences: ['neuro-gambit'], completedSessionsCount: 0, currentStreak: 0,
      brainMaps: [], badges: [], isDemo: false, ...extra,
    }),
  ]);
  return { patient, name };
}

/**
 * An account that chose the retired practitioner role. The app shows it an
 * unsupported-account screen until Phase 2 removes the role.
 */
export async function seedPractitionerAccount(): Promise<{ uid: string; email: string; password: string }> {
  const id = randomUUID().slice(0, 12);
  const account = { uid: `practitioner-${id}`, email: `practitioner-${id}@example.test`, password: 'LocalEmulator!123' };
  await adminAuth.createUser({ ...account, displayName: 'Local Practitioner' });
  await adminDb.doc(`users/${account.uid}`).set({ role: 'clinician' });
  return account;
}

/** A consumer player: an Auth account only. The app creates its profile (users/{uid}) itself. */
export async function seedConsumerAccount(): Promise<{ uid: string; email: string; password: string }> {
  const id = randomUUID().slice(0, 12);
  const account = { uid: `player-${id}`, email: `player-${id}@example.test`, password: 'LocalEmulator!123' };
  await adminAuth.createUser({ ...account, displayName: 'Local Player' });
  return account;
}

export async function seedReviewSession(fixture: LocalPatientFixture, patientNotes: string, experience = 'neuro-gambit', timestamp = Date.now(),
  extra: Record<string, unknown> = {}) {
  const id = `review-${randomUUID().replaceAll('-', '')}`;
  await adminDb.doc(`sessions/${id}`).set({
    id, patientId: fixture.patient.uid, clinicId: 'self-guided',
    timestamp, date: new Date(timestamp).toLocaleDateString(), schemaVersion: 2,
    experience, protocol: 'theta-beta-ratio', durationSeconds: 600,
    isDemo: false, patientNotes, moodRating: 3,
    timeSeries: [{ t: 5, alpha: 8, inZone: true }], ...extra,
  });
  return id;
}

/** A saved Demo session and its completion ledger entry, for the rules-bound persistence test. */
export async function seedPersistedSession(fixture: LocalPatientFixture, marker: string): Promise<void> {
  const { patient } = fixture;
  await Promise.all([
    adminDb.doc(`users/${patient.uid}`).set({ role: 'patient', email: patient.email }),
    adminDb.doc(`clients/${patient.uid}`).update({ recentCompletedSessionIds: [`session-${marker}`] }),
    adminDb.doc(`sessions/session-${marker}`).set({ patientId: patient.uid, clinicId: 'self-guided', patientNotes: marker, isDemo: true }),
  ]);
}

/** The deleted and re-registered accounts' profiles, and whether the deleted Auth account still exists. */
export async function readDeletionRecords(oldUid: string, newUid: string) {
  const [oldClient, newClient, oldAuth] = await Promise.all([
    adminDb.doc(`clients/${oldUid}`).get(), adminDb.doc(`clients/${newUid}`).get(),
    adminAuth.getUser(oldUid).then(() => true, () => false),
  ]);
  return { oldClient: oldClient.data(), newClient: newClient.data(), oldAuthExists: oldAuth };
}

/** Patient-owned self-directed history: one saved session plus grown Garden and progress fields. */
export async function seedSelfDirectedHistory(patientUid: string) {
  const sessionId = `self-directed-${randomUUID().replaceAll('-', '')}`;
  const garden = { stage: 3, growthPoints: 501, plantsUnlocked: ['kelp'], lastWatered: 'yesterday' };
  const timestamp = Date.now() - 60_000;
  await Promise.all([
    adminDb.doc(`sessions/${sessionId}`).set({
      id: sessionId, patientId: patientUid, clinicId: 'self-guided', schemaVersion: 2,
      timestamp, date: new Date(timestamp).toLocaleDateString(),
      experience: 'neuro-gambit', protocol: 'alpha-enhancement', durationSeconds: 600,
      isDemo: false, patientNotes: 'Self-directed reflection', moodRating: 4,
      timeSeries: [{ t: 5, alpha: 8, inZone: true }],
    }),
    adminDb.doc(`clients/${patientUid}`).update({ tidalGardenState: garden, completedSessionsCount: 1, badges: ['garden-keeper'] }),
  ]);
  return { sessionId, garden };
}

export async function readPatientTrainingRecord(patientUid: string) {
  const snapshot = await adminDb.doc(`clients/${patientUid}`).get();
  const data = snapshot.data() ?? {};
  return {
    assignedProtocol: data.assignedProtocol as string | undefined,
    allowedExperiences: data.allowedExperiences as string[] | undefined,
    hasCustomProtocolConfig: data.customProtocolConfig !== undefined,
    tidalGardenState: data.tidalGardenState as Record<string, unknown> | undefined,
    completedSessionsCount: data.completedSessionsCount as number | undefined,
    badges: data.badges as string[] | undefined,
  };
}

/** Change a patient's stored profile fields directly, such as a legacy saved protocol configuration. */
export async function setPatientFields(patientUid: string, fields: Record<string, unknown>) {
  await adminDb.doc(`clients/${patientUid}`).update(fields);
}

/** Recreate a legacy profile written before these fields existed. */
export async function removePatientFields(patientUid: string, fields: string[]) {
  await adminDb.doc(`clients/${patientUid}`).update(Object.fromEntries(fields.map((field) => [field, FieldValue.delete()])));
}

/** NFCT-21: the consumer game sessions the app wrote for a user, read back from the emulator. */
export async function readGameSessions(uid: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snapshot = await adminDb.collection(`users/${uid}/gameSessions`).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

/** NFCT-21: the EEG recordings linked to a user's game sessions. */
export async function readEegRecordings(uid: string): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const snapshot = await adminDb.collection(`users/${uid}/eegRecordings`).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

/** NFCT-13: the server-maintained stats summary and achievements of a user (observation only). */
export async function readPlayerStats(uid: string): Promise<{
  summary: Record<string, unknown> | undefined;
  achievements: Array<{ id: string; data: Record<string, unknown> }>;
}> {
  const [summary, achievements] = await Promise.all([
    adminDb.doc(`users/${uid}/stats/summary`).get(),
    adminDb.collection(`users/${uid}/achievements`).get(),
  ]);
  return { summary: summary.data(), achievements: achievements.docs.map((doc) => ({ id: doc.id, data: doc.data() })) };
}
