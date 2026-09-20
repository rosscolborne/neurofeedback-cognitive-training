import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn() }));

vi.mock('../../services/firebase', () => ({ auth: { currentUser: { uid: 'real-user' } }, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signOut: firebaseAuth.signOut,
  signInWithEmailAndPassword: firebaseAuth.signIn, createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: firestore.getDoc, setDoc: firestore.setDoc,
}));

import { AuthProvider, useAuth } from '../AuthContext';
import {
  DEMO_AUTH_STORAGE_KEY,
  deactivateClinicianDemoWorkspace,
  isClinicianDemoWorkspace,
} from '../../services/clinicianDemoBoundary';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};

let observedAuth: ReturnType<typeof useAuth>;
const AuthProbe = ({ onValue }: { onValue: (value: ReturnType<typeof useAuth>) => void }) => {
  const value = useAuth();
  React.useEffect(() => onValue(value), [onValue, value]);
  return <div data-demo={value.isDemoWorkspace ? 'yes' : 'no'}>{value.user?.uid ?? 'signed-out'}</div>;
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

describe('mounted AuthProvider clinician demo lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.signOut.mockResolvedValue(undefined);
    firebaseAuth.signIn.mockResolvedValue({ user: { uid: 'signed-in-user' } });
    deactivateClinicianDemoWorkspace();
    vi.stubGlobal('localStorage', memoryStorage());
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'clinician' }) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    deactivateClinicianDemoWorkspace();
    vi.unstubAllGlobals();
  });

  it('restores a production account normally when no demo request is present', async () => {
    const renderer = await mountProvider();
    await act(async () => { await firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' }); });
    expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(observedAuth.isDemoWorkspace).toBe(false);
    expect(observedAuth.user?.uid).toBe('real-user');
    renderer.unmount();
  });

  it('awaits Firebase sign-out before granting demo repository authority', async () => {
    let resolveSignOut!: () => void;
    firebaseAuth.signOut.mockReturnValue(new Promise<void>((resolve) => { resolveSignOut = resolve; }));
    const renderer = await mountProvider();
    await act(async () => { await firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' }); });

    let entering!: Promise<void>;
    act(() => { entering = observedAuth.loginAsDemoClinician(); });
    expect(firebaseAuth.signOut).toHaveBeenCalledOnce();
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(localStorage.getItem(DEMO_AUTH_STORAGE_KEY)).toBeNull();

    await act(async () => { resolveSignOut(); await entering; });
    expect(isClinicianDemoWorkspace()).toBe(true);
    expect(observedAuth.isDemoWorkspace).toBe(true);
    expect(observedAuth.user?.uid).toBe('demo-clinician');
    renderer.unmount();
  });

  it('treats a stored marker only as a restore request and severs a Firebase session first', async () => {
    localStorage.setItem(DEMO_AUTH_STORAGE_KEY, 'clinician');
    let resolveSignOut!: () => void;
    firebaseAuth.signOut.mockReturnValue(new Promise<void>((resolve) => { resolveSignOut = resolve; }));
    const renderer = await mountProvider();

    let restoring!: Promise<void>;
    act(() => { restoring = firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' }) ?? Promise.resolve(); });
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(observedAuth.user).toBeNull();
    await act(async () => { resolveSignOut(); await restoring; });
    expect(isClinicianDemoWorkspace()).toBe(true);
    expect(observedAuth.isDemoWorkspace).toBe(true);
    renderer.unmount();
  });

  it('still enters demo when marker persistence is blocked and leaves authority coherent', async () => {
    const denied = () => { throw new DOMException('Blocked', 'SecurityError'); };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied });
    const renderer = await mountProvider();
    await act(async () => { await observedAuth.loginAsDemoClinician(); });
    expect(isClinicianDemoWorkspace()).toBe(true);
    expect(observedAuth.isDemoWorkspace).toBe(true);
    expect(observedAuth.user?.uid).toBe('demo-clinician');
    renderer.unmount();
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
    expect(observedAuth.isDemoWorkspace).toBe(false);
    renderer.unmount();
  });

  it('keeps a late production role lookup from replacing a clinician demo transition', async () => {
    const staleRole = deferred<{ exists: () => boolean; data: () => { role: string } }>();
    firestore.getDoc.mockImplementationOnce(() => staleRole.promise);
    const renderer = await mountProvider();

    let pending!: Promise<void>;
    await act(async () => {
      pending = firebaseAuth.callback?.({ uid: 'account-a', email: 'a@example.com' }) ?? Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await observedAuth.loginAsDemoClinician(); });
    staleRole.resolve({ exists: () => true, data: () => ({ role: 'patient' }) });
    await act(async () => { await pending; });

    expect(observedAuth.user?.uid).toBe('demo-clinician');
    expect(observedAuth.role).toBe('clinician');
    expect(observedAuth.isDemoWorkspace).toBe(true);
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
});
