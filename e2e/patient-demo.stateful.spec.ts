import { expect, test } from './helpers/statefulFixture';
import { arriveAtPatientDashboard, authenticatedFirebaseIdentity, identityFromStorageState, startPatientTrainingInDemoMode } from './helpers/auth';
import { prepareE2EPatientForCanonicalTraining, statefulRunRequested, type E2EPairRun } from './helpers/dataLifecycle';
import { expectDemoSessionPersisted } from './helpers/persistenceAssertions';
import { aggregateSessionCount, openAllTimeProgress, trackingCopy } from './helpers/patientProgress';

test.describe('patient Demo persistence (stateful)', () => {
    test.skip(!statefulRunRequested(), 'Stateful: run through npm run test:e2e:stateful:patient.');

    test('Demo persists as synthetic progress while the following non-Demo attempt remains headset-gated', async ({ browser, page, stateful }) => {
        await page.goto('/');
        await arriveAtPatientDashboard(page);
        const patientIdentity = await authenticatedFirebaseIdentity(page);
        const clinicianIdentity = await identityFromStorageState(browser, 'clinician');
        const run: E2EPairRun = await stateful.beginPairRun(patientIdentity, clinicianIdentity);

        await prepareE2EPatientForCanonicalTraining(run);
        await page.reload();
        await arriveAtPatientDashboard(page);
        const beforeCount = await openAllTimeProgress(page);

        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByRole('button', { name: 'View Protocol Details', exact: true }).click();
        const protocolDialog = page.getByRole('dialog', { name: 'Protocol details' });
        await expect(protocolDialog.getByText('Lubar Theta/Beta Ratio Protocol', { exact: true })).toBeVisible();
        await protocolDialog.getByRole('button', { name: 'Close protocol details', exact: true }).click();

        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await startPatientTrainingInDemoMode(page);

        await expect(page.getByText('Simulator', { exact: true })).toBeVisible();
        await expect(page.getByText(/Runtime controls: canonical protocol mode/)).toBeVisible();
        await expect(page.getByText(/Phase: training/)).toBeVisible();
        await page.getByRole('button', { name: 'End Session & Save', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Complete Training Session?', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Yes, Save Progress & View Summary', exact: true }).click();

        await expect(page.getByRole('heading', { name: 'Session Complete', exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Training Demo · Synthetic acquisition. Feedback below is simulated, not measured EEG.', { exact: true })).toBeVisible();
        await expect(page.getByText('Synthetic time in target zone', { exact: true })).toBeVisible();
        await expect(page.getByText(/Measured average band powers: unavailable in Training Demo\./)).toBeVisible();

        // The run marker in the session note is the cleanup evidence for this session.
        await page.getByPlaceholder('Note any cognitive sensations, focus shifts, or ambient environment details...', { exact: true }).fill(run.runMarker);
        await page.getByRole('button', { name: /Focused/ }).click();
        await page.getByRole('button', { name: 'Save Notes', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Saved ✓', exact: true })).toBeVisible({ timeout: 15_000 });
        await expectDemoSessionPersisted(run, page);
        await page.getByRole('button', { name: /View Progress/ }).click();

        await expect(page.getByText(trackingCopy(beforeCount + 1), { exact: true })).toBeVisible({ timeout: 15_000 });
        await page.getByRole('button', { name: 'All Time', exact: true }).click();
        await expect(aggregateSessionCount(page)).toContainText(String(beforeCount + 1));
        expect(await page.getByText('Training Demo · Synthetic acquisition', { exact: true }).count()).toBeGreaterThan(0);

        await page.reload();
        await arriveAtPatientDashboard(page);
        const reloadedCount = await openAllTimeProgress(page);
        expect(reloadedCount).toBe(beforeCount + 1);
        await expect(aggregateSessionCount(page)).toContainText(String(beforeCount + 1));

        const newestDemoProvenance = page.getByText('Training Demo · Synthetic acquisition', { exact: true }).first();
        await expect(newestDemoProvenance).toBeVisible();
        await newestDemoProvenance.click();
        await expect(page.getByText(run.runMarker, { exact: true })).toBeVisible();
        await expect(page.getByText(/Not measured — synthetic Training Demo feedback/)).toBeVisible();

        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByRole('button', { name: 'Begin Session', exact: true }).click();

        await expect(page.getByRole('heading', { name: 'Connect Muse Headband', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Connect Muse Headband', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try Demo Mode', exact: true })).toBeVisible();
        await expect(page.getByText('Simulator', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Training Demo · Synthetic acquisition', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'End Session & Save', exact: true })).toHaveCount(0);

        await page.getByRole('button', { name: 'Cancel & Return to Dashboard', exact: true }).click();
        expect(await openAllTimeProgress(page)).toBe(reloadedCount);

        await page.reload();
        await arriveAtPatientDashboard(page);
        expect(await openAllTimeProgress(page)).toBe(reloadedCount);
        // The non-Demo attempt must not have persisted anything further.
        await expectDemoSessionPersisted(run, page);
    });
});
