import { defineConfig } from '@playwright/test';

// Emulator-only. Every signed-in browser test runs here against the local Auth
// and Firestore emulators; the only deployed-project test is the nfct-dev
// canary (playwright.canary.config.ts).
export default defineConfig({
  testDir: './e2e',
  testMatch: /(?:protocol|messaging|persistence|lifecycle|invitation-handoffs|session-handoffs|auth-handoffs|self-directed)\.local\.spec\.ts/,
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5193',
    launchOptions: { executablePath: '/usr/bin/google-chrome' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'VITE_E2E_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-neurasticity-protocol-e2e VITE_FIREBASE_API_KEY=local-test-key vite --host 127.0.0.1 --port 5193 --strictPort',
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
