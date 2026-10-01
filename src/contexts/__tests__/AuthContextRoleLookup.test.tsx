import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NFCT-44: a slow or failed read of users/{uid} must never count as "no role"
// (which routes a signed-in user to role selection). Only a server-confirmed
// read showing no role does; otherwise the app keeps loading and, after an
// error or ROLE_LOOKUP_RETRY_AFTER_MS, offers a retry.

const firebaseAuth = vi.hoisted(() => ({ callback: null as null | ((user: unknown) => Promise<void>) }));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn() }));
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

vi.mock('../../services/firebase', () => ({ auth: { currentUser: null }, db: {}, firestoreCache: cache }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signOut: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: firestore.getDoc,
  setDoc: firestore.setDoc,
}));

import { AuthProvider, ROLE_LOOKUP_RETRY_AFTER_MS, useAuth } from '../AuthContext';
import { deactivateClinicianDemoWorkspace } from '../../services/clinicianDemoBoundary';

type Snapshot = { exists: () => boolean; data: () => Record<string, unknown> | undefined; metadata: { fromCache: boolean } };
const snapshot = (data: Record<string, unknown> | undefined, { fromCache = false } = {}): Snapshot => ({
  exists: () => data !== undefined,
  data: () => data,
  metadata: { fromCache },
});
const unavailable = () => Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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

async function signIn(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthProvider><Probe /></AuthProvider>); });
  await act(async () => { void firebaseAuth.callback!({ uid: 'alice', email: 'alice@example.com' }); });
  return renderer;
}

/** The role is unknown: App keeps the loading screen, so role selection is unreachable. */
function expectRoleUnknown() {
  expect(observed.user?.uid).toBe('alice');
  expect(observed.role).toBeNull();
  expect(observed.loading).toBe(true);
}

describe('AuthContext role lookup (NFCT-44)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    deactivateClinicianDemoWorkspace();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    cache.prepareForUser.mockResolvedValue({ status: 'ready' });
    cache.isEnding.mockReturnValue(false);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    deactivateClinicianDemoWorkspace();
  });

  it('keeps loading while the read is slow, offers a retry after the bound, and still opens on a late answer', async () => {
    const read = deferred<Snapshot>();
    firestore.getDoc.mockReturnValueOnce(read.promise);
    const renderer = await signIn();

    // Far past the old 1.8 s cut-off: still loading, not "no role".
    await act(async () => { await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_RETRY_AFTER_MS - 1); });
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(true);

    await act(async () => { read.resolve(snapshot({ role: 'patient' })); });
    expect(observed.role).toBe('patient');
    expect(observed.loading).toBe(false);
    expect(observed.roleLookupFailed).toBe(false);
    renderer.unmount();
  });

  it('treats a failed read (offline with nothing cached) as unknown, and a retry that succeeds opens the app', async () => {
    firestore.getDoc.mockRejectedValueOnce(unavailable());
    const renderer = await signIn();
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(true);

    const retry = deferred<Snapshot>();
    firestore.getDoc.mockReturnValueOnce(retry.promise);
    await act(async () => { observed.retryRoleLookup(); });
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(false);

    await act(async () => { retry.resolve(snapshot({ role: 'clinician' })); });
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
    expect(observed.role).toBe('clinician');
    expect(observed.loading).toBe(false);
    renderer.unmount();
  });

  it('does not take "no role" from the device cache alone', async () => {
    firestore.getDoc.mockResolvedValueOnce(snapshot({ role: null }, { fromCache: true }));
    const renderer = await signIn();
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(true);
    renderer.unmount();
  });

  it('opens offline with the role from the device cache', async () => {
    firestore.getDoc.mockResolvedValueOnce(snapshot({ role: 'patient' }, { fromCache: true }));
    const renderer = await signIn();
    expect(observed.role).toBe('patient');
    expect(observed.loading).toBe(false);
    expect(observed.roleLookupFailed).toBe(false);
    renderer.unmount();
  });

  it.each([
    ['the profile has no role', { email: 'alice@example.com', role: null }],
    ['the profile does not exist yet', undefined],
  ])('finishes loading with no role (role selection) when the server confirms %s', async (_case, data) => {
    firestore.getDoc.mockResolvedValueOnce(snapshot(data));
    const renderer = await signIn();
    expect(observed.user?.uid).toBe('alice');
    expect(observed.role).toBeNull();
    expect(observed.loading).toBe(false);
    expect(observed.roleLookupFailed).toBe(false);

    // A genuine "no role" is final: no retry is offered later.
    await act(async () => { await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_RETRY_AFTER_MS * 2); });
    expect(observed.roleLookupFailed).toBe(false);
    renderer.unmount();
  });

  it('ignores a superseded read once a retry has started', async () => {
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    firestore.getDoc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const renderer = await signIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_RETRY_AFTER_MS); });
    expect(observed.roleLookupFailed).toBe(true);

    await act(async () => { observed.retryRoleLookup(); });
    await act(async () => { first.reject(unavailable()); });
    expectRoleUnknown();
    expect(observed.roleLookupFailed).toBe(false);

    await act(async () => { second.resolve(snapshot({ role: 'patient' })); });
    expect(observed.role).toBe('patient');
    expect(observed.loading).toBe(false);
    renderer.unmount();
  });

  it('drops a failed lookup when the account signs out meanwhile', async () => {
    const read = deferred<Snapshot>();
    firestore.getDoc.mockReturnValueOnce(read.promise);
    const renderer = await signIn();

    await act(async () => { await firebaseAuth.callback!(null); });
    await act(async () => { read.reject(unavailable()); await vi.advanceTimersByTimeAsync(ROLE_LOOKUP_RETRY_AFTER_MS); });
    expect(observed.user).toBeNull();
    expect(observed.loading).toBe(false);
    expect(observed.roleLookupFailed).toBe(false);
    renderer.unmount();
  });
});
