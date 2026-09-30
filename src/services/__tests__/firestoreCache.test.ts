import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline play depends on the app's Firestore being created with the
// persistent multi-tab cache (NFCT-20). IndexedDB persistence itself only runs
// in a browser; these tests pin the configuration and its wiring.

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: vi.fn(() => []),
  getApp: vi.fn(),
  initializeAuth: vi.fn(() => ({ kind: 'auth' })),
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
  initializeFirestore: vi.fn((_app: unknown, _settings: unknown) => ({ kind: 'firestore' }) as unknown),
  getFirestore: vi.fn(() => ({ kind: 'existing-firestore' })),
  connectFirestoreEmulator: vi.fn(),
  persistentLocalCache: vi.fn((settings: unknown) => ({ kind: 'persistent', settings })),
  persistentMultipleTabManager: vi.fn(() => ({ kind: 'PersistentMultipleTab' })),
  persistentSingleTabManager: vi.fn(() => ({ kind: 'persistentSingleTab' })),
  memoryLocalCache: vi.fn(() => ({ kind: 'memory' })),
}));

vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps, getApp: sdk.getApp }));
vi.mock('firebase/auth', () => ({
  initializeAuth: sdk.initializeAuth,
  getAuth: sdk.getAuth,
  connectAuthEmulator: sdk.connectAuthEmulator,
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: sdk.initializeFirestore,
  getFirestore: sdk.getFirestore,
  connectFirestoreEmulator: sdk.connectFirestoreEmulator,
  persistentLocalCache: sdk.persistentLocalCache,
  persistentMultipleTabManager: sdk.persistentMultipleTabManager,
  persistentSingleTabManager: sdk.persistentSingleTabManager,
  memoryLocalCache: sdk.memoryLocalCache,
}));
vi.mock('../firebaseConfig', () => ({ resolveFirebaseConfig: () => ({ projectId: 'demo-nfct-unit' }) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appFirestoreSettings', () => {
  it('uses the persistent local cache with the multiple-tab manager', async () => {
    const { appFirestoreSettings } = await import('../firestoreCache');

    expect(appFirestoreSettings()).toEqual({
      localCache: { kind: 'persistent', settings: { tabManager: { kind: 'PersistentMultipleTab' } } },
    });
    expect(sdk.persistentSingleTabManager).not.toHaveBeenCalled();
    expect(sdk.memoryLocalCache).not.toHaveBeenCalled();
  });
});

describe('app Firestore initialization', () => {
  it('creates Firestore once, with the persistent cache, before anything else uses it', async () => {
    vi.stubEnv('VITE_E2E_EMULATORS', 'false');
    const { db } = await import('../firebase');

    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(1);
    expect(sdk.initializeFirestore.mock.calls[0]?.[1]).toEqual({
      localCache: { kind: 'persistent', settings: { tabManager: { kind: 'PersistentMultipleTab' } } },
    });
    expect(sdk.getFirestore).not.toHaveBeenCalled();
    expect(db).toEqual({ kind: 'firestore' });
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('keeps the local emulator wiring in E2E mode, on the persistent instance', async () => {
    vi.stubEnv('VITE_E2E_EMULATORS', 'true');
    await import('../firebase');

    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith({ kind: 'firestore' }, '127.0.0.1', 8080);
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith({ kind: 'auth' }, 'http://127.0.0.1:9099', { disableWarnings: true });
    expect(sdk.initializeFirestore.mock.invocationCallOrder[0])
      .toBeLessThan(sdk.connectFirestoreEmulator.mock.invocationCallOrder[0] ?? 0);
  });

  it('reuses the running instance when a hot reload initializes it again', async () => {
    sdk.initializeFirestore.mockImplementationOnce(() => {
      throw Object.assign(new Error('initializeFirestore() has already been called with different options.'), { code: 'failed-precondition' });
    });
    const { db } = await import('../firebase');

    expect(db).toEqual({ kind: 'existing-firestore' });
  });

  it('does not hide any other initialization failure', async () => {
    sdk.initializeFirestore.mockImplementationOnce(() => {
      throw Object.assign(new Error('boom'), { code: 'internal' });
    });

    await expect(import('../firebase')).rejects.toThrow('boom');
  });
});
