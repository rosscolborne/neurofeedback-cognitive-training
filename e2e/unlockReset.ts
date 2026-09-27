import { adminServices } from './helpers/dataLifecycle';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT, requireE2EAdminConfiguration } from './helpers/adminCredential';
import { inspectResetLock, releaseStaleResetLock } from './helpers/fixtureReset';

const [action, reviewedRunId] = process.argv.slice(2);
if ((action !== 'inspect' && action !== 'release') ||
    (action === 'inspect' && reviewedRunId) ||
    (action === 'release' && !/^[0-9a-f-]{36}$/.test(reviewedRunId ?? ''))) {
    throw new Error('Usage: npm run test:e2e:unlock -- inspect | release <reviewed-reset-run-id>');
}
for (const [variable, expected] of [
    ['E2E_FIREBASE_PROJECT_ID', E2E_PROJECT_ID],
    ['E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL', E2E_SERVICE_ACCOUNT],
] as const) {
    if (process.env[variable] && process.env[variable] !== expected) throw new Error(`${variable} conflicts with the pinned E2E target.`);
}
Object.assign(process.env, {
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
});
requireE2EAdminConfiguration();
const { database } = await adminServices();
if (action === 'inspect') {
    const lock = await inspectResetLock(database);
    console.log(lock ? `[e2e-fixtures] Reset lock ${lock.runId}, age ${lock.ageMinutes} minute(s).` : '[e2e-fixtures] No reset lock.');
} else {
    await releaseStaleResetLock(database, reviewedRunId!);
    console.log('[e2e-fixtures] Reviewed stale reset lock released. Rerun fixture reset.');
}
