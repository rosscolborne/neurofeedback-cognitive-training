import { adminServices } from './helpers/dataLifecycle';
import { E2E_PROJECT_ID, E2E_SERVICE_ACCOUNT, requireE2EAdminConfiguration } from './helpers/adminCredential';
import { fixtureIdentities } from './helpers/fixtureModel';

// This command deliberately performs only two reads. The session preflight
// resets fixtures first, so it is unsuitable for checking new IAM bindings.
for (const [name, expected] of [
    ['E2E_FIREBASE_PROJECT_ID', E2E_PROJECT_ID],
    ['E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL', E2E_SERVICE_ACCOUNT],
] as const) {
    if (process.env[name] && process.env[name] !== expected) throw new Error(`${name} conflicts with the pinned E2E target.`);
}
Object.assign(process.env, {
    E2E_FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    E2E_FIREBASE_SERVICE_ACCOUNT_EMAIL: E2E_SERVICE_ACCOUNT,
    E2E_ENABLE_PRIVILEGED_CLEANUP: 'true',
    E2E_CONFIRM_SHARED_PROJECT_TEST_ACCOUNTS: 'true',
});
requireE2EAdminConfiguration();

const { database, authentication } = await adminServices();
await database.doc('e2eHarnessLocks/fixture-reset').get();
let authResult = 'present';
try {
    await authentication.getUser(fixtureIdentities.patient.uid);
} catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    authResult = 'not provisioned';
}
console.log(`[e2e-credentials] Read-only Firestore and Auth checks succeeded as ${E2E_SERVICE_ACCOUNT} in ${E2E_PROJECT_ID}; patient fixture ${authResult}.`);
