import { test } from './fixtures';
import { identityFromStorageState } from './helpers/auth';
import { cleanupRecordedE2ERun } from './helpers/dataLifecycle';

/**
 * Operator-driven review of a stateful run that did not finish cleanly.
 *
 *   E2E_CLEANUP_RUN_ID=<run> E2E_CLEANUP_MODE=plan npm run test:e2e:cleanup
 *       read-only; prints the plan and its digest
 *   E2E_CLEANUP_RUN_ID=<run> E2E_CLEANUP_MODE=execute E2E_CLEANUP_PLAN_SHA=<digest> npm run test:e2e:cleanup
 *       applies exactly that plan, verifies, and releases the run's lease
 *
 * Add E2E_CLEANUP_ACCEPT_RETAINED=<run> to the execute command only after
 * reviewing the retained items; they stay untouched, their pre-run values are
 * saved under e2e/.cleanup-reports/, and the lease is released.
 */
test('review or clean a recorded stateful E2E run', async ({ browser }, testInfo) => {
    const runId = process.env.E2E_CLEANUP_RUN_ID?.trim();
    test.skip(!runId, 'Set E2E_CLEANUP_RUN_ID to the run named by the blocking lease or cleanup report.');
    const patient = await identityFromStorageState(browser, 'patient');
    const clinician = await identityFromStorageState(browser, 'clinician');
    await cleanupRecordedE2ERun(runId!, { patient, clinician }, testInfo);
});
