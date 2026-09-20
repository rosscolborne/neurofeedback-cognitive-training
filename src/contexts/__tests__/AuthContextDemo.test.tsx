import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
  callback: null as null | ((user: unknown) => Promise<void>),
  signOut: vi.fn(),
}));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn() }));
const hooks = vi.hoisted(() => {
  let states: unknown[] = [], dependencies: Array<unknown[] | undefined> = [], pending: Array<() => void | (() => void)> = [];
  let stateCursor = 0, effectCursor = 0;
  return {
    reset() { states = []; dependencies = []; pending = []; },
    begin() { stateCursor = 0; effectCursor = 0; },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(states[index]) : next; }];
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = effectCursor++;
      if (!dependencies[index]) { dependencies[index] = deps; pending.push(effect); }
    },
    runEffects() { const work = pending; pending = []; work.forEach((effect) => effect()); },
  };
});

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useState: hooks.useState, useEffect: hooks.useEffect }));
vi.mock('../../services/firebase', () => ({ auth: { currentUser: { uid: 'real-user' } }, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => Promise<void>) => { firebaseAuth.callback = callback; return vi.fn(); },
  signOut: firebaseAuth.signOut,
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: firestore.getDoc, setDoc: firestore.setDoc,
}));

import { AuthProvider } from '../AuthContext';
import {
  DEMO_AUTH_STORAGE_KEY,
  deactivateClinicianDemoWorkspace,
  isClinicianDemoWorkspace,
} from '../../services/clinicianDemoBoundary';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
};

const mountProvider = () => {
  hooks.reset();
  let tree: ReactElement<{ value: Record<string, unknown> }>;
  const render = () => { hooks.begin(); tree = AuthProvider({ children: null }) as ReactElement<{ value: Record<string, unknown> }>; };
  render(); hooks.runEffects();
  return { value: () => tree.props.value, render, async settle() { for (let index = 0; index < 5; index += 1) { await Promise.resolve(); render(); hooks.runEffects(); } } };
};

describe('AuthProvider clinician demo lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deactivateClinicianDemoWorkspace();
    vi.stubGlobal('localStorage', memoryStorage());
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'clinician' }) });
  });

  afterEach(() => {
    deactivateClinicianDemoWorkspace();
    vi.unstubAllGlobals();
  });

  it('restores a production account normally when no demo request is present', async () => {
    const mounted = mountProvider();
    await firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' });
    await mounted.settle();
    expect(firebaseAuth.signOut).not.toHaveBeenCalled();
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(mounted.value().isDemoWorkspace).toBe(false);
    expect((mounted.value().user as { uid: string }).uid).toBe('real-user');
  });

  it('awaits Firebase sign-out before granting demo repository authority', async () => {
    let resolveSignOut!: () => void;
    firebaseAuth.signOut.mockReturnValue(new Promise<void>((resolve) => { resolveSignOut = resolve; }));
    const mounted = mountProvider();
    await firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' });
    await mounted.settle();

    const entering = (mounted.value().loginAsDemoClinician as () => Promise<void>)();
    expect(firebaseAuth.signOut).toHaveBeenCalledOnce();
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(localStorage.getItem(DEMO_AUTH_STORAGE_KEY)).toBeNull();

    resolveSignOut();
    await entering;
    mounted.render();
    expect(isClinicianDemoWorkspace()).toBe(true);
    expect(mounted.value().isDemoWorkspace).toBe(true);
    expect((mounted.value().user as { uid: string }).uid).toBe('demo-clinician');
  });

  it('treats a stored marker only as a restore request and severs a restored Firebase session first', async () => {
    localStorage.setItem(DEMO_AUTH_STORAGE_KEY, 'clinician');
    let resolveSignOut!: () => void;
    firebaseAuth.signOut.mockReturnValue(new Promise<void>((resolve) => { resolveSignOut = resolve; }));
    const mounted = mountProvider();

    const restoring = firebaseAuth.callback?.({ uid: 'real-user', email: 'real@example.com' });
    expect(isClinicianDemoWorkspace()).toBe(false);
    expect(mounted.value().user).toBeNull();
    resolveSignOut();
    await restoring;
    mounted.render();
    expect(isClinicianDemoWorkspace()).toBe(true);
    expect(mounted.value().isDemoWorkspace).toBe(true);
  });
});
