import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { resolveFirebaseConfig } from './firebaseConfig';
import { appFirestoreSettings } from './firestoreCache';

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
