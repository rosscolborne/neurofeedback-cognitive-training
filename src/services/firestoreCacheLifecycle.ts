/**
 * Who the persistent Firestore cache belongs to, and clearing it when that
 * changes (NFCT-20).
 *
 * The app keeps Firestore's persistent IndexedDB cache (`firestoreCache.ts`)
 * so games can be played and saved offline. That cache holds the signed-in
 * account's documents and its queued writes. It is shared by every account
 * that uses this browser profile, and nothing in the SDK clears it when the
 * account changes. This module owns that lifecycle:
 *
 * - **Same account:** the cache is kept, so offline play and reloads work.
 * - **Sign-out, account switch, sign-out in another tab, account deletion:**
 *   the cache is deleted (`terminate` then `clearIndexedDbPersistence`) and
 *   the page is fully reloaded, so nothing of the previous account survives in
 *   IndexedDB, in React state or in the terminated SDK instance.
 * - **Start-up:** an unfinished cleanup, or a cache whose owner is not known,
 *   is cleared before anything uses Firestore. Signed-in UI waits for
 *   `prepareForUser` (AuthContext), so no read for an account can run before
 *   the cache is known to be that account's or empty. A sign-out that did not
 *   finish is completed first (its marker stays until it succeeds), and while
 *   the deletion is held up the user can still sign out without Firestore.
 * - **Back/forward cache:** the account's screens are replaced (status
 *   `ending`) before the page navigates away, and a page restored from the
 *   cache after its session ended loads the app afresh (`pageshow`).
 *
 * App-owned browser state: one localStorage key, `FIRESTORE_CACHE_STATE_KEY`
 * (`nfct.firestoreCache.v1`), holding `{ v: 1, owner, cleanup? }`:
 * - `owner`: the uid whose data the cache may hold, or `null` once the cache
 *   has been cleared and holds no account's data. A missing or unreadable key
 *   means the owner is unknown, and the cache is cleared before use.
 * - `cleanup`: present from the moment a cleanup starts until it finishes. It
 *   tells other tabs to reload, and tells the next start to clear the cache
 *   before any Firestore use. `signOut` records that the user asked to sign
 *   out, so a sign-out that failed is completed on the next start.
 *
 * Nothing else is cleared: only Firestore's own IndexedDB database (through
 * the SDK) and this key. Firebase Auth's own storage is changed only by
 * `signOut`.
 *
 * Limits:
 * - `clearIndexedDbPersistence` deletes the database; it does not securely
 *   overwrite it on disk.
 * - The deletion waits until every connection to the database closes. App tabs
 *   close theirs (the SDK terminates an instance whose database is deleted,
 *   and this module reloads tabs that were using one). A connection held by
 *   something else (devtools, a frozen or very old tab) blocks it. Sign-out
 *   still completes, the cleanup marker stays, and signed-in use stays gated
 *   ("blocked") until the deletion completes.
 * - Without localStorage the owner is never known, so every start clears the
 *   cache: privacy is kept, at the cost of offline continuity across restarts.
 */

export const FIRESTORE_CACHE_STATE_KEY = 'nfct.firestoreCache.v1';

/**
 * Where a tab goes when the account changes under it (account switch, a
 * session ended in another tab): a full load of the app's root, so the next
 * account starts clean and nothing of the previous account's route remains.
 */
export const IDENTITY_CHANGE_DESTINATION = '/';

/** How long sign-out waits for queued writes to reach the server before warning that they would be lost. */
export const UNSYNCED_WRITES_CHECK_TIMEOUT_MS = 3_000;
/** Bound on Firebase Auth's sign-out during a cleanup. */
export const CLEANUP_SIGN_OUT_TIMEOUT_MS = 5_000;
/** Bound on terminating this tab's Firestore instance during a cleanup. */
export const CLEANUP_TERMINATE_TIMEOUT_MS = 5_000;
/** Bound on deleting the cache during a cleanup; past it the next start finishes the job. */
export const CLEANUP_CLEAR_TIMEOUT_MS = 5_000;
/** How long a start-up clear may wait before the app says something is holding the cache open. */
export const CLEAR_BLOCKED_NOTICE_MS = 3_000;

export type CacheEndReason = 'sign-out' | 'account-deleted' | 'account-switch' | 'signed-out-elsewhere' | 'unknown-owner';

export interface CacheCleanup {
  readonly id: string;
  readonly reason: CacheEndReason;
  /** The account whose data is being removed, when known. */
  readonly previousOwner: string | null;
  /** The user asked to sign out: the next start signs that account out if it is still signed in. */
  readonly signOut: boolean;
  readonly at: number;
}

export interface CacheState {
  readonly v: 1;
  readonly owner: string | null;
  readonly cleanup?: CacheCleanup;
}

/**
 * - `idle`: nothing in progress.
 * - `clearing`: a signed-in user waits for the cache to be cleared.
 * - `blocked`: that wait has passed `CLEAR_BLOCKED_NOTICE_MS`; something holds the database open.
 * - `failed`: the cache could not be cleared; Firestore stays unused for the signed-in user.
 * - `ending`: this tab is ending the session and will navigate.
 */
export type CacheStatus = 'idle' | 'clearing' | 'blocked' | 'failed' | 'ending';

/**
 * The outcome of `prepareForUser`. Only `ready` lets the caller use Firestore
 * for that user. Every other outcome means the page is about to navigate, a
 * new auth event will follow, or the cache could not be cleared.
 */
export type CachePreparation =
  | { readonly status: 'ready' }
  | { readonly status: 'reloading' }
  | { readonly status: 'signing-out' }
  | { readonly status: 'ending' }
  | { readonly status: 'failed' };

export interface EndSessionOptions {
  readonly reason: CacheEndReason;
  /** Sign out of Firebase Auth as part of the cleanup. */
  readonly signOut: boolean;
  /** Where to go afterwards, with a full page load. */
  readonly destination: string;
  /**
   * Work that must finish before anything is cleared (account deletion runs
   * `user.delete()` here). Auth events during it are not treated as an
   * account change. If it throws, nothing is cleared and the error is rethrown.
   */
  readonly before?: () => Promise<void>;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CacheTimeouts {
  readonly unsyncedCheckMs: number;
  readonly signOutMs: number;
  readonly terminateMs: number;
  readonly clearMs: number;
  readonly blockedNoticeMs: number;
}

export const DEFAULT_CACHE_TIMEOUTS: CacheTimeouts = {
  unsyncedCheckMs: UNSYNCED_WRITES_CHECK_TIMEOUT_MS,
  signOutMs: CLEANUP_SIGN_OUT_TIMEOUT_MS,
  terminateMs: CLEANUP_TERMINATE_TIMEOUT_MS,
  clearMs: CLEANUP_CLEAR_TIMEOUT_MS,
  blockedNoticeMs: CLEAR_BLOCKED_NOTICE_MS,
};

export interface FirestoreCacheLifecycleDeps {
  /** localStorage, or null (or a throw) where it is unavailable. */
  readonly storage: () => KeyValueStorage | null;
  /** `clearIndexedDbPersistence(db)`: throws or rejects with `failed-precondition` while the instance is running. */
  readonly clearPersistence: () => Promise<void>;
  /** `terminate(db)`. */
  readonly terminate: () => Promise<void>;
  /** `waitForPendingWrites(db)`. */
  readonly waitForPendingWrites: () => Promise<void>;
  /** `signOut(auth)`. */
  readonly signOut: () => Promise<void>;
  /** A full page load of `destination` (never a client-side route change). */
  readonly navigate: (destination: string) => void;
  /** Calls the listener with the changed key when another tab changes localStorage (`null`: cleared). */
  readonly subscribeToStorageChanges?: (listener: (key: string | null) => void) => () => void;
  /** Calls the listener on every `pageshow`, with whether the page came back from the back/forward cache. */
  readonly subscribeToPageShow?: (listener: (persisted: boolean) => void) => () => void;
  readonly newId?: () => string;
  readonly now?: () => number;
  readonly timeouts?: Partial<CacheTimeouts>;
  readonly warn?: (message: string, error?: unknown) => void;
}

export interface FirestoreCacheLifecycle {
  /**
   * Runs once, when the app's Firestore instance has been created and before
   * anything uses it: starts clearing an unknown or half-cleared cache. The
   * SDK runs every later Firestore operation after that deletion.
   */
  start(): void;
  /**
   * Makes the cache safe for `uid` (null: signed out) and resolves `ready`
   * when the caller may use Firestore for that user. Signed-in UI must not
   * read Firestore for a user before this resolves `ready`.
   */
  prepareForUser(uid: string | null): Promise<CachePreparation>;
  /**
   * Whether the signed-in user has writes the server has not accepted yet,
   * after waiting up to `UNSYNCED_WRITES_CHECK_TIMEOUT_MS` for them to upload.
   */
  hasUnsyncedWrites(): Promise<boolean>;
  /**
   * Ends the session in this tab: clears the cache (bounded at every step)
   * and navigates. Concurrent calls share the first call's run.
   */
  endSession(options: EndSessionOptions): Promise<void>;
  /**
   * Signs out of Firebase Auth without touching Firestore, then loads the app
   * afresh: the way out while the cache is still being deleted (`blocked`) or
   * could not be (`failed`). The cleanup marker stays, so the next start keeps
   * deleting the cache before any Firestore use.
   */
  signOutWithoutFirestore(): Promise<void>;
  /** True while this tab is ending its session; auth events then belong to that run. */
  isEnding(): boolean;
  getStatus(): CacheStatus;
  /** Why this tab is ending its session, while `getStatus()` is `ending`. */
  getEndingReason(): CacheEndReason | null;
  subscribe(listener: () => void): () => void;
}

class StepTimeout extends Error {
  constructor(step: string, ms: number) {
    super(`${step} did not finish within ${ms} ms`);
    this.name = 'StepTimeout';
  }
}

function isFailedPrecondition(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'failed-precondition';
}

function isUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

const REASONS: readonly CacheEndReason[] = ['sign-out', 'account-deleted', 'account-switch', 'signed-out-elsewhere', 'unknown-owner'];

function parseCleanup(value: unknown): CacheCleanup | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const cleanup = value as Record<string, unknown>;
  if (typeof cleanup.id !== 'string' || !cleanup.id) return undefined;
  if (!REASONS.includes(cleanup.reason as CacheEndReason)) return undefined;
  if (cleanup.previousOwner !== null && !isUid(cleanup.previousOwner)) return undefined;
  if (typeof cleanup.signOut !== 'boolean' || typeof cleanup.at !== 'number') return undefined;
  return {
    id: cleanup.id,
    reason: cleanup.reason as CacheEndReason,
    previousOwner: cleanup.previousOwner as string | null,
    signOut: cleanup.signOut,
    at: cleanup.at,
  };
}

/** Parses the stored state; anything malformed reads as unknown (undefined). */
export function parseCacheState(raw: string | null): CacheState | undefined {
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null || value.v !== 1) return undefined;
    if (value.owner !== null && !isUid(value.owner)) return undefined;
    if (value.cleanup === undefined) return { v: 1, owner: value.owner as string | null };
    const cleanup = parseCleanup(value.cleanup);
    // A malformed cleanup still means a cleanup was in progress: keep it as one.
    return {
      v: 1,
      owner: value.owner as string | null,
      cleanup: cleanup ?? { id: 'unreadable', reason: 'unknown-owner', previousOwner: null, signOut: false, at: 0 },
    };
  } catch {
    return undefined;
  }
}

function defaultId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createFirestoreCacheLifecycle(deps: FirestoreCacheLifecycleDeps): FirestoreCacheLifecycle {
  const timeouts: CacheTimeouts = { ...DEFAULT_CACHE_TIMEOUTS, ...deps.timeouts };
  const newId = deps.newId ?? defaultId;
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((message: string, error?: unknown) => console.warn(message, error));

  let started = false;
  /** A clear started at start-up or for a signed-out tab, not yet awaited by a signed-in preparation. */
  let pendingClear: Promise<'cleared' | 'started' | 'failed'> | null = null;
  /** The cleanup marker found at start-up: its sign-out intent applies to the first auth state only. */
  let startupCleanup: CacheCleanup | null = null;
  /**
   * A start-up cleanup with a sign-out intent is not marked done when its
   * deletion finishes, only once that intent is settled: the account signed
   * out, or the first auth state shows it does not apply. Until then the
   * marker stays, so a start that cannot sign out leaves it for the next.
   */
  let deferredCompletion: CacheCleanup | null = null;
  let endingReason: CacheEndReason | null = null;
  let firstPreparation = true;
  /** The user this tab last prepared Firestore for (undefined: none yet). */
  let preparedUid: string | null | undefined;
  /** Firestore may be in use in this tab for a signed-in user. */
  let inUse = false;
  /** The cache was cleared in this page and nothing has used Firestore since. */
  let clearedThisPage = false;
  let ending: Promise<void> | null = null;
  /** Preparations run one at a time, in the order auth events arrive. */
  let queue: Promise<unknown> = Promise.resolve();
  let inFlight: { uid: string | null; promise: Promise<CachePreparation> } | null = null;
  let status: CacheStatus = 'idle';
  const listeners = new Set<() => void>();

  function setStatus(next: CacheStatus) {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener();
  }

  function storage(): KeyValueStorage | null {
    try {
      return deps.storage();
    } catch {
      return null;
    }
  }

  function readState(): CacheState | undefined {
    try {
      return parseCacheState(storage()?.getItem(FIRESTORE_CACHE_STATE_KEY) ?? null);
    } catch {
      return undefined;
    }
  }

  function writeState(state: CacheState): boolean {
    try {
      const target = storage();
      if (!target) return false;
      target.setItem(FIRESTORE_CACHE_STATE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      warn('Could not record the Firestore cache owner:', error);
      return false;
    }
  }

  /** Records that a cleanup has started. Other tabs see it and reload; the next start finishes it. */
  function announce(reason: CacheEndReason, previousOwner: string | null, signOut: boolean): CacheCleanup {
    const cleanup: CacheCleanup = { id: newId(), reason, previousOwner, signOut, at: now() };
    writeState({ v: 1, owner: readState()?.owner ?? previousOwner, cleanup });
    return cleanup;
  }

  /** Marks the cache empty, unless another tab has taken over the cleanup since. */
  function complete(cleanupId: string) {
    const state = readState();
    if (state?.cleanup?.id === cleanupId) writeState({ v: 1, owner: null });
  }

  function within<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new StepTimeout(step, ms)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /** Runs a bounded cleanup step; true if it finished in time. Never throws. */
  async function step(run: () => Promise<unknown>, ms: number, name: string): Promise<boolean> {
    try {
      await within(Promise.resolve().then(run), ms, name);
      return true;
    } catch (error) {
      warn(`Firestore cache cleanup: ${name} did not complete.`, error);
      return false;
    }
  }

  /**
   * Deletes the cache while this tab's Firestore instance has not started.
   * `started` means it has, and only terminate-and-reload can clear it.
   */
  async function clearInPlace(cleanup: CacheCleanup, completeWhenCleared = true): Promise<'cleared' | 'started' | 'failed'> {
    let clearing: Promise<void>;
    try {
      clearing = deps.clearPersistence();
    } catch (error) {
      if (isFailedPrecondition(error)) return 'started';
      warn('Could not clear the Firestore cache:', error);
      return 'failed';
    }
    try {
      await clearing;
    } catch (error) {
      if (isFailedPrecondition(error)) return 'started';
      warn('Could not clear the Firestore cache:', error);
      return 'failed';
    }
    clearedThisPage = true;
    if (completeWhenCleared) complete(cleanup.id);
    return 'cleared';
  }

  /** Waits for a clear on behalf of a signed-in user, reporting a long wait as `blocked`. */
  async function awaitClear(clear: Promise<'cleared' | 'started' | 'failed'>) {
    setStatus('clearing');
    const notice = setTimeout(() => { if (status === 'clearing') setStatus('blocked'); }, timeouts.blockedNoticeMs);
    try {
      return await clear;
    } finally {
      clearTimeout(notice);
      if (status === 'clearing' || status === 'blocked') setStatus('idle');
    }
  }

  /** Releases this tab's instance and reloads; another tab or the next start does the clearing. */
  function reloadOnly(): Promise<void> {
    if (ending) return ending;
    endingReason = 'signed-out-elsewhere';
    setStatus('ending');
    ending = (async () => {
      await step(() => deps.terminate(), timeouts.terminateMs, 'terminate');
      deps.navigate(IDENTITY_CHANGE_DESTINATION);
    })();
    return ending;
  }

  async function runEndSession(options: EndSessionOptions): Promise<void> {
    if (options.before) await options.before();
    // From here the session is over: the app replaces the account's screens
    // (AuthContext and App watch the status) before anything else happens, so
    // the page that navigates away shows none of the account's data, even if
    // the back/forward cache keeps it.
    endingReason = options.reason;
    setStatus('ending');
    const previousOwner = preparedUid ?? readState()?.owner ?? null;
    const cleanup = announce(options.reason, previousOwner, options.signOut);
    // If sign-out does not finish, the marker (with its sign-out intent) is
    // kept even when the deletion succeeds, so the next start signs out the
    // account that is still signed in instead of accepting it.
    const signedOut = !options.signOut || await step(() => deps.signOut(), timeouts.signOutMs, 'sign-out');
    await step(() => deps.terminate(), timeouts.terminateMs, 'terminate');
    // Another tab took the cleanup over, or finished it: either way its
    // deletion ran after this announcement and after this tab's instance
    // closed (a deletion waits for every connection), so it covers this tab's
    // data. Delete again in every other case, announcing anew if the cache
    // was claimed meanwhile, so the tab using it reloads.
    const state = readState();
    const takenOver = state?.cleanup !== undefined && state.cleanup.id !== cleanup.id;
    const finishedElsewhere = state !== undefined && state.cleanup === undefined && state.owner === null;
    if (!takenOver && !finishedElsewhere) {
      const current = state !== undefined && state.cleanup === undefined
        ? announce(options.reason, previousOwner, options.signOut)
        : cleanup;
      if (await step(() => deps.clearPersistence(), timeouts.clearMs, 'clear') && signedOut) complete(current.id);
    }
    deps.navigate(options.destination);
  }

  function endSession(options: EndSessionOptions): Promise<void> {
    if (ending) return ending;
    const run: Promise<void> = runEndSession(options).catch((error: unknown) => {
      // Only `before` can throw: nothing was cleared, the session goes on.
      if (ending === run) {
        ending = null;
        endingReason = null;
        setStatus('idle');
      }
      throw error;
    });
    ending = run;
    return run;
  }

  /** The signed-in account changed while this tab was using Firestore. */
  async function dropSession(uid: string | null): Promise<CachePreparation> {
    const state = readState();
    if (state?.cleanup || (state !== undefined && state.owner === uid)) {
      // Another tab is clearing, or has cleared and claimed the cache for the
      // new user: release this tab's instance and reload; do not delete again.
      void reloadOnly();
      return { status: 'reloading' };
    }
    void endSession({ reason: uid === null ? 'signed-out-elsewhere' : 'account-switch', signOut: false, destination: IDENTITY_CHANGE_DESTINATION });
    return { status: 'reloading' };
  }

  async function prepare(uid: string | null): Promise<CachePreparation> {
    const intent = firstPreparation ? startupCleanup : null;
    firstPreparation = false;
    // The start-up sign-out intent applies only if this first auth state is
    // the account the user signed out of; otherwise its cleanup is just a
    // deletion, done once that deletion finishes.
    const signOutIntent = intent?.signOut === true && intent.previousOwner === uid && uid !== null;
    if (deferredCompletion && !signOutIntent) {
      const settled = deferredCompletion;
      deferredCompletion = null;
      const clear = pendingClear;
      if (clear) void clear.then((result) => { if (result === 'cleared') complete(settled.id); });
    }

    if (inUse && preparedUid !== uid) return dropSession(uid);

    if (uid === null) {
      // Signed-out screens never read Firestore, so nothing waits here. A
      // cache still holding an account's data is cleared in the background;
      // the next signed-in preparation waits for it.
      const state = readState();
      if (!pendingClear && state !== undefined && !state.cleanup && state.owner !== null) {
        pendingClear = clearInPlace(announce('signed-out-elsewhere', state.owner, false));
      }
      preparedUid = null;
      return { status: 'ready' };
    }

    if (pendingClear) {
      const clear = pendingClear;
      const result = await awaitClear(clear);
      if (pendingClear === clear) pendingClear = null;
      if (result === 'started') return dropSession(uid);
      if (result === 'failed') {
        setStatus('failed');
        return { status: 'failed' };
      }
    }

    // A sign-out that could not finish last time: the account the user signed
    // out of is still signed in, so sign it out now. A later, deliberate
    // sign-in (not the first auth state of this page) is left alone. The
    // marker stays until the sign-out succeeds, so if it fails again the next
    // start tries again instead of accepting the account.
    if (signOutIntent && intent) {
      if (await step(() => deps.signOut(), timeouts.signOutMs, 'sign-out')) {
        if (deferredCompletion?.id === intent.id) complete(intent.id);
        deferredCompletion = null;
      } else {
        setStatus('failed');
      }
      return { status: 'signing-out' };
    }

    let state = readState();
    if (state?.cleanup) {
      // A cleanup started elsewhere after this page started, or one that failed: finish it first.
      const result = await awaitClear(clearInPlace(state.cleanup));
      if (result === 'started') return dropSession(uid);
      if (result === 'failed') {
        setStatus('failed');
        return { status: 'failed' };
      }
      state = readState();
    }

    if (state?.owner === uid || state?.owner === null || (state === undefined && clearedThisPage)) {
      if (state?.owner !== uid) writeState({ v: 1, owner: uid });
      preparedUid = uid;
      inUse = true;
      clearedThisPage = false;
      return { status: 'ready' };
    }

    // The cache may hold another account's data, or its owner is unknown.
    const result = await awaitClear(clearInPlace(announce('account-switch', state?.owner ?? null, false)));
    if (result === 'started') return dropSession(uid);
    if (result === 'failed') {
      setStatus('failed');
      return { status: 'failed' };
    }
    writeState({ v: 1, owner: uid });
    preparedUid = uid;
    inUse = true;
    clearedThisPage = false;
    return { status: 'ready' };
  }

  /**
   * A page restored from the back/forward cache keeps the JavaScript state
   * and screens it had when it navigated away. If its session ended since
   * (here or in another tab), load the app afresh instead of showing it.
   */
  function onPageShow(persisted: boolean) {
    if (!persisted) return;
    const state = readState();
    const changed = preparedUid !== undefined
      && (state === undefined || state.cleanup !== undefined || state.owner !== preparedUid);
    if (ending !== null || status === 'ending' || changed) deps.navigate(IDENTITY_CHANGE_DESTINATION);
  }

  function onStorageChange(key: string | null) {
    if (key !== null && key !== FIRESTORE_CACHE_STATE_KEY) return;
    if (ending || !inUse) return;
    const state = readState();
    // Another tab started a cleanup (or storage was wiped): this tab's
    // instance and screens belong to the previous session. Reload.
    if (state === undefined || state.cleanup) void reloadOnly();
  }

  return {
    start() {
      if (started) return;
      started = true;
      const state = readState();
      if (state === undefined || state.cleanup) {
        startupCleanup = state?.cleanup ?? null;
        const cleanup = state?.cleanup ?? announce('unknown-owner', null, false);
        if (cleanup.signOut) deferredCompletion = cleanup;
        pendingClear = clearInPlace(cleanup, !cleanup.signOut);
      }
      deps.subscribeToStorageChanges?.(onStorageChange);
      deps.subscribeToPageShow?.(onPageShow);
    },

    prepareForUser(uid) {
      if (ending) return Promise.resolve({ status: 'ending' });
      if (inFlight && inFlight.uid === uid) return inFlight.promise;
      const promise: Promise<CachePreparation> = queue.then(() => (ending ? { status: 'ending' as const } : prepare(uid)));
      inFlight = { uid, promise };
      queue = promise.then(
        () => { if (inFlight?.promise === promise) inFlight = null; },
        () => { if (inFlight?.promise === promise) inFlight = null; },
      );
      return promise;
    },

    async hasUnsyncedWrites() {
      try {
        await within(Promise.resolve().then(() => deps.waitForPendingWrites()), timeouts.unsyncedCheckMs, 'waitForPendingWrites');
        return false;
      } catch {
        return true;
      }
    },

    endSession,

    signOutWithoutFirestore() {
      if (ending) return ending;
      endingReason = 'sign-out';
      setStatus('ending');
      ending = (async () => {
        await step(() => deps.signOut(), timeouts.signOutMs, 'sign-out');
        deps.navigate(IDENTITY_CHANGE_DESTINATION);
      })();
      return ending;
    },

    isEnding: () => ending !== null,
    getStatus: () => status,
    getEndingReason: () => (status === 'ending' ? endingReason : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
