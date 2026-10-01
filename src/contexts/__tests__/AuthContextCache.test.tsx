import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CachePreparation } from '../../services/firestoreCacheLifecycle';

// AuthContext publishes an account, and reads Firestore for it, only once the
// persistent cache is that account's own or empty (firestoreCacheLifecycle).

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  signOut: vi.fn(),
  createUser: vi.fn(),
  currentUser: null as null | { uid: string },
}));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn() }));
const cache = vi.hoisted(() => ({
  prepareForUser: vi.fn(),
  isEnding: vi.fn(() => false),
  hasUnsyncedWrites: vi.fn(),
  endSession: vi.fn(),
  subscribe: () => () => {},
  getStatus: () => 'idle',
}));

vi.mock('../../services/firebase', () => ({
  auth: { get currentUser() { return firebaseAuth.currentUser; } },
  db: {},
  firestoreCache: cache,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signOut: firebaseAuth.signOut,
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: firebaseAuth.createUser,
  updateProfile: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: firestore.getDoc,
  setDoc: firestore.setDoc,
}));

import { AuthProvider, useAuth } from '../AuthContext';
import { deactivateClinicianDemoWorkspace, isClinicianDemoWorkspace } from '../../services/clinicianDemoBoundary';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};

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
    deactivateClinicianDemoWorkspace();
    vi.stubGlobal('localStorage', memoryStorage());
    firebaseAuth.currentUser = null;
    firebaseAuth.signOut.mockResolvedValue(undefined);
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'patient' }) });
    firestore.setDoc.mockResolvedValue(undefined);
    cache.prepareForUser.mockResolvedValue(ready);
    cache.isEnding.mockReturnValue(false);
    cache.hasUnsyncedWrites.mockResolvedValue(false);
    cache.endSession.mockResolvedValue(undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    deactivateClinicianDemoWorkspace();
    vi.unstubAllGlobals();
  });

  it('publishes a signed-in account, and reads its role, only once the cache is ready for it', async () => {
    const preparation = deferred<CachePreparation>();
    cache.prepareForUser.mockReturnValueOnce(preparation.promise);
    const renderer = await mount();

    let event!: Promise<void>;
    await act(async () => { event = firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });
    expect(cache.prepareForUser).toHaveBeenCalledWith('bob');
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    expect(firestore.getDoc).not.toHaveBeenCalled();

    await act(async () => { preparation.resolve(ready); await event; });
    expect(firestore.getDoc).toHaveBeenCalledOnce();
    expect(observed.user?.uid).toBe('bob');
    expect(observed.role).toBe('patient');
    renderer.unmount();
  });

  it('hides the previous account at once when the account changes, before the cache is prepared', async () => {
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
    expect(observed.user?.uid).toBe('alice');

    cache.prepareForUser.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => { void firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });
    expect(observed.user).toBeNull();
    expect(observed.role).toBeNull();
    expect(observed.loading).toBe(true);
    renderer.unmount();
  });

  it.each(['reloading', 'signing-out', 'failed'] as const)('stays on the loading screen, reading nothing, when preparation is %s', async (status) => {
    cache.prepareForUser.mockResolvedValueOnce({ status });
    const renderer = await mount();
    await act(async () => { await firebaseAuth.callback!({ uid: 'bob', email: 'bob@example.com' }); });

    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(true);
    expect(firestore.getDoc).not.toHaveBeenCalled();
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

  it('sign-up writes the new profile only once the cache is ready for the new account', async () => {
    const preparation = deferred<CachePreparation>();
    cache.prepareForUser.mockReturnValueOnce(preparation.promise);
    firebaseAuth.createUser.mockResolvedValue({ user: { uid: 'new-user', email: 'new@example.com' } });
    const renderer = await mount();

    let signingUp!: Promise<void>;
    await act(async () => { signingUp = observed.signup('new@example.com', 'password'); });
    expect(cache.prepareForUser).toHaveBeenCalledWith('new-user');
    expect(firestore.setDoc).not.toHaveBeenCalled();

    await act(async () => { preparation.resolve(ready); await signingUp; });
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('entering the demo workspace clears a signed-out account\'s cache first', async () => {
    const renderer = await mount();
    const order: string[] = [];
    firebaseAuth.signOut.mockImplementation(async () => { order.push('signOut'); });
    cache.prepareForUser.mockImplementation(async (uid: string | null) => { order.push(`prepare:${uid}`); return ready; });

    await act(async () => { await observed.loginAsDemoClinician(); });
    expect(order).toEqual(['signOut', 'prepare:null']);
    expect(isClinicianDemoWorkspace()).toBe(true);
    renderer.unmount();
  });

  it('does not enter the demo workspace while the page reloads for a cache cleanup', async () => {
    const renderer = await mount();
    cache.prepareForUser.mockResolvedValueOnce({ status: 'reloading' });

    await act(async () => { await observed.loginAsDemoClinician(); });
    expect(isClinicianDemoWorkspace()).toBe(false);
    renderer.unmount();
  });
});
