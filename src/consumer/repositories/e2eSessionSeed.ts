// A fixed session seed for the local-emulator browser suite only, so a
// Playwright run sees the same questions every time and can replay one run
// with and without simulated EEG. It uses the same gate as the emulator
// wiring in src/services/firebaseConfig.ts: an E2E emulator flag, a Vite dev
// server (never a production build, where import.meta.env.DEV is false) and
// the demo emulator project. Anywhere else there is no seed source, and the
// repository draws every seed from crypto.getRandomValues.

import { EMULATOR_PROJECT_ID } from '../../services/firebaseConfig';

/** The emulator project, shared with the emulator wiring so the two gates cannot drift. */
export const E2E_EMULATOR_PROJECT_ID = EMULATOR_PROJECT_ID;
/** The seed every game session gets in the local-emulator browser suite. */
export const E2E_FIXED_SESSION_SEED = 20_260_930;

export interface SeedEnvironment {
  readonly DEV?: boolean;
  readonly VITE_E2E_EMULATORS?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
}

export function e2eSessionSeedSource(env: SeedEnvironment): (() => number) | undefined {
  const isEmulatorE2E = env.VITE_E2E_EMULATORS === 'true'
    && env.DEV === true
    && env.VITE_FIREBASE_PROJECT_ID === E2E_EMULATOR_PROJECT_ID;
  return isEmulatorE2E ? () => E2E_FIXED_SESSION_SEED : undefined;
}
