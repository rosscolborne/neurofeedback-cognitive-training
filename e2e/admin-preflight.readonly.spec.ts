import { expect, test } from '@playwright/test';
import { identityFromStorageState } from './helpers/auth';
import { inspectE2EHarness } from './helpers/dataLifecycle';

/**
 * Read-only Admin preflight: configuration, identity allow-list, leases,
 * registry, and fixture readiness. Writes nothing to Firestore or Auth.
 */
test('stateful E2E prerequisites', async ({ browser }, testInfo) => {
    const patient = await identityFromStorageState(browser, 'patient');
    const clinician = await identityFromStorageState(browser, 'clinician');
    const { findings, blockers } = await inspectE2EHarness(patient, clinician);
    const report = [...findings, ...Object.entries(blockers).map(([suite, reasons]) =>
        `${suite}: ${reasons.length ? `blocked — ${reasons.join('; ')}` : 'ready'}`)];
    console.log(`[e2e-preflight]\n${report.map((line) => `  ${line}`).join('\n')}`);
    await testInfo.attach('preflight', { body: report.join('\n'), contentType: 'text/plain' });
    expect(Object.values(blockers).flat(), 'Stateful suite blockers').toEqual([]);
});
