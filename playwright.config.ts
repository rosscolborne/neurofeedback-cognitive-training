import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';
import { storageStatePath } from './e2e/helpers/auth';

const e2eEnvFile = resolve('.env.e2e');
if (existsSync(e2eEnvFile)) {
    // Settings that start stateful work or destructive cleanup belong on the
    // command line of a single run, never in the persistent local file.
    const fileSettings = parseEnv(readFileSync(e2eEnvFile, 'utf8'));
    const commandLineOnly = [
        'E2E_RUN_STATEFUL',
        'E2E_CLEANUP_RUN_ID',
        'E2E_CLEANUP_PLAN_SHA',
        'E2E_CLEANUP_ACCEPT_RETAINED',
    ].filter((name) => name in fileSettings);
    if (fileSettings.E2E_CLEANUP_MODE?.trim() === 'execute') commandLineOnly.push('E2E_CLEANUP_MODE=execute');
    if (commandLineOnly.length > 0) {
        throw new Error(`.env.e2e must not set ${commandLineOnly.join(', ')}; pass these on the command line for a single run.`);
    }
    process.loadEnvFile(e2eEnvFile);
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const bothAccounts = ['auth-patient', 'auth-clinician'];
const noCapture = { trace: 'off', screenshot: 'off', video: 'off' } as const;
/** Stateful runs get a larger budget; cleanup has its own fixture timeout on top. */
const statefulTimeout = 5 * 60_000;

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
        // Offline unit tests for cleanup planning; no browser or Firebase.
        {
            name: 'harness-unit',
            testMatch: /harness\/.*\.test\.ts/,
        },
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
        {
            name: 'auth-patient',
            testMatch: /auth\.setup\.ts/,
            grep: /patient authentication/,
            use: noCapture,
        },
        {
            name: 'auth-clinician',
            testMatch: /auth\.setup\.ts/,
            grep: /clinician authentication/,
            use: noCapture,
        },

        // Read-only suites: browser reads as the signed-in user; no Admin writes.
        {
            name: 'patient',
            testMatch: /patient\.readonly\.spec\.ts/,
            dependencies: ['auth-patient'],
            use: { storageState: storageStatePath.patient },
        },
        {
            name: 'clinician',
            testMatch: /clinician\.readonly\.spec\.ts/,
            dependencies: bothAccounts,
            use: { ...noCapture, storageState: storageStatePath.clinician },
        },
        {
            name: 'deployed-rules',
            testMatch: /deployed-rules\.readonly\.spec\.ts/,
            dependencies: bothAccounts,
        },
        {
            name: 'admin-preflight',
            testMatch: /admin-preflight\.readonly\.spec\.ts/,
            dependencies: bothAccounts,
        },

        // Stateful suites skip unless E2E_RUN_STATEFUL=true (set only by the
        // test:e2e:stateful:* scripts). They share leases, so run one worker at a time.
        // Care and isolation flows depend on rules paths the deployed rules may
        // lack, so they run only after the deployed-rules check passes.
        {
            name: 'stateful-patient',
            testMatch: /patient-demo\.stateful\.spec\.ts/,
            dependencies: bothAccounts,
            timeout: statefulTimeout,
            use: { ...noCapture, screenshot: 'only-on-failure', storageState: storageStatePath.patient },
        },
        {
            name: 'stateful-clinician',
            testMatch: /care-collaboration\.stateful\.spec\.ts/,
            dependencies: ['deployed-rules'],
            timeout: statefulTimeout,
            use: { ...noCapture, screenshot: 'only-on-failure', storageState: storageStatePath.clinician },
        },
        {
            name: 'stateful-isolation',
            testMatch: /account-isolation\.stateful\.spec\.ts/,
            dependencies: ['deployed-rules'],
            timeout: statefulTimeout,
            use: noCapture,
        },
        {
            name: 'cleanup',
            testMatch: /cleanup\.maintenance\.ts/,
            timeout: statefulTimeout,
            use: noCapture,
        },
    ],
});
