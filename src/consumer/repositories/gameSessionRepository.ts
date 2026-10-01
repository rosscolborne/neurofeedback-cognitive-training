import {
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type FieldValue,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  createSessionSeed,
  GAME_SESSION_SCHEMA_VERSION,
  sessionSeedSchema,
  gameSessionCreateSchemaFor,
  readGameSession,
  type GameDefinition,
  type GameSession,
  type GameSessionCreateOf,
} from '@nfct/shared';
import {
  assertGameId,
  gameSessionRef,
  gameSessionsRef,
  newDocumentId,
  signedInUid,
  type ConsumerFirestoreContext,
} from '../firestore/context';
import { readDocument, readDocuments, type DocumentRead, type UnreadableDocument } from '../firestore/reads';
import { serverTimestampSchema, toSdkTimestamps } from '../firestore/serverClock';
import {
  assertNoReservedKeys,
  assertNoUndefined,
  ConsumerWriteValidationError,
  pendingWrite,
  withSdkValidation,
  type PendingWrite,
} from '../firestore/writes';

// users/{uid}/gameSessions/{sessionId}: the primary record (ADR-001 decisions
// 2 and 5). The session ID and the session seed are generated when the game
// starts: an EEG recording can reference the ID before anything is written,
// and the game derives the session's content from the seed. The session is
// written exactly once, when the game ends, on its own: nothing about EEG can
// delay or refuse it. Its optional EEG recording is a separate, later write
// that eegRecordingRepository owns (`saveRecording`, called with what `save`
// returns). The session is never updated and never retried as an update: the
// rules allow create only, so an offline retry either lands once or is
// refused.

/**
 * Fields the repository sets: the path owner, the schema version, the server
 * clock and the seed chosen when the game started.
 */
const REPOSITORY_OWNED_KEYS = ['schemaVersion', 'userId', 'createdAt', 'seed'] as const;
const SERVER_OWNED_KEYS = ['result', 'processing'] as const;

/**
 * A finished session as the game produces it, typed by the game's own trial
 * and metrics schemas. It is derived from the shared create schema, so any
 * envelope field added to the shared schema becomes part of it.
 */
export type GameSessionDraft<Trial, Metrics extends object> =
  Omit<GameSessionCreateOf<Trial, Metrics, FieldValue>, (typeof REPOSITORY_OWNED_KEYS)[number]>;

export interface GameSessionRecord {
  readonly id: string;
  readonly session: GameSession;
  /**
   * Trusted scoring has not handled the session yet: it has neither `result`
   * nor `processing`. A client preview (NFCT-21, NFCT-22) counts it until its
   * `result` is observed.
   */
  readonly awaitingResult: boolean;
  /** Written on this device and not yet acknowledged by the server, for example while offline. */
  readonly hasPendingWrites: boolean;
}

/**
 * Where the next page starts: after the last document of this page, readable
 * or not. Treat it as opaque and keep it in memory; `endedAt` is the stored
 * value as the SDK returned it.
 */
export interface GameSessionCursor {
  readonly uid: string;
  readonly gameId: string | null;
  readonly endedAt: unknown;
  readonly id: string;
}

export interface GameSessionPage {
  /** Newest first (`endedAt` descending, then document ID descending). */
  readonly sessions: GameSessionRecord[];
  /** Documents on this page that could not be read. They are skipped, never thrown. */
  readonly unreadable: UnreadableDocument[];
  /** Null when there are no more sessions. */
  readonly nextCursor: GameSessionCursor | null;
  readonly fromCache: boolean;
}

export interface ListGameSessionsOptions {
  /** One game's history; omit for every game. */
  readonly gameId?: string;
  /** Default 20, at most 100. */
  readonly pageSize?: number;
  readonly cursor?: GameSessionCursor | null;
}

export interface RecentGameSessions {
  readonly sessions: GameSessionRecord[];
  readonly unreadable: UnreadableDocument[];
  readonly fromCache: boolean;
}

/**
 * A session queued for the server. `acknowledged` settles when the server
 * accepts or refuses it. Pass it to `eegRecordingRepository.saveRecording` to
 * write the run's EEG recording after it.
 */
export interface SavedGameSession extends PendingWrite {
  readonly sessionId: string;
  /** The user the session was saved for. */
  readonly userId: string;
}

export interface SaveGameSessionInput<Trial, Metrics extends object> {
  /** The game version the session was played under; its schemas check the trials and metrics. */
  readonly definition: GameDefinition<Trial, Metrics>;
  readonly session: GameSessionDraft<Trial, Metrics>;
}

/** A game in progress. Its ID and seed exist from the start; nothing is written until `save`. */
export interface StartedGameSession {
  readonly sessionId: string;
  /**
   * The session seed (an unsigned 32-bit integer, shared `createSessionSeed`),
   * drawn from a cryptographically strong source when the game starts. The
   * game derives the session's content from it (Mental Math:
   * `mentalMath.startRun({ seed, startLevel })`), and `save` stores it, so
   * trusted scoring can reproduce what the player was shown.
   */
  readonly seed: number;
  /** The user who started the game. Saving under a different signed-in user is refused. */
  readonly userId: string;
  /**
   * Writes the finished session once, on its own. Resolves once the write is
   * queued (so it works offline, and never waits on the network);
   * `acknowledged` settles when the server accepts or refuses it. A handle
   * saves at most once: after the write is queued, every further call throws.
   *
   * EEG is not part of this write. To keep the run's EEG recording, call
   * `eegRecordingRepository.saveRecording(saved, draft)` after this resolves;
   * whatever happens to the recording, the session is unaffected.
   *
   * A refusal can be ambiguous. If the server applied the write but its
   * acknowledgement was lost (for example the connection dropped), the SDK
   * sends the same write again, and the rules refuse it as an update:
   * `acknowledged` rejects with `permission-denied` although the session
   * exists. Re-read the session (`getGameSession`) before telling the player
   * that a save failed.
   */
  save<Trial, Metrics extends object>(input: SaveGameSessionInput<Trial, Metrics>): Promise<SavedGameSession>;
}

export class GameSessionAlreadySavedError extends Error {
  constructor(sessionId: string) {
    super(`Game session ${sessionId} has already been saved; sessions are written once.`);
    this.name = 'GameSessionAlreadySavedError';
  }
}

export class GameSessionOwnerChangedError extends Error {
  constructor() {
    super('The signed-in user changed during the game, so the session cannot be saved.');
    this.name = 'GameSessionOwnerChangedError';
  }
}

export interface GameSessionRepository {
  /** Call when the game starts: generates the session ID and the session seed. */
  startGameSession(): StartedGameSession;
  getGameSession(sessionId: string): Promise<DocumentRead<GameSessionRecord>>;
  /** Watches one session, for example until its trusted `result` arrives. */
  subscribeToGameSession(
    sessionId: string,
    onNext: (read: DocumentRead<GameSessionRecord>) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
  /** Cursor-paged history, newest first. Works offline from the persistent cache. */
  listGameSessions(options?: ListGameSessionsOptions): Promise<GameSessionPage>;
  /**
   * The newest sessions, live, including ones written on this device and not
   * yet uploaded. The start-level picker (NFCT-21) reads the last start level
   * and the pending sessions from it.
   */
  subscribeToRecentGameSessions(
    options: { readonly gameId?: string; readonly limit?: number },
    onNext: (recent: RecentGameSessions) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
}

export const DEFAULT_HISTORY_PAGE_SIZE = 20;
export const MAX_HISTORY_PAGE_SIZE = 100;

/**
 * The history query shapes. Game history filters on `gameId` and orders by
 * `endedAt` descending, served by the composite index (gameId ↑, endedAt ↓) in
 * firestore.indexes.json; all-games history orders by `endedAt` descending on
 * the automatic single-field index. Document ID descending is the tiebreaker
 * both indexes already end with.
 */
export const GAME_HISTORY_ORDER = [{ field: 'endedAt', direction: 'desc' }] as const;
export const GAME_HISTORY_EQUALITY_FILTERS = ['gameId'] as const;

export function boundedPageSize(requested: number | undefined): number {
  const value = requested === undefined || !Number.isFinite(requested) ? DEFAULT_HISTORY_PAGE_SIZE : Math.floor(requested);
  return Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, value));
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function sessionRecord(raw: Record<string, unknown>, id: string, hasPendingWrites: boolean): GameSessionRecord {
  return {
    id,
    session: readGameSession(raw),
    awaitingResult: !hasOwn(raw, 'result') && !hasOwn(raw, 'processing'),
    hasPendingWrites,
  };
}

function queryRecord(raw: Record<string, unknown>, snapshot: QueryDocumentSnapshot): GameSessionRecord {
  return sessionRecord(raw, snapshot.id, snapshot.metadata.hasPendingWrites);
}

/**
 * A new session seed from the platform's cryptographically strong random
 * source. There is deliberately no weaker fallback.
 */
function newSessionSeed(): number {
  const random = globalThis.crypto;
  if (typeof random?.getRandomValues !== 'function') {
    throw new Error('Secure random numbers are unavailable, so a game session cannot start.');
  }
  // createSessionSeed allocates an ordinary (non-shared) Uint32Array.
  return createSessionSeed((buffer) => random.getRandomValues(buffer as Uint32Array<ArrayBuffer>));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function historyQuery(
  context: ConsumerFirestoreContext,
  uid: string,
  gameId: string | null,
  ...constraints: QueryConstraint[]
): Query {
  return query(
    gameSessionsRef(context.firestore, uid),
    ...(gameId === null ? [] : [where(GAME_HISTORY_EQUALITY_FILTERS[0], '==', assertGameId(gameId))]),
    ...GAME_HISTORY_ORDER.map(({ field, direction }) => orderBy(field, direction)),
    orderBy(documentId(), 'desc'),
    ...constraints,
  );
}

export interface GameSessionRepositoryOptions {
  /**
   * Where session seeds come from. Omitted (as in the app's production wiring,
   * `src/consumer/repositories/index.ts`), each game draws its seed from
   * `crypto.getRandomValues`. A seam for deterministic tests, for example an
   * E2E build replaying the same seed: the repository has no environment
   * logic, so a caller that injects a source owns gating it (for example on
   * `VITE_E2E_EMULATORS`) and must never inject one in a production build.
   * Every value is checked with `sessionSeedSchema`; an invalid one throws
   * when the game starts, and there is no fallback.
   */
  readonly seedSource?: () => number;
}

export class InvalidSessionSeedError extends Error {
  constructor(seed: unknown) {
    super(`The seed source returned an invalid session seed: ${String(seed)}`);
    this.name = 'InvalidSessionSeedError';
  }
}

export function createGameSessionRepository(
  context: ConsumerFirestoreContext,
  options: GameSessionRepositoryOptions = {},
): GameSessionRepository {
  const { firestore } = context;
  const { seedSource } = options;

  function sessionSeed(): number {
    if (!seedSource) return newSessionSeed();
    const seed = seedSource();
    if (!sessionSeedSchema.safeParse(seed).success) throw new InvalidSessionSeedError(seed);
    return seed;
  }

  function startGameSession(): StartedGameSession {
    const userId = signedInUid(context);
    const sessionId = newDocumentId(gameSessionsRef(firestore, userId));
    const seed = sessionSeed();
    let state: 'ready' | 'saving' | 'saved' = 'ready';

    async function save<Trial, Metrics extends object>(input: SaveGameSessionInput<Trial, Metrics>): Promise<SavedGameSession> {
      if (state !== 'ready') throw new GameSessionAlreadySavedError(sessionId);
      if (signedInUid(context) !== userId) throw new GameSessionOwnerChangedError();
      state = 'saving';
      try {
        assertNoReservedKeys('game session', input.session, [...REPOSITORY_OWNED_KEYS, ...SERVER_OWNED_KEYS]);
        const write = {
          ...input.session,
          schemaVersion: GAME_SESSION_SCHEMA_VERSION,
          userId,
          seed,
          createdAt: serverTimestamp(),
        };
        assertNoUndefined('game session', write);
        const parsed = gameSessionCreateSchemaFor(input.definition, serverTimestampSchema).safeParse(write);
        if (!parsed.success) throw new ConsumerWriteValidationError('game session', parsed.error.issues);

        const commit = withSdkValidation('game session', () => setDoc(gameSessionRef(firestore, userId, sessionId), toSdkTimestamps(parsed.data)));
        state = 'saved';
        return { sessionId, userId, ...pendingWrite(commit) };
      } finally {
        // Nothing was queued: the handle can still save.
        if (state === 'saving') state = 'ready';
      }
    }

    return { sessionId, seed, userId, save };
  }

  return {
    startGameSession,

    async getGameSession(sessionId) {
      const snapshot = await getDoc(gameSessionRef(firestore, signedInUid(context), sessionId));
      return readDocument('gameSessions', snapshot, (raw, id) => sessionRecord(raw, id, snapshot.metadata.hasPendingWrites));
    },

    subscribeToGameSession(sessionId, onNext, onError) {
      const ref = gameSessionRef(firestore, signedInUid(context), sessionId);
      return onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
        onNext(readDocument('gameSessions', snapshot, (raw, id) => sessionRecord(raw, id, snapshot.metadata.hasPendingWrites)));
      }, (error) => onError(asError(error)));
    },

    async listGameSessions(options = {}) {
      const uid = signedInUid(context);
      const gameId = options.gameId ?? null;
      const pageSize = boundedPageSize(options.pageSize);
      const { cursor } = options;
      if (cursor && (cursor.uid !== uid || cursor.gameId !== gameId)) {
        throw new Error('This history page belongs to a different list.');
      }
      // One extra document says whether another page exists.
      const snapshot = await getDocs(historyQuery(
        context, uid, gameId,
        ...(cursor ? [startAfter(cursor.endedAt, cursor.id)] : []),
        limit(pageSize + 1),
      ));
      const pageDocs = snapshot.docs.slice(0, pageSize);
      const { readable, unreadable } = readDocuments('gameSessions', pageDocs, queryRecord);
      // The cursor comes from the last raw document, readable or not, so an
      // unreadable document never stalls or repeats a page.
      const last = pageDocs.at(-1);
      return {
        sessions: readable,
        unreadable,
        nextCursor: snapshot.docs.length > pageSize && last
          ? { uid, gameId, endedAt: last.get('endedAt'), id: last.id }
          : null,
        fromCache: snapshot.metadata.fromCache,
      };
    },

    subscribeToRecentGameSessions(options, onNext, onError) {
      const uid = signedInUid(context);
      const recent = historyQuery(context, uid, options.gameId ?? null, limit(boundedPageSize(options.limit)));
      return onSnapshot(recent, { includeMetadataChanges: true }, (snapshot) => {
        const { readable, unreadable } = readDocuments('gameSessions', snapshot.docs, queryRecord);
        onNext({ sessions: readable, unreadable, fromCache: snapshot.metadata.fromCache });
      }, (error) => onError(asError(error)));
    },
  };
}
