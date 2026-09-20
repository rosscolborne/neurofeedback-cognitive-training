import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const e2eEnvFile = resolve('.env.e2e');
if (existsSync(e2eEnvFile)) {
    process.loadEnvFile(e2eEnvFile);
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

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
            testIgnore: /auth\.setup\.ts/,
        },
        {
            name: 'auth-patient',
            testMatch: /auth\.setup\.ts/,
            grep: /patient authentication/,
            use: {
                trace: 'off',
                screenshot: 'off',
                video: 'off',
            },
        },
        {
            name: 'auth-clinician',
            testMatch: /auth\.setup\.ts/,
            grep: /clinician authentication/,
            use: {
                trace: 'off',
                screenshot: 'off',
                video: 'off',
            },
        },
        {
            name: 'patient',
            testIgnore: /auth\.setup\.ts/,
            dependencies: ['auth-patient'],
            use: {
                storageState: 'e2e/.auth/patient.json',
            },
        },
        {
            name: 'clinician',
            testIgnore: /auth\.setup\.ts/,
            dependencies: ['auth-clinician'],
            use: {
                storageState: 'e2e/.auth/clinician.json',
            },
        },
    ],
});
