import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { mentalMathSession, type SessionPlan } from '../../../shared/__tests__/processingFixtures';

// Emulator-only test plumbing for the Cloud Functions tests. Every suite
// refuses to run unless `firebase emulators:exec` started it for the expected
// demo project, so no test can reach a real Firebase project.

export const CORE_PROJECT = 'demo-nfct-functions-core';
export const TRIGGER_PROJECT = 'demo-nfct-functions';

export function emulatorFirestore(projectId: string): { app: App; db: Firestore; close: () => Promise<void> } {
  if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== projectId || !projectId.startsWith('demo-')) {
    throw new Error(`These tests run only inside the Firestore emulator for ${projectId} (npm run test:functions)`);
  }
  const app = initializeApp({ projectId }, `functions-test-${randomUUID()}`);
  return { app, db: getFirestore(app), close: () => deleteApp(app) };
}

export const ts = (ms: number) => Timestamp.fromMillis(ms);

export function newUid(): string {
  return `user-${randomUUID()}`;
}

/** A client-style session ID; `order` makes IDs sort in creation order within a test. */
export function newSessionId(order = 0): string {
  return `s${String(order).padStart(4, '0')}${randomUUID().replace(/-/g, '')}`;
}

export type Plan = Omit<SessionPlan, 'uid'>;

/** A conforming Mental Math v1 session document played through the run reducer. */
export function sessionDoc(uid: string, plan: Plan): Record<string, unknown> {
  return mentalMathSession({ ...plan, uid }, ts);
}

export function sessionPath(uid: string, sessionId: string): string {
  return `users/${uid}/gameSessions/${sessionId}`;
}

export function progressPath(uid: string, gameId = 'mental-math'): string {
  return `users/${uid}/progress/${gameId}`;
}

export async function readDoc(db: Firestore, path: string): Promise<DocumentData | undefined> {
  return (await db.doc(path).get()).data();
}

/** Progress without its write time, to compare aggregates reached at different moments. */
export function content(progress: DocumentData | undefined | null): DocumentData | null {
  if (!progress) return null;
  const { updatedAt: _updatedAt, ...rest } = progress;
  return rest;
}

/** Waits until the document satisfies `ready`, or fails after `timeoutMs`. */
export async function waitFor(
  db: Firestore,
  path: string,
  ready: (data: DocumentData | undefined) => boolean,
  timeoutMs = 30_000,
): Promise<DocumentData | undefined> {
  const started = Date.now();
  for (;;) {
    const data = await readDoc(db, path);
    if (ready(data)) return data;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${path}: ${JSON.stringify(data)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A session that trusted scoring has finished with: a result or processing metadata. */
export const settled = (data: DocumentData | undefined) => data?.result !== undefined || data?.processing !== undefined;
