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
  type PendingWrite,
} from '../firestore/writes';

// users/{uid}/eegRecordings/{recordingId}: optional EEG summaries, each linked
// to one game session. A recording is written only in the same batch as its
// session (gameSessionRepository), because the rules require the linked
// session to exist after the write. Recordings are never updated, and the
// user can delete one or all of them at any time.
//
// Whether a session has EEG is answered only by querying this collection on
// `gameSessionId`: the session itself has no EEG flag (ADR-001 decision 3).

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

/** Why a recording offered with a session was left out of the session's write. */
export type EegRecordingSkipReason =
  /** The profile has no EEG consent (or no consumer profile exists). */
  | 'consent-required'
  /** Consent could not be checked: the server did not answer in time, and the profile is not cached. */
  | 'consent-unavailable'
  /** The draft breaks the shared EEG schema. */
  | 'invalid';

/** A recording ready to join its session's batch. */
export interface PreparedEegRecording {
  readonly status: 'ready';
  readonly ref: DocumentReference;
  readonly data: Record<string, unknown>;
}

export interface SkippedEegRecording {
  readonly status: 'skipped';
  readonly reason: EegRecordingSkipReason;
  readonly message: string;
}

export interface EegRecordingRepository {
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
  /**
   * Validates a recording for a session and checks consent, for
   * gameSessionRepository to add to the session's batch. It never writes.
   */
  prepareRecording(gameSessionId: string, draft: EegRecordingDraft): Promise<PreparedEegRecording | SkippedEegRecording>;
}

const DELETE_PAGE_SIZE = 400;

/**
 * The longest a save waits for the server's copy of the profile when checking
 * EEG consent. After it the cached profile is used, if there is one, and
 * otherwise the recording is skipped as 'consent-unavailable'. Offline, the
 * server read fails at once, so the cache is used without waiting.
 */
export const CONSENT_SERVER_READ_TIMEOUT_MS = 1_500;

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

export function createEegRecordingRepository(
  context: ConsumerFirestoreContext,
  options: EegRecordingRepositoryOptions = {},
): EegRecordingRepository {
  const { firestore } = context;
  const consentServerReadTimeoutMs = options.consentServerReadTimeoutMs ?? CONSENT_SERVER_READ_TIMEOUT_MS;

  /**
   * The profile for a consent check. The server's copy comes first, because
   * the rules check consent as the server holds it when the batch arrives: a
   * cached copy can still show consent that was withdrawn on another device,
   * and a recording included on that basis would get the whole batch, session
   * included, refused. The server read is bounded, so a save never waits long
   * on the network: a plain getDoc() waits for the server while the connection
   * state is unknown (at startup, or on a stalled connection), which can take
   * many seconds. Offline, the server read fails at once and the cached copy
   * is used; with neither, the recording is skipped.
   */
  async function profileForConsent(uid: string): Promise<DocumentSnapshot | null> {
    const ref = profileRef(firestore, uid);
    const fromServer = await withinTimeout(getDocFromServer(ref), consentServerReadTimeoutMs);
    if (fromServer) return fromServer;
    try {
      return await getDocFromCache(ref);
    } catch {
      // Not cached on this device either.
      return null;
    }
  }

  /** Null when the profile records consent; otherwise why the recording must be left out. */
  async function consentProblem(uid: string): Promise<EegRecordingSkipReason | null> {
    const snapshot = await profileForConsent(uid);
    // No timely server answer and no cached profile. EEG is optional, so the session is saved without it.
    if (!snapshot) return 'consent-unavailable';
    const read = readDocument('users', snapshot, (raw) => readUserProfile(raw));
    return read.status === 'readable' && read.data.eeg.consent !== null ? null : 'consent-required';
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

    async prepareRecording(gameSessionId, draft) {
      const uid = signedInUid(context);
      assertDocumentId('game session ID', gameSessionId);
      const data = toSdkTimestamps({
        ...draft,
        schemaVersion: EEG_RECORDING_SCHEMA_VERSION,
        userId: uid,
        gameSessionId,
        createdAt: serverTimestamp(),
      });
      try {
        assertNoReservedKeys('EEG recording', draft, REPOSITORY_OWNED_KEYS);
        assertNoUndefined('EEG recording', data);
        assertValidWithServerClock('EEG recording', eegRecordingWriteSchema, data);
      } catch (error) {
        if (error instanceof ConsumerWriteValidationError) return { status: 'skipped', reason: 'invalid', message: error.message };
        throw error;
      }
      const problem = await consentProblem(uid);
      if (problem) {
        return {
          status: 'skipped',
          reason: problem,
          message: problem === 'consent-required'
            ? 'EEG consent is not recorded on the profile.'
            : 'EEG consent could not be checked: the server did not answer in time and the profile is not cached.',
        };
      }
      const collectionRef = eegRecordingsRef(firestore, uid);
      return { status: 'ready', ref: eegRecordingRef(firestore, uid, newDocumentId(collectionRef)), data };
    },
  };
}
