import { describe, expect, it } from 'vitest';
import { EMULATOR_PROJECT_ID, FirebaseConfigError, UNIT_TEST_PROJECT_ID, resolveFirebaseConfig } from '../firebaseConfig';

const nfct = {
  VITE_FIREBASE_API_KEY: 'nfct-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'nfct-dev.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'nfct-dev',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
};

describe('resolveFirebaseConfig', () => {
  it('uses a complete explicit configuration', () => {
    expect(resolveFirebaseConfig({ ...nfct, MODE: 'production' })).toMatchObject({ projectId: 'nfct-dev', apiKey: 'nfct-key' });
  });

  it('has no default project outside tests', () => {
    for (const MODE of ['development', 'production']) {
      expect(() => resolveFirebaseConfig({ MODE })).toThrow(FirebaseConfigError);
      expect(() => resolveFirebaseConfig({ MODE, VITE_FIREBASE_PROJECT_ID: 'nfct-dev' })).toThrow(/missing apiKey, authDomain, appId/);
    }
  });

  it('gives unit tests an inert demo project', () => {
    expect(resolveFirebaseConfig({ MODE: 'test' }).projectId).toBe(UNIT_TEST_PROJECT_ID);
  });

  it('refuses the clinical project even when fully configured or in tests', () => {
    const clinical = { ...nfct, VITE_FIREBASE_PROJECT_ID: 'brainwell-327dc' };
    for (const MODE of ['development', 'production', 'test']) {
      expect(() => resolveFirebaseConfig({ ...clinical, MODE })).toThrow(/Waveable clinical project/);
    }
    expect(() => resolveFirebaseConfig({ ...nfct, VITE_FIREBASE_MESSAGING_SENDER_ID: '814671644395', MODE: 'test' })).toThrow(/Waveable clinical project/);
    expect(() => resolveFirebaseConfig({ ...nfct, VITE_FIREBASE_AUTH_DOMAIN: 'brainwell-327dc.firebaseapp.com', MODE: 'test' })).toThrow(/Waveable clinical project/);
  });

  it('allows emulator mode only for the local demo project in a dev server', () => {
    expect(resolveFirebaseConfig({ VITE_E2E_EMULATORS: 'true', DEV: true, VITE_FIREBASE_PROJECT_ID: EMULATOR_PROJECT_ID }).projectId).toBe(EMULATOR_PROJECT_ID);
    expect(() => resolveFirebaseConfig({ VITE_E2E_EMULATORS: 'true', DEV: true, VITE_FIREBASE_PROJECT_ID: 'nfct-dev' })).toThrow(/local demo project/);
    expect(() => resolveFirebaseConfig({ VITE_E2E_EMULATORS: 'true', DEV: false, VITE_FIREBASE_PROJECT_ID: EMULATOR_PROJECT_ID })).toThrow(/local demo project/);
  });
});
