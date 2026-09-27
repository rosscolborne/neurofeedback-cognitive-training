import { test } from '@playwright/test';
import { cleanupRecordedE2ERun } from './helpers/dataLifecycle';

/**
 * Operator-driven review of a stateful run that did not finish cleanly.
 *
 *   npm run test:e2e:recover -- <run> plan
 *       read-only; prints the plan and its digest
 *   npm run test:e2e:recover -- <run> execute <digest>
 *       applies exactly that plan, verifies, and releases the run's lease
 *
 * Add --accept-retained to the execute command only after
 * reviewing the retained items; they stay untouched, their pre-run values are
 * saved under e2e/.cleanup-reports/, and the lease is released.
 */
test('review or clean a recorded stateful E2E run', async ({}, testInfo) => {
    const runId = process.env.E2E_CLEANUP_RUN_ID?.trim();
    test.skip(!runId, 'Set E2E_CLEANUP_RUN_ID to the run named by the blocking lease or cleanup report.');
    await cleanupRecordedE2ERun(runId!, testInfo);
});
