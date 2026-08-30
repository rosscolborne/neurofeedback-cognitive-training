import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyC1dgTlWEo6ZRdz1XGQqzPN0FNFDGyd1rw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'brainwell-327dc.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'brainwell-327dc',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'brainwell-327dc.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '814671644395',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:814671644395:ios:77b594b07593c2eaa1a0ae',
};

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

// Initialize Cloud Firestore
export const db = getFirestore(app);
