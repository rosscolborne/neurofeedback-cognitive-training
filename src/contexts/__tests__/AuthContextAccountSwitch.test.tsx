import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  signIn: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn() }));
// The cache lifecycle has its own tests (firestoreCacheLifecycle.test.ts and
// AuthContextCache.test.tsx); here it always reports the cache ready.
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

vi.mock('../../services/firebase', () => ({ auth: { currentUser: { uid: 'real-user' } }, db: {}, firestoreCache: cache }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signInWithEmailAndPassword: firebaseAuth.signIn, createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(),
  sendPasswordResetEmail: firebaseAuth.sendPasswordResetEmail,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: firestore.getDoc, setDoc: firestore.setDoc,
}));

import { AuthProvider, useAuth } from '../AuthContext';
import { auth as configuredAuth } from '../../services/firebase';
let observedAuth: ReturnType<typeof useAuth>;
const AuthProbe = ({ onValue }: { onValue: (value: ReturnType<typeof useAuth>) => void }) => {
  const value = useAuth();
  React.useEffect(() => onValue(value), [onValue, value]);
  return <div>{value.user?.uid ?? 'signed-out'}</div>;
};

const observeAuth = (value: ReturnType<typeof useAuth>) => { observedAuth = value; };

async function mountProvider(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<AuthProvider><AuthProbe onValue={observeAuth} /></AuthProvider>); });
  return renderer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Account switches, sign-out and password reset: a late answer for one account
// never lands on another, and the auth observer owns role hydration.
describe('mounted AuthProvider account transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.signIn.mockResolvedValue({ user: { uid: 'signed-in-user' } });
    cache.prepareForUser.mockResolvedValue({ status: 'ready' });
    cache.hasUnsyncedWrites.mockResolvedValue(false);
    cache.endSession.mockResolvedValue(undefined);
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'clinician' }) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps a late account-A role lookup from overwriting account B', async () => {
    const accountARole = deferred<{ exists: () => boolean; data: () => { role: string } }>();
    firestore.getDoc
      .mockImplementationOnce(() => accountARole.promise)
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ role: 'patient' }) });
    const renderer = await mountProvider();

    let accountA!: Promise<void>;
    await act(async () => {
      accountA = firebaseAuth.callback?.({ uid: 'account-a', email: 'a@example.com' }) ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await firebaseAuth.callback?.({ uid: 'account-b', email: 'b@example.com' });
    });
    expect(observedAuth.user?.uid).toBe('account-b');
    expect(observedAuth.role).toBe('patient');

    await act(async () => {
      accountARole.resolve({ exists: () => true, data: () => ({ role: 'clinician' }) });
      await accountA;
    });
    expect(observedAuth.user?.uid).toBe('account-b');
    expect(observedAuth.role).toBe('patient');
    renderer.unmount();
  });

  it('keeps a late role lookup from reviving state after sign-out', async () => {
    const staleRole = deferred<{ exists: () => boolean; data: () => { role: string } }>();
    firestore.getDoc.mockImplementationOnce(() => staleRole.promise);
    const renderer = await mountProvider();

    let pending!: Promise<void>;
    await act(async () => {
      pending = firebaseAuth.callback?.({ uid: 'account-a', email: 'a@example.com' }) ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await firebaseAuth.callback?.(null); });
    staleRole.resolve({ exists: () => true, data: () => ({ role: 'clinician' }) });
    await act(async () => { await pending; });

    expect(observedAuth.user).toBeNull();
    expect(observedAuth.role).toBeNull();
    renderer.unmount();
  });

  it('lets the auth observer own role hydration after login', async () => {
    const renderer = await mountProvider();
    await act(async () => { await observedAuth.login('new@example.com', 'password'); });

    expect(firebaseAuth.signIn).toHaveBeenCalledOnce();
    expect(firestore.getDoc).not.toHaveBeenCalled();

    await act(async () => {
      await firebaseAuth.callback?.({ uid: 'signed-in-user', email: 'new@example.com' });
    });
    expect(firestore.getDoc).toHaveBeenCalledOnce();
    expect(observedAuth.role).toBe('clinician');
    renderer.unmount();
  });

  it('requests a reset from Firebase Auth with a trimmed address and no account transition', async () => {
    firebaseAuth.sendPasswordResetEmail.mockResolvedValueOnce(undefined);
    const renderer = await mountProvider();
    await act(async () => { await observedAuth.requestPasswordReset(' person@example.test '); });

    expect(firebaseAuth.sendPasswordResetEmail).toHaveBeenCalledOnce();
    expect(firebaseAuth.sendPasswordResetEmail.mock.calls[0][0]).toBe(configuredAuth);
    expect(firebaseAuth.sendPasswordResetEmail.mock.calls[0][1]).toBe('person@example.test');
    expect(firebaseAuth.signIn).not.toHaveBeenCalled();
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(observedAuth.user).toBeNull();
    renderer.unmount();
  });

  it('passes a reset failure to the login form without changing auth state', async () => {
    const failure = { code: 'auth/network-request-failed' };
    firebaseAuth.sendPasswordResetEmail.mockRejectedValueOnce(failure);
    const renderer = await mountProvider();
    await expect(observedAuth.requestPasswordReset('person@example.test')).rejects.toBe(failure);
    expect(firebaseAuth.signIn).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(observedAuth.user).toBeNull();
    renderer.unmount();
  });
});
