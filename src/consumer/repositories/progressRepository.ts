import { getDoc, limit, onSnapshot, onSnapshotsInSync, type Unsubscribe } from 'firebase/firestore';
import { readGameProgress, type GameProgress } from '@nfct/shared';
import { assertGameId, progressRef, signedInUid, type ConsumerFirestoreContext } from '../firestore/context';
import { readDocument, readDocuments, type DocumentRead, type UnreadableDocument } from '../firestore/reads';
import { boundedPageSize, historyQuery, sessionRecord, type GameSessionRecord } from './gameSessionRepository';

// users/{uid}/progress/{gameId}: trusted per-game progress, written only by
// server code (NFCT-19). The client only reads it. A missing document is
// normal: it means no valid session has been processed for the game yet.

/**
 * Cached progress with the recent sessions of the same game, taken at one
 * consistent moment. Trusted scoring writes a session's `result` and the
 * progress document in one commit, but they reach the client through two
 * listeners. Combining them only when both listeners are in sync means a
 * session is never counted twice (once in progress and again as pending) or
 * not at all. The client preview (NFCT-21, NFCT-22) applies the pending
 * sessions to the progress with the shared reducer; this repository does not.
 */
export interface ProgressWithRecentSessions {
  readonly progress: DocumentRead<GameProgress>;
  /** Newest first; includes sessions written on this device and not yet uploaded. */
  readonly recentSessions: GameSessionRecord[];
  /** The recent sessions trusted scoring has not handled yet. */
  readonly pendingSessions: GameSessionRecord[];
  readonly unreadableSessions: UnreadableDocument[];
  /**
   * Both parts came from the local cache (offline, or before the server
   * answered). Cached documents can be older than the server's, so a cached
   * state is a best effort until a server state (false) follows.
   */
  readonly fromCache: boolean;
}

export interface ProgressRepository {
  getProgress(gameId: string): Promise<DocumentRead<GameProgress>>;
  subscribeToProgress(
    gameId: string,
    onNext: (progress: DocumentRead<GameProgress>) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
  /**
   * Progress plus the newest sessions of the game (default 20, at most 100),
   * delivered together only when both listeners are in sync and both parts
   * come from the same source (server or cache). Pending sessions older than
   * that window are not included. A failed read stops both listeners and
   * reaches `onError` as a ProgressReadError naming the read.
   */
  subscribeToProgressWithRecentSessions(
    gameId: string,
    options: { readonly recentLimit?: number },
    onNext: (state: ProgressWithRecentSessions) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The reads that subscribeToProgressWithRecentSessions combines. */
export type ProgressRead = 'progress' | 'recent sessions';

/**
 * A failed read of subscribeToProgressWithRecentSessions: which read failed,
 * with the Firestore error code (for example `permission-denied`, or
 * `failed-precondition` while a composite index is missing or still
 * building). The original error is the cause.
 */
export class ProgressReadError extends Error {
  readonly code: string | undefined;

  constructor(readonly read: ProgressRead, cause: unknown) {
    const error = asError(cause);
    super(error.message, { cause: error });
    this.name = 'ProgressReadError';
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === 'string' ? code : undefined;
  }
}

export function createProgressRepository(context: ConsumerFirestoreContext): ProgressRepository {
  const { firestore } = context;

  return {
    async getProgress(gameId) {
      const snapshot = await getDoc(progressRef(firestore, signedInUid(context), gameId));
      return readDocument('progress', snapshot, (raw) => readGameProgress(raw));
    },

    subscribeToProgress(gameId, onNext, onError) {
      const ref = progressRef(firestore, signedInUid(context), gameId);
      return onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
        onNext(readDocument('progress', snapshot, (raw) => readGameProgress(raw)));
      }, (error) => onError(asError(error)));
    },

    subscribeToProgressWithRecentSessions(gameId, options, onNext, onError) {
      const uid = signedInUid(context);
      assertGameId(gameId);
      let progress: DocumentRead<GameProgress> | undefined;
      let sessions: Omit<ProgressWithRecentSessions, 'progress' | 'pendingSessions'> | undefined;
      let changed = false;
      let stopped = false;
      const unsubscribers: Unsubscribe[] = [];

      const stop = () => {
        stopped = true;
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
      };
      const fail = (read: ProgressRead) => (error: unknown) => {
        if (stopped) return;
        stop();
        onError(new ProgressReadError(read, error));
      };
      const publish = () => {
        if (stopped || !changed || !progress || !sessions) return;
        // Both parts from the server, or both from the cache. While one part
        // is still the cached copy and the other is already the server's, the
        // cache can be older (a session cached without the result the server
        // has since written), so wait for the other part to catch up.
        if (progress.fromCache !== sessions.fromCache) return;
        changed = false;
        onNext({
          progress,
          ...sessions,
          pendingSessions: sessions.recentSessions.filter((record) => record.awaitingResult),
          fromCache: progress.fromCache,
        });
      };

      unsubscribers.push(onSnapshot(progressRef(firestore, uid, gameId), { includeMetadataChanges: true }, (snapshot) => {
        progress = readDocument('progress', snapshot, (raw) => readGameProgress(raw));
        changed = true;
      }, fail('progress')));
      unsubscribers.push(onSnapshot(
        historyQuery(context, uid, gameId, limit(boundedPageSize(options.recentLimit))),
        { includeMetadataChanges: true },
        (snapshot) => {
          const { readable, unreadable } = readDocuments('gameSessions', snapshot.docs,
            (raw, item) => sessionRecord(raw, item.id, item.metadata.hasPendingWrites));
          sessions = { recentSessions: readable, unreadableSessions: unreadable, fromCache: snapshot.metadata.fromCache };
          changed = true;
        },
        fail('recent sessions'),
      ));
      // Fires after every listener has received the snapshots of one consistent state.
      unsubscribers.push(onSnapshotsInSync(firestore, publish));
      return stop;
    },
  };
}
