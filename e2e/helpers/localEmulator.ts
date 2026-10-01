import { randomBytes, randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

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

/** A consumer player: an Auth account only. The app creates its profile (users/{uid}) itself. */
export async function seedConsumerAccount(): Promise<{ uid: string; email: string; password: string }> {
  const id = randomUUID().slice(0, 12);
  const account = { uid: `player-${id}`, email: `player-${id}@example.test`, password: 'LocalEmulator!123' };
  await adminAuth.createUser({ ...account, displayName: 'Local Player' });
  return account;
}

export async function seedAdditionalLinkedPatient(fixture: LocalPatientFixture): Promise<LocalPatientFixture> {
  const id = randomUUID().slice(0, 12);
  const patient = { uid: `patient-${id}`, email: `patient-${id}@example.test`, password: 'LocalEmulator!123' };
  const name = `Protocol Patient ${id}`;
  await adminAuth.createUser({ ...patient, displayName: name });
  await Promise.all([
    adminDb.doc(`users/${patient.uid}`).set({ role: 'patient' }),
    adminDb.doc(`clients/${patient.uid}`).set({
      id: patient.uid, name, email: patient.email, status: 'active',
      clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid,
      condition: 'ADHD (Inattentive)', allowedExperiences: ['skyline-drift'],
      prescribedSessionsPerWeek: 3, completedSessionsCount: 0, currentStreak: 0,
      brainMaps: [], badges: [], isDemo: false,
    }),
  ]);
  return { clinician: fixture.clinician, patient, name };
}

export async function seedReviewSession(fixture: LocalPatientFixture, patientNotes: string, experience = 'skyline-drift', timestamp = Date.now()) {
  const id = `review-${randomUUID().replaceAll('-', '')}`;
  await adminDb.doc(`sessions/${id}`).set({
    id, patientId: fixture.patient.uid, clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid,
    timestamp, date: new Date(timestamp).toLocaleDateString(), schemaVersion: 2,
    experience, protocol: 'theta-beta-ratio', durationSeconds: 600,
    isDemo: false, patientNotes, moodRating: 3,
    timeSeries: [{ t: 5, alpha: 8, inZone: true }],
  });
  return id;
}

export async function readReviewSessionFeedback(sessionId: string): Promise<string | undefined> {
  const snapshot = await adminDb.doc(`sessions/${sessionId}`).get();
  return snapshot.get('clinicianNotes');
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

/** Legacy pending email invitation deliberately coexists with the old link. */
export async function seedPendingLifecycleInvitation(fixture: LocalPatientFixture): Promise<string> {
  const code = await seedPendingInvitation(fixture.clinician.uid, fixture.patient.email, fixture.name);
  await seedFutureLifecycleAppointment(fixture);
  return code;
}

/** A pending invitation as storageEngine.createPatientInvitation writes it: invitation, claim and code-free notice. */
export async function seedPendingInvitation(clinicianUid: string, email: string, patientName: string,
  options: { assignedProtocol?: string; expiresInMs?: number } = {}): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = 'LIFE-' + Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length]).join('') + '-REEN';
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + (options.expiresInMs ?? 7 * 86_400_000));
  await Promise.all([
    adminDb.doc(`patientInvitations/${code}`).set({
      id: code, clinicianId: clinicianUid, clinicId: clinicianUid,
      clinicianName: 'Local Clinician', patientEmail: email, patientName,
      condition: 'ADHD (Inattentive)', assignedProtocol: options.assignedProtocol ?? 'theta-beta-ratio',
      prescribedSessionsPerWeek: 3, status: 'pending', uniquenessClaimId: email,
      schemaVersion: 1, createdAt: now, updatedAt: now, expiresAt,
    }),
    adminDb.doc(`patientInvitationClaims/${clinicianUid}/emails/${email}`).set({
      clinicianId: clinicianUid, clinicId: clinicianUid,
      patientEmail: email, invitationId: code, status: 'pending', expiresAt, createdAt: now,
    }),
    adminDb.doc(`patientInvitationNotices/${email}/clinicians/${clinicianUid}`).set({ expiresAt, updatedAt: now }),
  ]);
  return code;
}

/** Which clinicians have a pending-invitation notice for this email. */
export async function readInvitationNoticeClinicians(email: string): Promise<string[]> {
  const notices = await adminDb.collection(`patientInvitationNotices/${email}/clinicians`).get();
  return notices.docs.map((entry) => entry.id).sort();
}

export async function seedFutureLifecycleAppointment(fixture: LocalPatientFixture): Promise<void> {
  const now = Timestamp.now();
  const startsAt = Timestamp.fromMillis(Date.now() + 7 * 86_400_000);
  await adminDb.doc(`appointments/appt_${randomUUID().replace(/-/g, '')}`).set({
      clinicianId: fixture.clinician.uid, patientId: fixture.patient.uid,
      patientDisplayName: fixture.name, startsAt, timezone: 'America/Toronto',
      durationMinutes: 45, type: 'consultation', status: 'scheduled', notes: '',
      createdAt: now, updatedAt: now, createdBy: fixture.clinician.uid, revision: 1, schemaVersion: 1,
    });
}

export async function findPendingLifecycleInvitation(clinicianUid: string, email: string): Promise<string> {
  const invitations = await adminDb.collection('patientInvitations')
    .where('clinicianId', '==', clinicianUid).where('patientEmail', '==', email).get();
  const pending = invitations.docs.filter((entry) => entry.data().status === 'pending');
  if (pending.length !== 1) throw new Error(`Expected one pending invitation, found ${pending.length}`);
  return pending[0].id;
}

export async function readPendingInvitationState(clinicianUid: string, email: string) {
  const [invitations, claim] = await Promise.all([
    adminDb.collection('patientInvitations')
      .where('clinicianId', '==', clinicianUid).where('patientEmail', '==', email).get(),
    adminDb.doc(`patientInvitationClaims/${clinicianUid}/emails/${email}`).get(),
  ]);
  return {
    pendingCount: invitations.docs.filter((entry) => entry.data().status === 'pending').length,
    claimExists: claim.exists,
  };
}

export async function readLocalInvitationRecord(code: string) {
  const snapshot = await adminDb.doc(`patientInvitations/${code}`).get();
  const data = snapshot.data();
  return data && {
    status: data.status as string | undefined,
    patientId: data.patientId as string | undefined,
    assignedProtocol: data.assignedProtocol as string | undefined,
    updatedAtMillis: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : undefined,
  };
}

export async function seedLifecycleHistory(fixture: LocalPatientFixture): Promise<void> {
  await Promise.all([
    adminDb.doc(`sessions/lifecycle-${fixture.patient.uid}`).set({
      patientId: fixture.patient.uid, clinicianId: fixture.clinician.uid, clinicId: fixture.clinician.uid,
      timestamp: Date.now(), isDemo: false,
    }),
    adminDb.doc(`messageThreads/${fixture.patient.uid}/relationships/${fixture.clinician.uid}`).set({
      patientId: fixture.patient.uid, clinicianId: fixture.clinician.uid,
      participantIds: [fixture.patient.uid, fixture.clinician.uid], lastMessageText: 'historical',
    }),
  ]);
}

export async function readLifecycleHistoryState(patientUid: string, clinicianUid: string) {
  const [session, thread] = await Promise.all([
    adminDb.doc(`sessions/lifecycle-${patientUid}`).get(),
    adminDb.doc(`messageThreads/${patientUid}/relationships/${clinicianUid}`).get(),
  ]);
  return {
    sessionPatientId: session.data()?.patientId as string | undefined,
    threadPatientId: thread.data()?.patientId as string | undefined,
  };
}

export async function readLifecycleRecords(oldUid: string, newUid: string, clinicianUid: string, code: string, email: string) {
  const [oldClient, newClient, invitation, claim, oldAuth, appointments] = await Promise.all([
    adminDb.doc(`clients/${oldUid}`).get(), adminDb.doc(`clients/${newUid}`).get(),
    adminDb.doc(`patientInvitations/${code}`).get(),
    adminDb.doc(`patientInvitationClaims/${clinicianUid}/emails/${email}`).get(),
    adminAuth.getUser(oldUid).then(() => true, () => false),
    adminDb.collection('appointments').where('patientId', '==', oldUid).get(),
  ]);
  return { oldClient: oldClient.data(), newClient: newClient.data(), invitation: invitation.data(),
    claimExists: claim.exists, oldAuthExists: oldAuth,
    appointmentStatuses: appointments.docs.map((entry) => entry.data().status as string) };
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
      experience: 'breath-weave', protocol: 'alpha-enhancement', durationSeconds: 600,
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
    clinicianId: (data.clinicianId ?? null) as string | null,
    assignedProtocol: data.assignedProtocol as string | undefined,
    allowedExperiences: data.allowedExperiences as string[] | undefined,
    hasCustomProtocolConfig: data.customProtocolConfig !== undefined,
    tidalGardenState: data.tidalGardenState as Record<string, unknown> | undefined,
    completedSessionsCount: data.completedSessionsCount as number | undefined,
    badges: data.badges as string[] | undefined,
  };
}

/** Recreate a legacy profile written before these fields existed. */
export async function removePatientFields(patientUid: string, fields: string[]) {
  await adminDb.doc(`clients/${patientUid}`).update(Object.fromEntries(fields.map((field) => [field, FieldValue.delete()])));
}

/** The live relationship fields and the patient's appointment statuses, read with admin rights. */
export async function readPatientRelationship(patientUid: string) {
  const [client, appointments] = await Promise.all([
    adminDb.doc(`clients/${patientUid}`).get(),
    adminDb.collection('appointments').where('patientId', '==', patientUid).get(),
  ]);
  const data = client.data() ?? {};
  return {
    clinicianId: (data.clinicianId ?? null) as string | null,
    clinicId: (data.clinicId ?? null) as string | null,
    linkedClinicianCode: (data.linkedClinicianCode ?? null) as string | null,
    acceptedInvitationId: (data.acceptedInvitationId ?? null) as string | null,
    appointmentStatuses: appointments.docs.map((entry) => entry.data().status as string),
  };
}
