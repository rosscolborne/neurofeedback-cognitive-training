import { describe, expect, it } from 'vitest';
import composition from '../repositories/index.ts?raw';
import { E2E_EMULATOR_PROJECT_ID, E2E_FIXED_SESSION_SEED, e2eSessionSeedSource } from '../repositories/e2eSessionSeed';

// The fixed seed exists only for the local-emulator browser suite. A
// production build (DEV false) never gets a seed source, whatever its flags,
// so every production seed comes from crypto.getRandomValues.

describe('E2E session seed source', () => {
  it('is absent in production builds and ordinary development', () => {
    expect(e2eSessionSeedSource({ DEV: false })).toBeUndefined();
    expect(e2eSessionSeedSource({ DEV: false, VITE_E2E_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: E2E_EMULATOR_PROJECT_ID })).toBeUndefined();
    expect(e2eSessionSeedSource({ DEV: true })).toBeUndefined();
    expect(e2eSessionSeedSource({ DEV: true, VITE_E2E_EMULATORS: 'false', VITE_FIREBASE_PROJECT_ID: E2E_EMULATOR_PROJECT_ID })).toBeUndefined();
    expect(e2eSessionSeedSource({ DEV: true, VITE_E2E_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'nfct-dev' })).toBeUndefined();
  });

  it('gives the fixed seed only on the E2E emulator dev server', () => {
    const source = e2eSessionSeedSource({ DEV: true, VITE_E2E_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: E2E_EMULATOR_PROJECT_ID });
    expect(source?.()).toBe(E2E_FIXED_SESSION_SEED);
  });

  it('is the only seed source the app composition passes to the repository', () => {
    expect(composition).toContain('seedSource: import.meta.env.DEV ? e2eSessionSeedSource(import.meta.env) : undefined,');
    expect(composition.match(/seedSource/g)).toHaveLength(1);
  });
});
