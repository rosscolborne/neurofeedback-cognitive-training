import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from 'firebase/firestore';
import { documentIdSchema, slugIdSchema, uidSchema } from '@nfct/shared';

// Consumer data lives only under users/{uid} (ADR-001 decision 1). Every path
// below is built from the signed-in user's uid: no repository method takes a
// user ID, so a repository can never address another user's documents. The
// rules (NFCT-18) enforce the same ownership, and deny collection-group
// queries, so every query stays inside users/{uid}.

/** The signed-in user as the repositories see it: Firebase Auth's `auth.currentUser`. */
export interface ConsumerAuth {
  readonly currentUser: { readonly uid: string } | null;
}

/**
 * What every consumer repository runs on. The app binds it to its own
 * Firestore and Auth instances (`src/consumer/repositories/index.ts`); the
 * repository tests bind emulator instances.
 */
export interface ConsumerFirestoreContext {
  readonly firestore: Firestore;
  readonly auth: ConsumerAuth;
}

export class SignInRequiredError extends Error {
  constructor(message = 'Sign in to save and view your games.') {
    super(message);
    this.name = 'SignInRequiredError';
  }
}

/** A caller-supplied ID that cannot be a consumer document ID (it could otherwise change the path). */
export class InvalidDocumentIdError extends Error {
  constructor(kind: string, id: unknown) {
    super(`Invalid ${kind}: ${JSON.stringify(id)}`);
    this.name = 'InvalidDocumentIdError';
  }
}

export function signedInUid(context: ConsumerFirestoreContext): string {
  const uid = context.auth.currentUser?.uid;
  if (!uid) throw new SignInRequiredError();
  if (!uidSchema.safeParse(uid).success) throw new InvalidDocumentIdError('user ID', uid);
  return uid;
}

export function assertDocumentId(kind: string, id: string): string {
  if (!documentIdSchema.safeParse(id).success) throw new InvalidDocumentIdError(kind, id);
  return id;
}

export function assertGameId(gameId: string): string {
  if (!slugIdSchema.safeParse(gameId).success) throw new InvalidDocumentIdError('game ID', gameId);
  return gameId;
}

export const USERS = 'users';
export const GAME_SESSIONS = 'gameSessions';
export const EEG_RECORDINGS = 'eegRecordings';
export const PROGRESS = 'progress';

export function profileRef(firestore: Firestore, uid: string): DocumentReference {
  return doc(firestore, USERS, uid);
}

export function gameSessionsRef(firestore: Firestore, uid: string): CollectionReference {
  return collection(firestore, USERS, uid, GAME_SESSIONS);
}

export function gameSessionRef(firestore: Firestore, uid: string, sessionId: string): DocumentReference {
  return doc(gameSessionsRef(firestore, uid), assertDocumentId('game session ID', sessionId));
}

export function eegRecordingsRef(firestore: Firestore, uid: string): CollectionReference {
  return collection(firestore, USERS, uid, EEG_RECORDINGS);
}

export function eegRecordingRef(firestore: Firestore, uid: string, recordingId: string): DocumentReference {
  return doc(eegRecordingsRef(firestore, uid), assertDocumentId('EEG recording ID', recordingId));
}

export function progressRef(firestore: Firestore, uid: string, gameId: string): DocumentReference {
  return doc(firestore, USERS, uid, PROGRESS, assertGameId(gameId));
}

/**
 * A new client-generated document ID. Firestore's auto IDs are 20 characters
 * from [A-Za-z0-9], inside the rules' `^[A-Za-z0-9_-]{16,64}$`, and are
 * generated on the device, so they work offline.
 */
export function newDocumentId(collectionRef: CollectionReference): string {
  return assertDocumentId('generated document ID', doc(collectionRef).id);
}
