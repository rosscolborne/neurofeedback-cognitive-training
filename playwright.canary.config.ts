import { defineConfig } from '@playwright/test';
import { CANARY_BASE_URL, CANARY_PORT, canaryDevice } from './e2e/canary/device';

// The nfct-dev canary (docs/nfct/nfct-dev-canary.md): the only browser test
// that talks to a real Firebase project. One journey, one disposable account,
// one iPhone-sized Chromium profile, no retries. Run it through
// `node scripts/canary/canary.mjs run` (or CI's steps), which creates the
// account's identity file first and cleans up afterwards.
//
// NFCT_CANARY_TARGET:
// - nfct-dev (default): serves the production bundle in dist/, built by
//   `node scripts/canary/canary.mjs build` with nfct-dev's web config.
// - emulators: the same journey against the local Auth and Firestore
//   emulators and the emulator dev server, a deterministic rehearsal that CI
//   runs in the emulators job.
const target = process.env.NFCT_CANARY_TARGET ?? 'nfct-dev';
if (target !== 'nfct-dev' && target !== 'emulators') throw new Error(`Unknown NFCT_CANARY_TARGET '${target}'`);

const server = target === 'nfct-dev'
  ? `vite preview --host 127.0.0.1 --port ${CANARY_PORT} --strictPort`
  : `VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e VITE_FIREBASE_API_KEY=local-test-key vite --host 127.0.0.1 --port ${CANARY_PORT} --strictPort`;

export default defineConfig({
  testDir: './e2e/canary',
  testMatch: /\.canary\.spec\.ts$/,
  outputDir: 'test-results/canary',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 150_000,
  reporter: 'list',
  use: {
    ...canaryDevice,
    baseURL: CANARY_BASE_URL,
    browserName: 'chromium',
    launchOptions: { executablePath: '/usr/bin/google-chrome' },
    // A trace would record the typed password and the requests' ID tokens;
    // the artifacts of this public repository are readable by anyone.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: server,
    url: CANARY_BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
