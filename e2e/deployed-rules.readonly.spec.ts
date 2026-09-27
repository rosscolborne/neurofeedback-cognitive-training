import type { Browser } from '@playwright/test';
import { expect, test } from './fixtures';
import { authenticatedFirebaseIdentity, arriveAtClinicianDashboard, arriveAtPatientDashboard, identityFromStorageState, storageStatePath, type E2ERole } from './helpers/auth';

/**
 * Read-only check that the deployed Firestore rules grant what this branch's
 * firestore.rules grant. Stateful care flows cannot pass while this fails.
 */
async function probeAs(browser: Browser, role: E2ERole, otherUid: string): Promise<Record<string, string>> {
    const context = await browser.newContext({ storageState: storageStatePath[role] });
    try {
        const page = await context.newPage();
        await page.goto('/');
        if (role === 'patient') await arriveAtPatientDashboard(page);
        else await arriveAtClinicianDashboard(page);
        await authenticatedFirebaseIdentity(page);
        return await page.evaluate(async ({ role, otherUid }) => {
            const probes = await import('/e2e/helpers/firestoreProbe.ts');
            return role === 'patient'
                ? probes.probePatientBranchRuleReads(otherUid)
                : probes.probeClinicianBranchRuleReads(otherUid);
        }, { role, otherUid });
    } finally {
        await context.close();
    }
}

test('deployed Firestore rules grant the reads this branch relies on', async ({ browser }, testInfo) => {
    const clinician = await identityFromStorageState(browser, 'clinician');
    const patient = await identityFromStorageState(browser, 'patient');
    const outcomes = {
        patient: await probeAs(browser, 'patient', clinician.uid),
        clinician: await probeAs(browser, 'clinician', patient.uid),
    };
    testInfo.annotations.push({ type: 'rule-probes', description: JSON.stringify(outcomes) });
    console.log(`[deployed-rules] ${JSON.stringify(outcomes)}`);

    expect(outcomes, 'Deployed rules differ from this branch; deploy firestore.rules as a separate release decision').toEqual({
        patient: { ownMessageThread: 'allowed', ownMessageReadReceipt: 'allowed', ownBrainMaps: 'allowed' },
        clinician: { ownUserRole: 'allowed', ownPractitionerRecord: 'allowed', ownMessageReadReceipt: 'allowed' },
    });
});
