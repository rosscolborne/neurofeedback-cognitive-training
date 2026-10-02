import { defineConfig } from '@playwright/test';

// Browser checks that need no Firebase project. Anything that signs in runs in
// the emulator-only suite (playwright.protocol.config.ts); the only
// deployed-project test is the nfct-dev canary (playwright.canary.config.ts).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const noCapture = { trace: 'off', screenshot: 'off', video: 'off' } as const;

export default defineConfig({
    testDir: './e2e',

    use: {
        baseURL,

        launchOptions: {
            executablePath: '/usr/bin/google-chrome',
        },

        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },

    projects: [
        {
            name: 'public',
            testMatch: /smoke\.spec\.ts/,
        },
        {
            name: 'messaging',
            testMatch: /messaging\.spec\.ts/,
        },
        {
            name: 'permission-guard',
            testMatch: /permission-error-guard\.spec\.ts/,
            use: noCapture,
        },
    ],
});
