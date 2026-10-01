import {
  deleteDoc,
  documentId,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  EEG_RECORDING_SCHEMA_VERSION,
  eegRecordingWriteSchema,
  readEegRecording,
  readUserProfile,
  type EegRecording,
} from '@nfct/shared';
import {
  assertDocumentId,
  eegRecordingRef,
  eegRecordingsRef,
  gameSessionRef,
  newDocumentId,
  profileRef,
  signedInUid,
  type ConsumerFirestoreContext,
} from '../firestore/context';
import { readDocument, readDocuments, type UnreadableDocument } from '../firestore/reads';
import { toSdkTimestamps } from '../firestore/serverClock';
import {
  assertNoReservedKeys,
  assertNoUndefined,
  assertValidWithServerClock,
  ConsumerWriteValidationError,
  pendingWrite,
  withSdkValidation,
  type PendingWrite,
} from '../firestore/writes';
import type { SavedGameSession } from './gameSessionRepository';

// users/{uid}/eegRecordings/{recordingId}: optional EEG summaries, each linked
// to one game session. This repository is the only writer of recordings.
//
// A recording is its own write, made after its session is saved and never in
// the session's write: an EEG problem (no consent, consent that cannot be
// confirmed, invalid data, a server refusal) costs only the recording, never
// the session. The caller saves the session first (gameSessionRepository) and
// then offers the recording with `saveRecording`. The rules require the linked
// session to exist when the recording is written; the SDK sends one user's
// queued writes in order, so a recording queued after its session reaches the
// server after it. If the session is refused, the recording is refused too, so
// no recording can land without its session.
//
// Recordings are never updated, and the user can delete one or all of them at
// any time. Whether a session has EEG is answered only by querying this
// collection on `gameSessionId`: the session itself has no EEG flag (ADR-001
// decision 3).

/** Fields the repository sets: the path owner, the schema version, the linked session and the server clock. */
const REPOSITORY_OWNED_KEYS = ['schemaVersion', 'userId', 'gameSessionId', 'createdAt'] as const;

/**
 * An EEG summary as the capture pipeline produces it. `source` is required:
 * every recording says whether it was measured by a headset or simulated.
 */
export type EegRecordingDraft = Omit<EegRecording, (typeof REPOSITORY_OWNED_KEYS)[number]>;

export interface EegRecordingRecord {
  readonly id: string;
  readonly recording: EegRecording;
  readonly hasPendingWrites: boolean;
}

export interface EegRecordingsForSession {
  readonly recordings: EegRecordingRecord[];
  readonly unreadable: UnreadableDocument[];
  readonly fromCache: boolean;
}

/** Why a recording was not written. Nothing was queued, and the session is unaffected. */
export type EegRecordingSkipReason =
  /** The server's profile records no EEG consent, or there is no consumer profile. */
  | 'consent-required'
  /**
   * Consent could not be confirmed with the server: the device is offline,
   * the server did not answer within the bound, or a consent change made on
   * this device is not yet acknowledged. The cached profile is never used.
   */
  | 'consent-unavailable'
  /** The draft breaks the shared EEG schema. */
  | 'invalid'
  /** The session is not saved on this device (never saved here, or already refused), so the rules would refuse the recording. */
  | 'session-not-saved'
  /** Nobody, or a different user, is signed in than the one whose session it is. */
  | 'owner-changed';

/** Why the server refused a queued recording, as far as the repository could tell afterwards. */
export type EegRecordingRefusalReason =
  /** The profile had no EEG consent when the recording reached the server (for example, withdrawn on another device). */
  | 'consent-withdrawn'
  /** The linked session did not exist when the recording reached the server (for example, the session was refused). */
  | 'session-not-saved'
  /** The refusal could not be explained (for example, the server could not be read afterwards). */
  | 'unknown';

/** The server's verdict on a queued recording. It never rejects. */
export type EegRecordingServerOutcome =
  | { readonly status: 'acknowledged' }
  | { readonly status: 'refused'; readonly reason: EegRecordingRefusalReason; readonly message: string };

/** What happened to a recording offered for a saved session. */
export type EegRecordingSave =
  /**
   * Written to the local cache and queued for the server, after the server
   * confirmed consent. `serverOutcome` settles when the server accepts or
   * refuses it (offline, it stays pending; with the persistent cache the
   * queued write survives a restart).
   */
  | {
    readonly status: 'queued';
    readonly recordingId: string;
    readonly serverOutcome: Promise<EegRecordingServerOutcome>;
  }
  /** Not written. The session is saved regardless (EEG is never required). */
  | { readonly status: 'skipped'; readonly reason: EegRecordingSkipReason; readonly message: string };

export class EegRecordingAlreadySavedError extends Error {
  constructor(gameSessionId: string) {
    super(`An EEG recording for game session ${gameSessionId} is already being saved or has been queued; a session gets at most one.`);
    this.name = 'EegRecordingAlreadySavedError';
  }
}

export interface EegRecordingRepository {
  /**
   * Writes the EEG recording of a session that `StartedGameSession.save` has
   * already queued, as a separate create. Call it after `save` resolves, with
   * what `save` returned.
   *
   * - It never throws for an EEG problem: a recording it cannot write is
   *   `skipped` with a reason, and the session is unaffected.
   * - Consent must be confirmed by the server's copy of the profile, read
   *   within `CONSENT_SERVER_READ_TIMEOUT_MS`. Offline, on a stalled
   *   connection, or with no server answer, the recording is skipped as
   *   `consent-unavailable`; the cached profile is never used. The rules check
   *   consent again when the recording reaches the server.
   * - At most one recording is queued per session: once one is queued, or
   *   while one is being saved, a further call throws
   *   `EegRecordingAlreadySavedError`. After a skip nothing was queued, so the
   *   call may be repeated.
   */
  saveRecording(session: Pick<SavedGameSession, 'sessionId' | 'userId'>, draft: EegRecordingDraft): Promise<EegRecordingSave>;
  /** Every recording linked to one session; normally zero or one. */
  listForGameSession(gameSessionId: string): Promise<EegRecordingsForSession>;
  /** True when any recording (readable or not) links to the session. Offline it answers from the cache. */
  hasEegRecording(gameSessionId: string): Promise<boolean>;
  deleteRecording(recordingId: string): PendingWrite;
  /**
   * Deletes every recording, listed from the server so none is missed, plus any
   * written on this device and not yet uploaded. Needs a connection; resolves
   * once the server has applied every delete.
   */
  deleteAllRecordings(): Promise<{ deleted: number }>;
}

const DELETE_PAGE_SIZE = 400;

/**
 * The longest `saveRecording` waits for the server's copy of the profile when
 * confirming EEG consent. After it the recording is skipped as
 * 'consent-unavailable'. Offline, the server read fails at once, so the skip
 * is immediate. The session was saved before, so this never delays it.
 */
export const CONSENT_SERVER_READ_TIMEOUT_MS = 1_500;

/** The longest each server read takes when explaining a refusal; after it the reason is 'unknown'. */
const REFUSAL_DIAGNOSIS_TIMEOUT_MS = 5_000;

export interface EegRecordingRepositoryOptions {
  readonly consentServerReadTimeoutMs?: number;
}

/** Resolves with the read, or null if it fails or takes longer than `ms`. */
async function withinTimeout<T>(read: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([read.catch(() => null), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function recordingRecord(raw: Record<string, unknown>, snapshot: QueryDocumentSnapshot): EegRecordingRecord {
  return { id: snapshot.id, recording: readEegRecording(raw), hasPendingWrites: snapshot.metadata.hasPendingWrites };
}

function skipped(reason: EegRecordingSkipReason, message: string): EegRecordingSave {
  return { status: 'skipped', reason, message };
}

function refused(reason: EegRecordingRefusalReason, message: string): EegRecordingServerOutcome {
  return { status: 'refused', reason, message };
}

/** True when the profile document is a readable consumer profile that records EEG consent. */
function recordsConsent(snapshot: DocumentSnapshot): boolean {
  const read = readDocument('users', snapshot, (raw) => readUserProfile(raw));
  return read.status === 'readable' && read.data.eeg.consent !== null;
}

export function createEegRecordingRepository(
  context: ConsumerFirestoreContext,
  options: EegRecordingRepositoryOptions = {},
): EegRecordingRepository {
  const { firestore } = context;
  const consentServerReadTimeoutMs = options.consentServerReadTimeoutMs ?? CONSENT_SERVER_READ_TIMEOUT_MS;
  /** Sessions with a recording being saved or already queued by this repository: one recording per session. */
  const claimedSessions = new Set<string>();

  /**
   * Null when the server's copy of the profile records consent; otherwise why
   * the recording must be skipped. Consent is positively established only by
   * the server: the cached profile is never used, because it can still show
   * consent that was withdrawn on another device. A copy with a consent change
   * made on this device and not yet acknowledged is not the server's word
   * either. The read is bounded, so a save never waits long on the network: a
   * plain getDoc() waits while the connection state is unknown (at startup, or
   * on a stalled connection), which can take many seconds.
   */
  async function consentProblem(uid: string): Promise<{ reason: EegRecordingSkipReason; message: string } | null> {
    const snapshot = await withinTimeout(getDocFromServer(profileRef(firestore, uid)), consentServerReadTimeoutMs);
    if (!snapshot) {
      return {
        reason: 'consent-unavailable',
        message: 'EEG consent could not be confirmed: the server could not be reached in time (offline or a slow connection).',
      };
    }
    if (!recordsConsent(snapshot)) return { reason: 'consent-required', message: 'EEG consent is not recorded on the profile.' };
    if (snapshot.metadata.hasPendingWrites) {
      return {
        reason: 'consent-unavailable',
        message: 'EEG consent could not be confirmed: a profile change made on this device has not reached the server yet.',
      };
    }
    return null;
  }

  /** The session is saved on this device: queued here and not refused, or already stored. */
  async function sessionSavedHere(uid: string, sessionId: string): Promise<boolean> {
    try {
      return (await getDocFromCache(gameSessionRef(firestore, uid, sessionId))).exists();
    } catch {
      // Not in this device's cache.
      return false;
    }
  }

  /**
   * The server's verdict, explained. A refusal carries no reason, so the
   * repository reads the server afterwards: the recording itself (a resend of
   * a create the server already applied, whose acknowledgement was lost, is
   * refused as an update, yet the recording exists), then the session, then
   * consent.
   */
  async function serverOutcome(commit: Promise<void>, uid: string, sessionId: string, ref: DocumentReference): Promise<EegRecordingServerOutcome> {
    try {
      await commit;
      return { status: 'acknowledged' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A server refusal arrives as a FirebaseError, not always a FirestoreError instance: compare the code.
      if ((error as { code?: unknown } | null)?.code !== 'permission-denied') return refused('unknown', message);
      const fromServer = (target: DocumentReference) => withinTimeout(getDocFromServer(target), REFUSAL_DIAGNOSIS_TIMEOUT_MS);
      const recording = await fromServer(ref);
      if (recording?.exists()) return { status: 'acknowledged' };
      const session = await fromServer(gameSessionRef(firestore, uid, sessionId));
      if (session && !session.exists()) {
        return refused('session-not-saved', 'The server refused the EEG recording because its game session was not saved.');
      }
      const profile = await fromServer(profileRef(firestore, uid));
      if (profile && !recordsConsent(profile)) {
        return refused('consent-withdrawn', 'The server refused the EEG recording because EEG consent was no longer recorded on the profile.');
      }
      return refused('unknown', message);
    }
  }

  async function listIds(fromServer: boolean, uid: string): Promise<string[]> {
    const ids: string[] = [];
    let last: QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = query(eegRecordingsRef(firestore, uid), orderBy(documentId()), ...(last ? [startAfter(last)] : []), limit(DELETE_PAGE_SIZE));
      const snapshot = fromServer ? await getDocsFromServer(page) : await getDocsFromCache(page);
      ids.push(...snapshot.docs.map((item) => item.id));
      if (snapshot.docs.length < DELETE_PAGE_SIZE) return ids;
      last = snapshot.docs.at(-1);
    }
  }

  return {
    async saveRecording(session, draft) {
      const sessionId = assertDocumentId('game session ID', session.sessionId);
      if (claimedSessions.has(sessionId)) throw new EegRecordingAlreadySavedError(sessionId);
      claimedSessions.add(sessionId);
      let queued = false;
      try {
        const ownerChanged = () => context.auth.currentUser?.uid !== session.userId;
        const ownerChangedMessage = 'The signed-in user changed after the session was saved, so its EEG recording was not saved.';
        if (ownerChanged()) return skipped('owner-changed', ownerChangedMessage);
        const uid = signedInUid(context);

        const data = toSdkTimestamps({
          ...draft,
          schemaVersion: EEG_RECORDING_SCHEMA_VERSION,
          userId: uid,
          gameSessionId: sessionId,
          createdAt: serverTimestamp(),
        });
        try {
          assertNoReservedKeys('EEG recording', draft, REPOSITORY_OWNED_KEYS);
          assertNoUndefined('EEG recording', data);
          assertValidWithServerClock('EEG recording', eegRecordingWriteSchema, data);
        } catch (error) {
          if (error instanceof ConsumerWriteValidationError) return skipped('invalid', error.message);
          throw error;
        }

        // The session must be queued (or stored) ahead of the recording: the
        // rules refuse a recording whose session does not exist.
        if (!(await sessionSavedHere(uid, sessionId))) {
          return skipped('session-not-saved', 'The game session is not saved on this device, so its EEG recording cannot be saved.');
        }
        const problem = await consentProblem(uid);
        if (problem) return skipped(problem.reason, problem.message);
        // The checks were asynchronous: the session's player must still be the signed-in user.
        if (ownerChanged()) return skipped('owner-changed', ownerChangedMessage);

        const ref = eegRecordingRef(firestore, uid, newDocumentId(eegRecordingsRef(firestore, uid)));
        let commit: Promise<void>;
        try {
          commit = withSdkValidation('EEG recording', () => setDoc(ref, data));
        } catch (error) {
          if (error instanceof ConsumerWriteValidationError) return skipped('invalid', error.message);
          throw error;
        }
        queued = true;
        return { status: 'queued', recordingId: ref.id, serverOutcome: serverOutcome(commit, uid, sessionId, ref) };
      } finally {
        // Nothing was queued: the session may still be offered a recording.
        if (!queued) claimedSessions.delete(sessionId);
      }
    },

    async listForGameSession(gameSessionId) {
      const uid = signedInUid(context);
      const snapshot = await getDocs(query(eegRecordingsRef(firestore, uid), where('gameSessionId', '==', assertDocumentId('game session ID', gameSessionId))));
      const { readable, unreadable } = readDocuments('eegRecordings', snapshot.docs, recordingRecord);
      return { recordings: readable, unreadable, fromCache: snapshot.metadata.fromCache };
    },

    async hasEegRecording(gameSessionId) {
      const uid = signedInUid(context);
      const snapshot = await getDocs(query(eegRecordingsRef(firestore, uid), where('gameSessionId', '==', assertDocumentId('game session ID', gameSessionId)), limit(1)));
      return !snapshot.empty;
    },

    deleteRecording(recordingId) {
      return pendingWrite(deleteDoc(eegRecordingRef(firestore, signedInUid(context), recordingId)));
    },

    async deleteAllRecordings() {
      const uid = signedInUid(context);
      const ids = new Set([...(await listIds(true, uid)), ...(await listIds(false, uid))]);
      const all = [...ids];
      for (let start = 0; start < all.length; start += DELETE_PAGE_SIZE) {
        const batch = writeBatch(firestore);
        for (const id of all.slice(start, start + DELETE_PAGE_SIZE)) batch.delete(eegRecordingRef(firestore, uid, id));
        await batch.commit();
      }
      return { deleted: all.length };
    },
  };
}
