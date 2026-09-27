import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT, requireE2EAdminConfiguration } from './helpers/adminCredential';

const [runId, mode, digest, extra] = process.argv.slice(2);
if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId) ||
    !['plan', 'execute'].includes(mode) ||
    (mode === 'plan' && (digest || extra)) ||
    (mode === 'execute' && (!/^[0-9a-f]{64}$/.test(digest ?? '') || (extra && extra !== '--accept-retained')))) {
    throw new Error('Usage: npm run test:e2e:recover -- <run-id> plan | <run-id> execute <64-character-plan-digest> [--accept-retained]');
}
const envFile = resolve('.env.e2e');
const fileSettings = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const staleSettings = Object.keys(fileSettings).filter((name) => name !== 'E2E_BASE_URL');
if (staleSettings.length) throw new Error(`Recovery accepts only E2E_BASE_URL in .env.e2e. Remove: ${staleSettings.join(', ')}.`);
for (const [variable, expected] of [
    ['E2E_FIREBASE_PROJECT_ID', E2E_PROJECT_ID],
    ['E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL', E2E_SERVICE_ACCOUNT],
] as const) {
    if (process.env[variable] && process.env[variable] !== expected) throw new Error(`${variable} conflicts with the pinned E2E target.`);
}

const recoveryEnvironment = { ...process.env };
for (const name of ['E2E_CLEANUP_RUN_ID', 'E2E_CLEANUP_PLAN_SHA', 'E2E_CLEANUP_ACCEPT_RETAINED', 'E2E_RUN_STATEFUL']) {
    delete recoveryEnvironment[name];
}
const env = {
    ...recoveryEnvironment,
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
    E2E_CLEANUP_RUN_ID: runId,
    E2E_CLEANUP_MODE: mode,
    ...(mode === 'execute' ? { E2E_CLEANUP_PLAN_SHA: digest } : {}),
    ...(extra === '--accept-retained' ? { E2E_CLEANUP_ACCEPT_RETAINED: runId } : {}),
};
requireE2EAdminConfiguration(env);

const code = await new Promise<number>((resolveCode, reject) => {
    const child = spawn('npm', ['run', 'test:e2e:cleanup'], { env, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolveCode(exitCode ?? 1));
});
if (code !== 0) process.exitCode = code;
