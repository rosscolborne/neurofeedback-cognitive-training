import type { Browser } from '@playwright/test';
import { expect, test } from './fixtures';
import { authenticatedFirebaseIdentity, arriveAtClinicianDashboard, arriveAtPatientDashboard, identityFromStorageState, storageStatePath, type E2ERole } from './helpers/auth';
import type { DeployedReadProbe } from './helpers/firestoreProbe';

/**
 * Read-only check that the deployed Firestore rules grant what this branch's
 * firestore.rules grant. Stateful care flows cannot pass while this fails.
 */
async function probeAs(browser: Browser, role: E2ERole, otherUid: string, hasReadableLegacyMessageHistory = false): Promise<DeployedReadProbe> {
    const context = await browser.newContext({ storageState: storageStatePath[role] });
    try {
        const page = await context.newPage();
        await page.goto('/');
        if (role === 'patient') await arriveAtPatientDashboard(page);
        else await arriveAtClinicianDashboard(page);
        await authenticatedFirebaseIdentity(page);
        return await page.evaluate(async ({ role, otherUid, hasReadableLegacyMessageHistory }) => {
            const probes = await import('/e2e/helpers/firestoreProbe.ts');
            return role === 'patient'
                ? probes.probePatientBranchRuleReads(otherUid)
                : probes.probeClinicianBranchRuleReads(otherUid, hasReadableLegacyMessageHistory);
        }, { role, otherUid, hasReadableLegacyMessageHistory });
    } finally {
        await context.close();
    }
}

test('deployed Firestore rules grant the reads this branch relies on', async ({ browser }, testInfo) => {
    const clinician = await identityFromStorageState(browser, 'clinician');
    const patient = await identityFromStorageState(browser, 'patient');
    const patientProbe = await probeAs(browser, 'patient', clinician.uid);
    const clinicianProbe = await probeAs(browser, 'clinician', patient.uid, patientProbe.hasReadableLegacyMessageHistory);
    const outcomes = { patient: patientProbe.reads, clinician: clinicianProbe.reads };
    testInfo.annotations.push({ type: 'rule-probes', description: JSON.stringify(outcomes) });
    console.log(`[deployed-rules] ${JSON.stringify(outcomes)}`);

    expect(Object.keys(outcomes.patient).sort()).toEqual([
        'ownUserRole', 'ownClientProfileAndAssignment', 'linkedClinicBrand',
        'ownSessionsAndProgress', 'ownBrainMaps', 'ownMessageThread', 'ownMessageReadReceipt',
        'ownMessageHistory', 'ownLegacyMessageHistory', 'ownAppointments',
        'ownLegacyAppointments',
    ].sort());
    expect(Object.keys(outcomes.clinician).sort()).toEqual([
        'ownUserRole', 'ownPractitionerRecord', 'ownClinicSettings',
        'canonicalRoster', 'legacyRoster', 'patientInvitations',
        ...(clinicianProbe.hasExistingInvitation ? ['existingInvitation'] : []),
        'linkedPatientProfileAndAssignment', 'rosterPatientProfiles', 'rosterSessionsAndReports',
        'rosterAppointments', 'rosterLegacyAppointments', 'rosterMessageThreads',
        'rosterMessageReadReceipts', 'linkedPatientBrainMaps',
        'linkedPatientMessageThread', 'ownMessageReadReceipt', 'linkedPatientMessageHistory',
        ...(patientProbe.hasReadableLegacyMessageHistory ? ['linkedPatientLegacyMessageHistory'] : []),
    ].sort());
    for (const [role, reads] of Object.entries(outcomes)) {
        expect(reads, `${role} deployed rules denied a current dashboard read; deploy firestore.rules as a separate release decision`)
            .toEqual(Object.fromEntries(Object.keys(reads).map((name) => [name, 'allowed'])));
    }
});
