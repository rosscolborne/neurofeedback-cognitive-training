import type { FirebaseOptions } from 'firebase/app';

/**
 * Firebase configuration for this app. There is deliberately no default
 * project: a build or dev server without explicit VITE_FIREBASE_* settings
 * must fail instead of silently talking to someone else's Firebase project.
 */

export const EMULATOR_PROJECT_ID = 'demo-neurasticity-protocol-e2e';
/** Inert config for unit tests (Vitest sets MODE=test). Never contacted. */
export const UNIT_TEST_PROJECT_ID = 'demo-nfct-unit';

// Identifiers of the Waveable clinical product's Firebase project. This app must
// never run against it, even if its config is pasted into a local .env file.
// scripts/check-clinical-isolation.mjs allowlists this file for these literals.
const CLINICAL_PROJECT_IDS = ['brainwell-327dc'];
const CLINICAL_SENDER_IDS = ['814671644395'];

type FirebaseEnv = Partial<Record<string, string | boolean | undefined>>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirebaseConfigError';
  }
}

function assertNotClinical(config: FirebaseOptions): void {
  const projectId = config.projectId ?? '';
  const matches = CLINICAL_PROJECT_IDS.some((id) =>
    projectId === id || (config.authDomain ?? '').startsWith(`${id}.`) || (config.storageBucket ?? '').startsWith(`${id}.`))
    || CLINICAL_SENDER_IDS.includes(config.messagingSenderId ?? '');
  if (matches) {
    throw new FirebaseConfigError('Refusing to start: the Firebase settings point at the Waveable clinical project. Use the NFCT project or the local emulators.');
  }
}

export function resolveFirebaseConfig(env: FirebaseEnv): FirebaseOptions {
  if (text(env.VITE_E2E_EMULATORS) === 'true') {
    // The local E2E suite must never fall through to a real project if an
    // emulator fails to start or its env is misconfigured.
    if (env.DEV !== true || text(env.VITE_FIREBASE_PROJECT_ID) !== EMULATOR_PROJECT_ID) {
      throw new FirebaseConfigError('Protocol E2E emulators require the local demo project.');
    }
    return {
      apiKey: text(env.VITE_FIREBASE_API_KEY) || 'local-test-key',
      authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
    };
  }

  const config: FirebaseOptions = {
    apiKey: text(env.VITE_FIREBASE_API_KEY),
    authDomain: text(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: text(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: text(env.VITE_FIREBASE_STORAGE_BUCKET) || undefined,
    messagingSenderId: text(env.VITE_FIREBASE_MESSAGING_SENDER_ID) || undefined,
    appId: text(env.VITE_FIREBASE_APP_ID),
  };
  assertNotClinical(config);

  const missing = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter((key) => !config[key]);
  if (missing.length === 0) return config;

  if (env.MODE === 'test') {
    return {
      apiKey: 'demo-nfct-unit-key',
      authDomain: `${UNIT_TEST_PROJECT_ID}.firebaseapp.com`,
      projectId: UNIT_TEST_PROJECT_ID,
      appId: '1:000000000000:web:0000000000000000',
    };
  }
  throw new FirebaseConfigError(
    `Firebase is not configured (missing ${missing.join(', ')}). Set the VITE_FIREBASE_* values for the NFCT project in .env.local (see .env.example), or run against the local emulators. There is no default project.`,
  );
}
