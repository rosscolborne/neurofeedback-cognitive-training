import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { chromium } from '@playwright/test';
import { adminServices } from './helpers/dataLifecycle';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT, requireE2EAdminConfiguration } from './helpers/adminCredential';
import { fixtureIdentities } from './helpers/fixtureModel';
import { resetE2EFixtures } from './helpers/fixtureReset';

const suite = process.argv[2];
const scripts: Record<string, string | undefined> = {
    patient: 'test:e2e:stateful:patient',
    clinician: 'test:e2e:stateful:clinician',
    isolation: 'test:e2e:stateful:isolation',
    preflight: undefined,
    reset: undefined,
};
if (!suite || !Object.hasOwn(scripts, suite) || process.argv.length !== 3) {
    throw new Error('Usage: npm run test:e2e:session -- <patient|clinician|isolation|preflight|reset>');
}
for (const [variable, expected] of [
    ['E2E_FIREBASE_PROJECT_ID', E2E_PROJECT_ID],
    ['E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL', E2E_SERVICE_ACCOUNT],
] as const) {
    if (process.env[variable] && process.env[variable] !== expected) {
        throw new Error(`${variable} conflicts with the pinned E2E target.`);
    }
}

Object.assign(process.env, {
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
    E2E_CLEANUP_MODE: 'execute',
});
requireE2EAdminConfiguration();
const envFile = resolve('.env.e2e');
const fileSettings = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const staleSettings = Object.keys(fileSettings).filter((name) => name !== 'E2E_BASE_URL');
if (staleSettings.length) {
    throw new Error(`The E2E session accepts only E2E_BASE_URL in .env.e2e. Remove: ${staleSettings.join(', ')}.`);
}
const baseURL = process.env.E2E_BASE_URL ?? fileSettings.E2E_BASE_URL ?? 'http://localhost:5173';

async function verifyBrowserProject(): Promise<void> {
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
    try {
        const page = await browser.newPage();
        await page.goto(baseURL);
        const browserProject = await page.evaluate(async () => {
            const { auth } = await import('/src/services/firebase.ts');
            return auth.app.options.projectId;
        });
        if (browserProject !== E2E_PROJECT_ID) {
            throw new Error(`Browser Firebase project ${browserProject ?? '(missing)'} differs from the pinned E2E project ${E2E_PROJECT_ID}.`);
        }
    } finally {
        await browser.close();
    }
}

await verifyBrowserProject();

const passwords = {
    patient: randomBytes(32).toString('base64url'),
    clinician: randomBytes(32).toString('base64url'),
    outsider: randomBytes(32).toString('base64url'),
};
const authStateDirectory = await mkdtemp(join(tmpdir(), 'neurasticity-e2e-'));
const sessionEnvironment = { ...process.env };
for (const name of ['E2E_CLEANUP_RUN_ID', 'E2E_CLEANUP_PLAN_SHA', 'E2E_CLEANUP_ACCEPT_RETAINED', 'E2E_RUN_STATEFUL']) {
    delete sessionEnvironment[name];
}
const childEnv = {
    ...sessionEnvironment,
    E2E_BASE_URL: baseURL,
    E2E_AUTH_STATE_DIR: authStateDirectory,
    E2E_PATIENT_UID: fixtureIdentities.patient.uid,
    E2E_PATIENT_EMAIL: fixtureIdentities.patient.email,
    E2E_PATIENT_PASSWORD: passwords.patient,
    E2E_CLINICIAN_UID: fixtureIdentities.clinician.uid,
    E2E_CLINICIAN_EMAIL: fixtureIdentities.clinician.email,
    E2E_CLINICIAN_PASSWORD: passwords.clinician,
};

function run(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = spawn('npm', ['run', script], { env: childEnv, stdio: 'inherit', shell: false });
        command.once('error', reject);
        command.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${script} failed (${signal ?? code}).`)));
    });
}

try {
    const { database, authentication } = await adminServices();
    console.log(`[e2e-fixtures] Resetting dedicated fixtures in ${E2E_PROJECT_ID}.`);
    await resetE2EFixtures(authentication, database, passwords);
    if (suite !== 'reset') {
        try {
            await run('test:e2e:preflight');
            if (suite === 'clinician' || suite === 'isolation') await run('test:e2e:rules');
            if (scripts[suite]) await run(scripts[suite]);
        } finally {
            // A parked lease deliberately blocks this reset; recover that run first.
            await resetE2EFixtures(authentication, database, passwords);
        }
    }
    console.log('[e2e-fixtures] Dedicated fixtures are at baseline.');
} finally {
    await rm(authStateDirectory, { recursive: true, force: true });
}
