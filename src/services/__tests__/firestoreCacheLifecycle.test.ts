import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFirestoreCacheLifecycle,
  DEFAULT_CACHE_TIMEOUTS,
  FIRESTORE_CACHE_STATE_KEY,
  parseCacheState,
  type CacheCleanup,
  type CacheState,
  type FirestoreCacheLifecycleDeps,
} from '../firestoreCacheLifecycle';

// The cache lifecycle against fakes of Firestore, Auth, localStorage and
// navigation. The browser behaviour (real IndexedDB, other tabs) is covered by
// e2e/cache-isolation.persistence.local.spec.ts.

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const failedPrecondition = () => Object.assign(new Error('Persistence can only be cleared before a Firestore instance is initialized or after it is terminated.'), { code: 'failed-precondition' });

interface HarnessOptions {
  readonly state?: CacheState | string;
  readonly storageUnavailable?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const store = new Map<string, string>();
  if (options.state !== undefined) {
    store.set(FIRESTORE_CACHE_STATE_KEY, typeof options.state === 'string' ? options.state : JSON.stringify(options.state));
  }
  const events: string[] = [];
  const storageListeners: ((key: string | null) => void)[] = [];
  /** Firestore's instance in this tab: running once the app has used it, until terminated. */
  const instance = { running: false, terminated: false };
  let ids = 0;
  let clearImpl: () => Promise<void> = async () => {};
  let terminateImpl: () => Promise<void> = async () => {};
  let signOutImpl: () => Promise<void> = async () => {};
  let pendingWritesImpl: () => Promise<void> = async () => {};

  const describeState = (raw: string) => {
    const state = parseCacheState(raw);
    return state ? `state:${state.owner ?? 'none'}${state.cleanup ? `+cleanup(${state.cleanup.reason},${state.cleanup.id})` : ''}` : 'state:unreadable';
  };

  const deps = {
    storage: () => {
      if (options.storageUnavailable) throw new DOMException('Blocked', 'SecurityError');
      return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { events.push(describeState(value)); store.set(key, value); },
      };
    },
    clearPersistence: vi.fn(() => {
      events.push('clear');
      if (instance.running && !instance.terminated) throw failedPrecondition();
      return clearImpl();
    }),
    terminate: vi.fn(() => {
      events.push('terminate');
      return terminateImpl().then(() => { instance.terminated = true; });
    }),
    waitForPendingWrites: vi.fn(() => pendingWritesImpl()),
    signOut: vi.fn(() => { events.push('signOut'); return signOutImpl(); }),
    navigate: vi.fn((destination: string) => { events.push(`navigate:${destination}`); }),
    subscribeToStorageChanges: (listener: (key: string | null) => void) => {
      storageListeners.push(listener);
      return () => {};
    },
    newId: () => `id-${++ids}`,
    now: () => 1_000,
    warn: () => {},
  } satisfies FirestoreCacheLifecycleDeps;

  const lifecycle = createFirestoreCacheLifecycle(deps);
  return {
    lifecycle,
    deps,
    events,
    store,
    state: () => parseCacheState(store.get(FIRESTORE_CACHE_STATE_KEY) ?? null),
    /** The app reads or writes Firestore in this tab. */
    useFirestore: () => { instance.running = true; },
    /** Another tab writes the shared state (the storage event fires here). */
    otherTabWrites: (state: CacheState | null) => {
      if (state === null) store.delete(FIRESTORE_CACHE_STATE_KEY);
      else store.set(FIRESTORE_CACHE_STATE_KEY, JSON.stringify(state));
      for (const listener of storageListeners) listener(FIRESTORE_CACHE_STATE_KEY);
    },
    setClear: (impl: () => Promise<void>) => { clearImpl = impl; },
    setTerminate: (impl: () => Promise<void>) => { terminateImpl = impl; },
    setSignOut: (impl: () => Promise<void>) => { signOutImpl = impl; },
    setPendingWrites: (impl: () => Promise<void>) => { pendingWritesImpl = impl; },
  };
}

const cleanupOf = (overrides: Partial<CacheCleanup> = {}): CacheCleanup => ({
  id: 'earlier', reason: 'sign-out', previousOwner: 'alice', signOut: true, at: 1, ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start-up', () => {
  it('keeps the cache of a known owner, so the same account keeps its offline data across restarts', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser('alice')).toEqual({ status: 'ready' });
    expect(h.deps.clearPersistence).not.toHaveBeenCalled();
    expect(h.deps.navigate).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ v: 1, owner: 'alice' });
  });

  it('starts deleting a cache with no known owner before start() returns, so it precedes any Firestore use', async () => {
    const h = harness();
    h.lifecycle.start();

    // The SDK runs every later Firestore operation after this deletion.
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
    expect(h.events).toEqual(['state:none+cleanup(unknown-owner,id-1)', 'clear']);
    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.state()).toEqual({ v: 1, owner: 'bob' });
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
  });

  it.each([
    ['unparseable JSON', '{not json'],
    ['another version', JSON.stringify({ v: 2, owner: 'alice' })],
    ['an invalid owner', JSON.stringify({ v: 1, owner: 42 })],
  ])('reads %s as an unknown owner and clears', (_label, raw) => {
    const h = harness({ state: raw });
    h.lifecycle.start();
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
  });

  it('finishes an unfinished cleanup first, and signs out the account the user had asked to sign out of', async () => {
    const h = harness({ state: { v: 1, owner: 'alice', cleanup: cleanupOf() } });
    h.lifecycle.start();
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();

    expect(await h.lifecycle.prepareForUser('alice')).toEqual({ status: 'signing-out' });
    expect(h.deps.signOut).toHaveBeenCalledOnce();
    expect(h.state()).toEqual({ v: 1, owner: null });

    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'ready' });
  });

  it('does not sign out a later, deliberate sign-in of that account', async () => {
    const h = harness({ state: { v: 1, owner: 'alice', cleanup: cleanupOf() } });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'ready' });
    expect(await h.lifecycle.prepareForUser('alice')).toEqual({ status: 'ready' });
    expect(h.deps.signOut).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ v: 1, owner: 'alice' });
  });

  it('never signs out a different account that signs in after a failed sign-out', async () => {
    const h = harness({ state: { v: 1, owner: 'alice', cleanup: cleanupOf() } });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.deps.signOut).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ v: 1, owner: 'bob' });
  });

  it('without localStorage clears at every start and still lets the user in', async () => {
    const h = harness({ storageUnavailable: true });
    h.lifecycle.start();
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
  });
});

describe('prepareForUser', () => {
  it('holds a signed-in user until the deletion finishes, and says so when it takes long', async () => {
    vi.useFakeTimers();
    const h = harness({ state: { v: 1, owner: 'alice', cleanup: cleanupOf({ signOut: false }) } });
    const deletion = deferred();
    h.setClear(() => deletion.promise);
    h.lifecycle.start();

    let outcome: unknown;
    void h.lifecycle.prepareForUser('bob').then((value) => { outcome = value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lifecycle.getStatus()).toBe('clearing');
    await vi.advanceTimersByTimeAsync(DEFAULT_CACHE_TIMEOUTS.blockedNoticeMs);
    expect(h.lifecycle.getStatus()).toBe('blocked');
    expect(outcome).toBeUndefined();

    deletion.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ status: 'ready' });
    expect(h.lifecycle.getStatus()).toBe('idle');
    expect(h.state()).toEqual({ v: 1, owner: 'bob' });
  });

  it('does not hold up signed-out screens while a deletion is blocked', async () => {
    const h = harness({ state: { v: 1, owner: 'alice', cleanup: cleanupOf({ signOut: false }) } });
    h.setClear(() => new Promise(() => {}));
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'ready' });
  });

  it('clears another account\'s cache in place, without a reload, when Firestore has not started', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.events).toEqual(['state:alice+cleanup(account-switch,id-1)', 'clear', 'state:none', 'state:bob']);
    expect(h.deps.navigate).not.toHaveBeenCalled();
  });

  it('clears a signed-out device\'s leftover account data in the background', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'ready' });
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.state()).toEqual({ v: 1, owner: 'bob' });
  });

  it('terminates, clears and reloads when the account changes while Firestore is in use', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'reloading' });
    await vi.waitFor(() => expect(h.deps.navigate).toHaveBeenCalled());
    expect(h.events).toEqual(['state:alice+cleanup(account-switch,id-1)', 'terminate', 'clear', 'state:none', 'navigate:/']);
    expect(h.deps.signOut).not.toHaveBeenCalled();
    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'ending' });
  });

  it('clears and reloads when the session ends elsewhere while Firestore is in use', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();

    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'reloading' });
    await vi.waitFor(() => expect(h.deps.navigate).toHaveBeenCalledWith('/'));
    expect(h.events[0]).toBe('state:alice+cleanup(signed-out-elsewhere,id-1)');
    expect(h.state()).toEqual({ v: 1, owner: null });
  });

  it('only reloads, without deleting again, when another tab already cleared the cache for the new account', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();
    h.otherTabWrites({ v: 1, owner: 'bob' });

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'reloading' });
    await vi.waitFor(() => expect(h.deps.navigate).toHaveBeenCalledWith('/'));
    expect(h.deps.terminate).toHaveBeenCalledOnce();
    expect(h.deps.clearPersistence).not.toHaveBeenCalled();
  });

  it('reports failed, and keeps Firestore unused, when the cache cannot be deleted', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.setClear(async () => { throw Object.assign(new Error('IndexedDB broke'), { code: 'internal' }); });
    h.lifecycle.start();

    expect(await h.lifecycle.prepareForUser('bob')).toEqual({ status: 'failed' });
    expect(h.lifecycle.getStatus()).toBe('failed');
    expect(h.state()?.cleanup).toBeDefined();
    expect(h.state()?.owner).toBe('alice');
  });

  it('runs preparations one at a time, in order', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    const deletion = deferred();
    h.setClear(() => deletion.promise);
    h.lifecycle.start();

    const order: string[] = [];
    const bob = h.lifecycle.prepareForUser('bob').then((value) => { order.push(`bob:${value.status}`); });
    const carol = h.lifecycle.prepareForUser('carol').then((value) => { order.push(`carol:${value.status}`); });
    deletion.resolve();
    await Promise.all([bob, carol]);
    // Bob's preparation finished (and Firestore may be in use for him)
    // before Carol's began, so Carol's sees the account change.
    expect(order).toEqual(['bob:ready', 'carol:reloading']);
  });
});

describe('other tabs', () => {
  it('reloads a tab using Firestore when another tab starts a cleanup', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();

    h.otherTabWrites({ v: 1, owner: 'alice', cleanup: cleanupOf({ id: 'other-tab' }) });
    await vi.waitFor(() => expect(h.deps.navigate).toHaveBeenCalledWith('/'));
    // It releases its instance so the other tab's deletion can run, and leaves the deletion to that tab.
    expect(h.events).toEqual(['terminate', 'navigate:/']);
    expect(h.lifecycle.isEnding()).toBe(true);
  });

  it('reloads a tab using Firestore when another tab wipes localStorage', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();

    h.otherTabWrites(null);
    await vi.waitFor(() => expect(h.deps.navigate).toHaveBeenCalledWith('/'));
  });

  it('leaves a signed-out tab alone, and ignores an ordinary owner change', async () => {
    const h = harness({ state: { v: 1, owner: null } });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser(null);

    h.otherTabWrites({ v: 1, owner: 'bob', cleanup: cleanupOf({ id: 'other-tab' }) });
    h.otherTabWrites({ v: 1, owner: 'bob' });
    expect(h.deps.terminate).not.toHaveBeenCalled();
    expect(h.deps.navigate).not.toHaveBeenCalled();
  });
});

describe('endSession', () => {
  async function signedIn(state: CacheState = { v: 1, owner: 'alice' }) {
    const h = harness({ state });
    h.lifecycle.start();
    await h.lifecycle.prepareForUser('alice');
    h.useFirestore();
    return h;
  }

  it('announces, signs out, terminates, deletes the cache, marks it empty, then navigates', async () => {
    const h = await signedIn();

    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.events).toEqual(['state:alice+cleanup(sign-out,id-1)', 'signOut', 'terminate', 'clear', 'state:none', 'navigate:/']);
    expect(h.state()).toEqual({ v: 1, owner: null });
  });

  it('treats auth events during the run as part of it', async () => {
    const h = await signedIn();
    const signingOut = deferred();
    h.setSignOut(() => signingOut.promise);

    const run = h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.lifecycle.isEnding()).toBe(true);
    expect(await h.lifecycle.prepareForUser(null)).toEqual({ status: 'ending' });
    expect(h.lifecycle.endSession({ reason: 'account-switch', signOut: false, destination: '/' })).toBe(run);
    signingOut.resolve();
    await run;
    expect(h.deps.navigate).toHaveBeenCalledOnce();
    expect(h.deps.navigate).toHaveBeenCalledWith('/');
  });

  it.each([
    ['sign-out', 'setSignOut'],
    ['terminate', 'setTerminate'],
    ['clear', 'setClear'],
  ] as const)('bounds a %s that hangs: the user is still signed out, the marker stays, and the app navigates', async (_step, setter) => {
    vi.useFakeTimers();
    const h = await signedIn();
    h[setter](() => new Promise(() => {}));

    let finished = false;
    void h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' }).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(DEFAULT_CACHE_TIMEOUTS.signOutMs + DEFAULT_CACHE_TIMEOUTS.terminateMs + DEFAULT_CACHE_TIMEOUTS.clearMs);
    expect(finished).toBe(true);
    expect(h.deps.signOut).toHaveBeenCalledOnce();
    expect(h.deps.navigate).toHaveBeenCalledWith('/');
    expect(h.state()?.cleanup).toMatchObject({ reason: 'sign-out', signOut: true, previousOwner: 'alice' });
  });

  it('when sign-out hangs, the next start signs the account out even though the deletion succeeded', async () => {
    vi.useFakeTimers();
    const h = await signedIn();
    h.setSignOut(() => new Promise(() => {}));
    void h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    await vi.advanceTimersByTimeAsync(DEFAULT_CACHE_TIMEOUTS.signOutMs);
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
    expect(h.state()?.cleanup).toMatchObject({ signOut: true, previousOwner: 'alice' });

    h.setSignOut(async () => {});
    const next = createFirestoreCacheLifecycle(h.deps);
    next.start();
    // Auth restored the account the user had signed out of.
    expect(await next.prepareForUser('alice')).toEqual({ status: 'signing-out' });
    expect(h.deps.signOut).toHaveBeenCalledTimes(2);
  });

  it('leaves the marker when the deletion fails, and the next start deletes before any Firestore use', async () => {
    const h = await signedIn();
    h.setClear(async () => { throw new Error('blocked'); });
    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.state()?.cleanup?.id).toBe('id-1');

    // The next page load, with the same localStorage: it deletes the cache
    // before start() returns, so before anything can use Firestore.
    const nextClear = vi.fn(async () => {});
    const next = createFirestoreCacheLifecycle({ ...h.deps, clearPersistence: nextClear });
    next.start();
    expect(nextClear).toHaveBeenCalledOnce();
    expect(await next.prepareForUser('bob')).toEqual({ status: 'ready' });
    expect(h.state()).toEqual({ v: 1, owner: 'bob' });
  });

  it('account deletion: deletes the account first, then clears and navigates without signing out again', async () => {
    const h = await signedIn();
    const before = vi.fn(async () => { h.events.push('delete-account'); });

    await h.lifecycle.endSession({ reason: 'account-deleted', signOut: false, destination: '/welcome', before });
    expect(h.events).toEqual(['delete-account', 'state:alice+cleanup(account-deleted,id-1)', 'terminate', 'clear', 'state:none', 'navigate:/welcome']);
  });

  it('account deletion: a failure clears nothing and leaves the session usable', async () => {
    const h = await signedIn();
    const failure = new Error('auth/network-request-failed');

    await expect(h.lifecycle.endSession({ reason: 'account-deleted', signOut: false, destination: '/welcome', before: async () => { throw failure; } }))
      .rejects.toBe(failure);
    expect(h.events).toEqual([]);
    expect(h.lifecycle.isEnding()).toBe(false);
    expect(h.lifecycle.getStatus()).toBe('idle');
    expect(await h.lifecycle.prepareForUser('alice')).toEqual({ status: 'ready' });
  });

  it('does not delete again when another tab has taken the cleanup over', async () => {
    const h = await signedIn();
    h.setTerminate(async () => { h.otherTabWrites({ v: 1, owner: 'alice', cleanup: cleanupOf({ id: 'other-tab' }) }); });

    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.deps.clearPersistence).not.toHaveBeenCalled();
    expect(h.state()?.cleanup?.id).toBe('other-tab');
    expect(h.deps.navigate).toHaveBeenCalledWith('/');
  });

  it('does not delete again when another tab finished the cleanup after this instance closed', async () => {
    const h = await signedIn();
    h.setTerminate(async () => { h.otherTabWrites({ v: 1, owner: null }); });

    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.deps.clearPersistence).not.toHaveBeenCalled();
  });

  it('deletes again, announcing anew, when the cache was claimed by an account meanwhile', async () => {
    const h = await signedIn();
    h.setTerminate(async () => { h.otherTabWrites({ v: 1, owner: 'bob' }); });

    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.deps.clearPersistence).toHaveBeenCalledOnce();
    expect(h.events).toContain('state:bob+cleanup(sign-out,id-2)');
    expect(h.state()).toEqual({ v: 1, owner: null });
  });

  it('never marks the cache empty for a cleanup another tab took over during the deletion', async () => {
    const h = await signedIn();
    h.setClear(async () => { h.otherTabWrites({ v: 1, owner: 'alice', cleanup: cleanupOf({ id: 'other-tab' }) }); });

    await h.lifecycle.endSession({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(h.state()?.cleanup?.id).toBe('other-tab');
  });
});

describe('hasUnsyncedWrites', () => {
  it('is false once queued writes have reached the server', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    expect(await h.lifecycle.hasUnsyncedWrites()).toBe(false);
  });

  it('is true when writes are still queued after the bound (for example offline)', async () => {
    vi.useFakeTimers();
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.setPendingWrites(() => new Promise(() => {}));

    let result: boolean | undefined;
    void h.lifecycle.hasUnsyncedWrites().then((value) => { result = value; });
    await vi.advanceTimersByTimeAsync(DEFAULT_CACHE_TIMEOUTS.unsyncedCheckMs - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(true);
  });

  it('is true when the check itself fails, so the user is asked rather than losing data silently', async () => {
    const h = harness({ state: { v: 1, owner: 'alice' } });
    h.setPendingWrites(async () => { throw new Error('user changed'); });
    expect(await h.lifecycle.hasUnsyncedWrites()).toBe(true);
  });
});
