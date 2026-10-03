import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-neurasticity-protocol-e2e';
if (process.env.GCLOUD_PROJECT !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  throw new Error('Local browser E2E requires Auth and Firestore emulators for the demo project.');
}

const adminApp = initializeApp({ projectId }, `local-e2e-${randomUUID()}`);
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);

export type LocalPlayerFixture = {
  player: { uid: string; email: string; password: string };
  name: string;
};

/**
 * A consumer profile (users/{uid}) as the app creates it, in the shared schema
 * (shared/schemas/profile.ts), with server-clock timestamps.
 */
function consumerProfile(displayName: string) {
  const now = FieldValue.serverTimestamp();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    displayName,
    avatar: null,
    preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: true, weeklyGoal: null },
    onboarding: { version: 1, completedAt: null },
    eeg: { enabled: false, consent: null, preferredDevice: null },
  };
}

/** A player who has signed up before: an Auth account and their consumer profile. */
export async function seedPlayer(): Promise<LocalPlayerFixture> {
  const id = randomUUID().slice(0, 12);
  const player = { uid: `player-${id}`, email: `player-${id}@example.test`, password: 'LocalEmulator!123' };
  const name = `Local Player ${id}`;
  await adminAuth.createUser({ ...player, displayName: name });
  await adminDb.doc(`users/${player.uid}`).set(consumerProfile(name));
  return { player, name };
}

/**
 * An account made before the consumer profile (Phase 2): its users/{uid} is
 * the inherited sign-up document, with no schemaVersion, as every account on
 * nfct-dev had when Phase 2 merged. This app cannot read it.
 */
export async function seedLegacyAccount(): Promise<{ uid: string; email: string; password: string }> {
  const id = randomUUID().slice(0, 12);
  const account = { uid: `legacy-${id}`, email: `legacy-${id}@example.test`, password: 'LocalEmulator!123' };
  const createdAt = new Date().toISOString();
  await adminAuth.createUser({ ...account, displayName: 'Legacy Player' });
  await adminDb.doc(`users/${account.uid}`).set({ email: account.email, displayName: 'Legacy Player', createdAt, role: 'patient', updatedAt: createdAt });
  return account;
}

/** A consumer player: an Auth account only. The app creates its profile (users/{uid}) itself. */
export async function seedConsumerAccount(): Promise<{ uid: string; email: string; password: string }> {
  const id = randomUUID().slice(0, 12);
  const account = { uid: `player-${id}`, email: `player-${id}@example.test`, password: 'LocalEmulator!123' };
  await adminAuth.createUser({ ...account, displayName: 'Local Player' });
  return account;
}

/** A player's profile document (users/{uid}), if it exists, and whether their Auth account still exists. */
export async function readAccountRecords(uid: string): Promise<{ profile: Record<string, unknown> | undefined; authExists: boolean }> {
  const [profile, authExists] = await Promise.all([
    adminDb.doc(`users/${uid}`).get(),
    adminAuth.getUser(uid).then(() => true, () => false),
  ]);
  return { profile: profile.data(), authExists };
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
