import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachePreparation } from '../../services/firestoreCacheLifecycle';

// AuthContext publishes an account, and reads Firestore for it, only once the
// persistent cache is that account's own or empty (firestoreCacheLifecycle).

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  createUser: vi.fn(),
  currentUser: null as null | { uid: string; email?: string },
}));
const profiles = vi.hoisted(() => ({ getProfile: vi.fn(), createProfile: vi.fn() }));
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
  createUserWithEmailAndPassword: firebaseAuth.createUser,
  sendPasswordResetEmail: vi.fn(),
}));

import { AuthProvider, useAuth } from '../AuthContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let observed: ReturnType<typeof useAuth>;
const Probe = () => {
  const value = useAuth();
  React.useEffect(() => { observed = value; });
  return null;
};

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthProvider><Probe /></AuthProvider>); });
  return renderer;
}

const ready: CachePreparation = { status: 'ready' };

describe('AuthContext and the Firestore cache lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.currentUser = null;
    profiles.getProfile.mockReset();
    profiles.getProfile.mockResolvedValue({ status: 'readable', id: 'bob', data: { displayName: 'Bob' }, fromCache: false, hasPendingWrites: false });
    profiles.createProfile.mockReturnValue({ acknowledged: Promise.resolve() });
    cache.prepareForUser.mockResolvedValue(ready);
    cache.isEnding.mockReturnValue(false);
    cache.hasUnsyncedWrites.mockResolvedValue(false);
    cache.endSession.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('publishes a signed-in account, and reads its profile, only once the cache is ready for it', async () => {
    const preparation = deferred<CachePreparation>();
    cache.prepareForUser.mockReturnValueOnce(preparation.promise);
    const renderer = await mount();

    let event!: Promise<void>;
    await act(async () => { event = firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });
    expect(cache.prepareForUser).toHaveBeenCalledWith('bob');
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    expect(profiles.getProfile).not.toHaveBeenCalled();

    await act(async () => { preparation.resolve(ready); await event; });
    expect(profiles.getProfile).toHaveBeenCalledOnce();
    expect(observed.user?.uid).toBe('bob');
    expect(observed.profile).toEqual({ displayName: 'Bob' });
    renderer.unmount();
  });

  it('hides the previous account at once when the account changes, before the cache is prepared', async () => {
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
    expect(observed.user?.uid).toBe('alice');

    cache.prepareForUser.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => { void firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });
    expect(observed.user).toBeNull();
    expect(observed.profile).toBeNull();
    expect(observed.loading).toBe(true);
    renderer.unmount();
  });

  it.each(['reloading', 'signing-out', 'failed'] as const)('stays on the loading screen, reading nothing, when preparation is %s', async (status) => {
    cache.prepareForUser.mockResolvedValueOnce({ status });
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });

    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    expect(profiles.getProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('leaves auth events to a sign-out or account deletion that is ending the session', async () => {
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
    cache.prepareForUser.mockClear();

    cache.isEnding.mockReturnValue(true);
    await act(async () => { await firebaseAuth.callback!(null); });
    expect(cache.prepareForUser).not.toHaveBeenCalled();
    expect(observed.user?.uid).toBe('alice');
    renderer.unmount();
  });

  it('logout reports unsynced writes and changes nothing until the user decides', async () => {
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
    firebaseAuth.currentUser = { uid: 'alice' };
    cache.hasUnsyncedWrites.mockResolvedValueOnce(true);

    let outcome: unknown;
    await act(async () => { outcome = await observed.logout(); });
    expect(outcome).toBe('unsynced');
    expect(cache.endSession).not.toHaveBeenCalled();
    expect(observed.user?.uid).toBe('alice');

    await act(async () => { outcome = await observed.logout({ discardUnsyncedWrites: true }); });
    expect(outcome).toBe('signed-out');
    expect(cache.hasUnsyncedWrites).toHaveBeenCalledOnce();
    expect(cache.endSession).toHaveBeenCalledWith({ reason: 'sign-out', signOut: true, destination: '/' });
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    renderer.unmount();
  });

  it('logout with everything uploaded signs out and clears the cache', async () => {
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
    firebaseAuth.currentUser = { uid: 'alice' };

    await act(async () => { await observed.logout(); });
    expect(cache.hasUnsyncedWrites).toHaveBeenCalledOnce();
    expect(cache.endSession).toHaveBeenCalledWith({ reason: 'sign-out', signOut: true, destination: '/' });
    renderer.unmount();
  });

  it('signs out without Firestore while the cache is held up, hiding the account first', async () => {
    cache.signOutWithoutFirestore.mockResolvedValue(undefined);
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });

    await act(async () => { await observed.signOutWithoutFirestore(); });
    expect(cache.signOutWithoutFirestore).toHaveBeenCalledOnce();
    expect(cache.hasUnsyncedWrites).not.toHaveBeenCalled();
    expect(cache.endSession).not.toHaveBeenCalled();
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    renderer.unmount();
  });

  it('sign-up creates the new profile only once the cache is ready for the new account', async () => {
    const preparation = deferred<CachePreparation>();
    cache.prepareForUser.mockReturnValueOnce(preparation.promise);
    profiles.getProfile
      .mockResolvedValueOnce({ status: 'missing', id: 'new-user', fromCache: false, hasPendingWrites: false })
      .mockResolvedValueOnce({ status: 'readable', id: 'new-user', data: { displayName: 'New Player' }, fromCache: false, hasPendingWrites: false });
    let event!: Promise<void>;
    firebaseAuth.createUser.mockImplementation(async () => {
      const user = { uid: 'new-user', email: 'new@example.com' };
      firebaseAuth.currentUser = user;
      // The SDK notifies auth listeners before the call resolves.
      event = firebaseAuth.callback!(user);
      return { user };
    });
    const renderer = await mount();

    await act(async () => { await observed.signup('new@example.com', 'password', 'New Player'); });
    expect(cache.prepareForUser).toHaveBeenCalledWith('new-user');
    expect(profiles.getProfile).not.toHaveBeenCalled();
    expect(profiles.createProfile).not.toHaveBeenCalled();

    await act(async () => { preparation.resolve(ready); await event; });
    expect(profiles.createProfile).toHaveBeenCalledOnce();
    expect(profiles.createProfile.mock.calls[0][0]).toMatchObject({ displayName: 'New Player' });
    expect(observed.profile).toEqual({ displayName: 'New Player' });
    renderer.unmount();
  });


});
