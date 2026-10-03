import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NFCT-44: a slow or failed read of users/{uid} must never count as "no
// profile". Only a server-confirmed read finding none does, and then the app
// creates the profile and waits for the server to accept it. Otherwise the app
// keeps loading and, after an error or PROFILE_LOOKUP_RETRY_AFTER_MS, offers a
// retry. A transient failure also retries by itself, so a brief outage does
// not need a tap.

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  currentUser: null as null | { uid: string; email: string | null; displayName: string | null },
}));
const profiles = vi.hoisted(() => ({ getProfile: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn() }));
const cache = vi.hoisted(() => ({
  prepareForUser: vi.fn(),
  isEnding: vi.fn(() => false),
  hasUnsyncedWrites: vi.fn(),
  endSession: vi.fn(),
  signOutWithoutFirestore: vi.fn(),
  subscribe: () => () => {},
  getStatus: () => 'idle',
  getEndingReason: () => null,
}));

vi.mock('../../services/firebase', () => ({
  auth: { get currentUser() { return firebaseAuth.currentUser; } },
  firestoreCache: cache,
}));
vi.mock('../../consumer/repositories', () => ({ profileRepository: profiles }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(async (_auth: unknown, email: string) => {
    const user = { uid: 'carol', email, displayName: null };
    firebaseAuth.currentUser = user;
    // The SDK notifies listeners before the call resolves.
    void firebaseAuth.callback!(user);
    return { user };
  }),
  sendPasswordResetEmail: vi.fn(),
}));

import {
  AuthProvider,
  PROFILE_LOOKUP_AUTO_RETRY_MAX_MS,
  PROFILE_LOOKUP_AUTO_RETRY_MS,
  PROFILE_LOOKUP_RETRY_AFTER_MS,
  useAuth,
} from '../AuthContext';

type Read =
  | { status: 'readable'; id: string; data: { displayName: string | null }; fromCache: boolean; hasPendingWrites: boolean }
  | { status: 'missing'; id: string; fromCache: boolean; hasPendingWrites: boolean }
  | { status: 'unreadable'; id: string; error: Error; fromCache: boolean; hasPendingWrites: boolean };
const readable = (displayName: string | null = 'Alice', { fromCache = false } = {}): Read =>
  ({ status: 'readable', id: 'alice', data: { displayName }, fromCache, hasPendingWrites: false });
const missing = ({ fromCache = false } = {}): Read => ({ status: 'missing', id: 'alice', fromCache, hasPendingWrites: false });
const unreadable = (): Read =>
  ({ status: 'unreadable', id: 'alice', error: new Error('unsupported schemaVersion'), fromCache: false, hasPendingWrites: false });
const unavailable = () => Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
const accepted = () => ({ acknowledged: Promise.resolve() });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

let observed: ReturnType<typeof useAuth>;
const Probe = () => {
  const value = useAuth();
  React.useEffect(() => { observed = value; });
  return null;
};

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthProvider><Probe /></AuthProvider>); });
  return renderer;
}

async function signIn(user = { uid: 'alice', email: 'alice@example.com', displayName: null as string | null }): Promise<ReactTestRenderer> {
  const renderer = await render();
  firebaseAuth.currentUser = user;
  await act(async () => { void firebaseAuth.callback!(user); });
  return renderer;
}

/** The profile is unknown: App keeps the loading screen. */
function expectProfileUnknown(uid = 'alice') {
  expect(observed.user?.uid).toBe(uid);
  expect(observed.profile).toBeNull();
  expect(observed.loading).toBe(true);
}

function expectOpen(displayName: string | null = 'Alice') {
  expect(observed.profile).toEqual({ displayName });
  expect(observed.loading).toBe(false);
  expect(observed.profileLookupFailed).toBe(false);
}

describe('AuthContext profile lookup (NFCT-44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Unconsumed one-off answers must not leak into the next test.
    profiles.getProfile.mockReset();
    profiles.createProfile.mockReset();
    profiles.updateProfile.mockReset();
    firebaseAuth.currentUser = null;
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cache.prepareForUser.mockResolvedValue({ status: 'ready' });
    cache.isEnding.mockReturnValue(false);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps loading while the read is slow, offers a retry after the bound, and still opens on a late answer', async () => {
    const read = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(read.promise);
    const renderer = await signIn();

    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_RETRY_AFTER_MS - 1); });
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);

    await act(async () => { read.resolve(readable()); });
    expectOpen();
    renderer.unmount();
  });

  it('treats a failed read (offline with nothing cached) as unknown, and a retry that succeeds opens the app', async () => {
    profiles.getProfile.mockRejectedValueOnce(unavailable());
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);

    const retry = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(retry.promise);
    await act(async () => { observed.retryProfileLookup(); });
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(false);

    await act(async () => { retry.resolve(readable()); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(2);
    expectOpen();
    renderer.unmount();
  });

  it('neither creates a profile nor opens when only the device cache answers that there is none', async () => {
    profiles.getProfile.mockResolvedValueOnce(missing({ fromCache: true }));
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);
    expect(profiles.createProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('opens offline with the profile from the device cache', async () => {
    profiles.getProfile.mockResolvedValueOnce(readable('Alice', { fromCache: true }));
    const renderer = await signIn();
    expectOpen();
    expect(profiles.createProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('creates the profile once the server confirms there is none, and opens only after the server accepts it', async () => {
    const write = deferred<void>();
    profiles.getProfile.mockResolvedValueOnce(missing()).mockResolvedValueOnce(readable('Local Player'));
    profiles.createProfile.mockReturnValueOnce({ acknowledged: write.promise });
    const renderer = await signIn({ uid: 'alice', email: 'alice@example.com', displayName: 'Local Player' });

    expect(profiles.createProfile).toHaveBeenCalledTimes(1);
    expect(profiles.createProfile.mock.calls[0][0]).toMatchObject({
      displayName: 'Local Player',
      avatar: null,
      preferences: { soundEnabled: true, hapticsEnabled: true, weeklyGoal: null },
      onboarding: { version: 1 },
      eeg: { enabled: false, preferredDevice: null },
    });
    expectProfileUnknown();

    await act(async () => { write.resolve(); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(2);
    expectOpen('Local Player');
    renderer.unmount();
  });

  it('never opens on a refused profile write, and does not retry it by itself', async () => {
    profiles.getProfile.mockResolvedValueOnce(missing());
    const refused = Promise.reject(denied());
    refused.catch(() => undefined);
    profiles.createProfile.mockReturnValueOnce({ acknowledged: refused });
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 2); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    expect(profiles.createProfile).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('reports a profile this app cannot read as a failure, without overwriting it or retrying by itself', async () => {
    profiles.getProfile.mockResolvedValueOnce(unreadable());
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 2); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    expect(profiles.createProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('creates a new account’s profile with the name typed at sign-up', async () => {
    profiles.getProfile.mockResolvedValueOnce(missing()).mockResolvedValueOnce(readable('Carol Ng'));
    profiles.createProfile.mockReturnValueOnce(accepted());
    const renderer = await render();

    await act(async () => { await observed.signup(' Carol@Example.com ', 'secret-password', '  Carol Ng  '); });

    expect(profiles.createProfile).toHaveBeenCalledTimes(1);
    expect(profiles.createProfile.mock.calls[0][0]).toMatchObject({ displayName: 'Carol Ng' });
    expect(observed.user?.uid).toBe('carol');
    expectOpen('Carol Ng');
    renderer.unmount();
  });

  it('does not give the typed name to a different account', async () => {
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    vi.mocked(createUserWithEmailAndPassword).mockRejectedValueOnce(Object.assign(new Error('in use'), { code: 'auth/email-already-in-use' }));
    const renderer = await render();
    await act(async () => {
      await expect(observed.signup('carol@example.com', 'secret-password', 'Carol Ng')).rejects.toThrow('in use');
    });

    // Someone else then signs in on this device, and has no profile yet.
    profiles.getProfile.mockResolvedValueOnce(missing()).mockResolvedValueOnce(readable(null));
    profiles.createProfile.mockReturnValueOnce(accepted());
    firebaseAuth.currentUser = { uid: 'alice', email: 'carol@example.com', displayName: null };
    await act(async () => { void firebaseAuth.callback!(firebaseAuth.currentUser); });
    expect(profiles.createProfile.mock.calls[0][0]).toMatchObject({ displayName: null });
    renderer.unmount();
  });

  it('ignores a superseded read once a retry has started', async () => {
    const first = deferred<Read>();
    const second = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderer = await signIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_RETRY_AFTER_MS); });
    expect(observed.profileLookupFailed).toBe(true);

    await act(async () => { observed.retryProfileLookup(); });
    await act(async () => { first.reject(unavailable()); });
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(false);

    await act(async () => { second.resolve(readable()); });
    expectOpen();
    renderer.unmount();
  });

  it('retries a transient failure by itself, backing off, and opens the app once the read succeeds', async () => {
    profiles.getProfile
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(unavailable())
      .mockResolvedValueOnce(readable());
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MS - 1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(2);
    // The retry screen stays up between automatic attempts instead of flickering.
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MS * 2 - 1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(3);
    expectOpen();
    renderer.unmount();
  });

  it('keeps retrying while only the device cache answers, and creates the profile once the server confirms there is none', async () => {
    profiles.getProfile.mockResolvedValue(missing({ fromCache: true }));
    const renderer = await signIn();
    expectProfileUnknown();

    // Backs off to the cap and keeps going while the server stays out of reach.
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 4); });
    const attempts = profiles.getProfile.mock.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(4);
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);
    expect(profiles.createProfile).not.toHaveBeenCalled();

    profiles.getProfile.mockReset();
    profiles.getProfile.mockResolvedValueOnce(missing()).mockResolvedValueOnce(readable(null));
    profiles.createProfile.mockReturnValueOnce(accepted());
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS); });
    expect(profiles.createProfile).toHaveBeenCalledTimes(1);
    expectOpen(null);
    renderer.unmount();
  });

  it('does not retry a denied read by itself, and logs each kind of failure once', async () => {
    profiles.getProfile.mockRejectedValueOnce(denied());
    const renderer = await signIn();
    expectProfileUnknown();
    expect(observed.profileLookupFailed).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 2); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    renderer.unmount();

    // Offline twice, then denied: two warnings, and the denial ends the retries.
    vi.mocked(console.warn).mockClear();
    profiles.getProfile.mockReset();
    profiles.getProfile.mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(denied());
    const again = await signIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 4); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(3);
    expect(vi.mocked(console.warn).mock.calls.map(([message, error]) => [message, (error as { code: string }).code])).toEqual([
      ['Could not load the player profile:', 'unavailable'],
      ['Could not load the player profile:', 'permission-denied'],
    ]);
    again.unmount();
  });

  it('a tap on Try again replaces the pending automatic retry, and signing out stops retrying', async () => {
    profiles.getProfile.mockRejectedValue(unavailable());
    const renderer = await signIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MS); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(2);

    // Try again restarts the back-off: one read now, the next after the first delay.
    await act(async () => { observed.retryProfileLookup(); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MS - 1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(4);

    firebaseAuth.currentUser = null;
    await act(async () => { await firebaseAuth.callback!(null); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 4); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(4);
    expect(observed.user).toBeNull();
    renderer.unmount();
  });

  it('stops retrying for an account that has been replaced, or once unmounted', async () => {
    profiles.getProfile.mockRejectedValue(unavailable());
    const renderer = await signIn();
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);

    // Bob signs in while Alice's retry is pending: only Bob's lookup reads.
    profiles.getProfile.mockReset();
    const bob = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(bob.promise);
    firebaseAuth.currentUser = { uid: 'bob', email: 'bob@example.com', displayName: null };
    await act(async () => { void firebaseAuth.callback!(firebaseAuth.currentUser); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 4); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    await act(async () => { bob.resolve(readable('Bob')); });
    expect(observed.user?.uid).toBe('bob');
    expectOpen('Bob');
    renderer.unmount();

    // Unmounted with a retry pending: no further reads.
    profiles.getProfile.mockReset();
    profiles.getProfile.mockRejectedValue(unavailable());
    const again = await signIn();
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    await act(async () => { again.unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_AUTO_RETRY_MAX_MS * 4); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
  });

  it('does not create a profile for an account that signed out while the read ran', async () => {
    const read = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(read.promise);
    const renderer = await signIn();

    firebaseAuth.currentUser = null;
    await act(async () => { await firebaseAuth.callback!(null); });
    await act(async () => { read.resolve(missing()); });
    expect(profiles.createProfile).not.toHaveBeenCalled();
    expect(observed.user).toBeNull();
    expect(observed.profile).toBeNull();
    renderer.unmount();
  });

  it('drops a failed lookup when the account signs out meanwhile', async () => {
    const read = deferred<Read>();
    profiles.getProfile.mockReturnValueOnce(read.promise);
    const renderer = await signIn();

    firebaseAuth.currentUser = null;
    await act(async () => { await firebaseAuth.callback!(null); });
    await act(async () => { read.reject(unavailable()); await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_RETRY_AFTER_MS); });
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(false);
    expect(observed.profileLookupFailed).toBe(false);
    renderer.unmount();
  });
});

describe('AuthContext profile updates', () => {
  const photo = { kind: 'photo', dataUrl: 'data:image/jpeg;base64,AAAA' } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    profiles.getProfile.mockReset();
    profiles.updateProfile.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cache.prepareForUser.mockResolvedValue({ status: 'ready' });
    cache.isEnding.mockReturnValue(false);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('shows a change once the server has accepted it', async () => {
    profiles.getProfile.mockResolvedValueOnce(readable());
    const renderer = await signIn();
    const write = deferred<void>();
    profiles.updateProfile.mockReturnValueOnce({ acknowledged: write.promise });
    profiles.getProfile.mockResolvedValueOnce({ ...readable(), data: { displayName: 'Alice', avatar: photo } });

    let saving!: Promise<void>;
    await act(async () => { saving = observed.updateProfile({ avatar: photo }); });
    expect(profiles.updateProfile).toHaveBeenCalledWith({ avatar: photo });
    expect(observed.profile).toEqual({ displayName: 'Alice' });

    await act(async () => { write.resolve(); await saving; });
    expect(observed.profile).toEqual({ displayName: 'Alice', avatar: photo });
    renderer.unmount();
  });

  it('rejects a refused change and keeps the profile as it was', async () => {
    profiles.getProfile.mockResolvedValueOnce(readable());
    const renderer = await signIn();
    const refused = Promise.reject(denied());
    refused.catch(() => undefined);
    profiles.updateProfile.mockReturnValueOnce({ acknowledged: refused });

    await act(async () => { await expect(observed.updateProfile({ avatar: photo })).rejects.toMatchObject({ code: 'permission-denied' }); });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    expect(observed.profile).toEqual({ displayName: 'Alice' });
    renderer.unmount();
  });

  it('does not apply a change to an account that signed out while it was saving', async () => {
    profiles.getProfile.mockResolvedValueOnce(readable());
    const renderer = await signIn();
    const write = deferred<void>();
    profiles.updateProfile.mockReturnValueOnce({ acknowledged: write.promise });
    let saving!: Promise<void>;
    await act(async () => { saving = observed.updateProfile({ avatar: photo }); });

    firebaseAuth.currentUser = null;
    await act(async () => { await firebaseAuth.callback!(null); });
    await act(async () => { write.resolve(); await saving; });
    expect(profiles.getProfile).toHaveBeenCalledTimes(1);
    expect(observed.profile).toBeNull();
    renderer.unmount();
  });

  it('refuses a change while no one is signed in', async () => {
    const renderer = await render();
    await act(async () => { await expect(observed.updateProfile({ avatar: photo })).rejects.toThrow('Sign in'); });
    expect(profiles.updateProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
