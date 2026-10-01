import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, getAuth, connectAuthEmulator, signOut } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  connectFirestoreEmulator,
  clearIndexedDbPersistence,
  terminate,
  waitForPendingWrites,
  type Firestore,
} from 'firebase/firestore';
import { resolveFirebaseConfig } from './firebaseConfig';
import { appFirestoreSettings } from './firestoreCache';
import { createFirestoreCacheLifecycle } from './firestoreCacheLifecycle';

const firebaseConfig = resolveFirebaseConfig(import.meta.env);

// Initialize Firebase using singleton pattern
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase Authentication with multi-tier persistence for iOS WebKit
let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;

// Initialize Cloud Firestore with the persistent offline cache.
function initializeDb(): Firestore {
  try {
    return initializeFirestore(app, appFirestoreSettings());
  } catch (error) {
    // A hot-module reload re-runs this module after Firestore has started;
    // the running instance already has the persistent cache.
    if ((error as { code?: unknown } | null)?.code === 'failed-precondition') return getFirestore(app);
    throw error;
  }
}

export const db = initializeDb();

// resolveFirebaseConfig has already refused any non-demo project in emulator mode.
if (import.meta.env.VITE_E2E_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * Who the persistent cache belongs to, and clearing it on sign-out, account
 * switch or deletion (see firestoreCacheLifecycle.ts). It starts here, before
 * any other module can use `db`: a cache left by an unfinished cleanup, or
 * with an unknown owner, is deleted first, and the SDK runs every later
 * Firestore operation after that deletion.
 */
export const firestoreCache = createFirestoreCacheLifecycle({
  storage: () => window.localStorage,
  clearPersistence: () => clearIndexedDbPersistence(db),
  terminate: () => terminate(db),
  waitForPendingWrites: () => waitForPendingWrites(db),
  signOut: () => signOut(auth),
  // Always a full page load: nothing of the previous account survives in
  // React state, module singletons or the terminated Firestore instance.
  navigate: (destination) => window.location.assign(destination),
  subscribeToStorageChanges: (listener) => {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage) listener(event.key);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  },
});

firestoreCache.start();
