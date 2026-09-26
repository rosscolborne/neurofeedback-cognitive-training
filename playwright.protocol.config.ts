import { defineConfig } from '@playwright/test';

// Entirely separate from the shared-account E2E projects and .env.e2e.
export default defineConfig({
  testDir: './e2e',
  testMatch: /protocol\.local\.spec\.ts/,
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
