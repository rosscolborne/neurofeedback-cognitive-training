import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test } from './fixtures';
import {
    arriveAtClinicianDashboard,
    arriveAtPatientDashboard,
    credentialsFor,
    loginThroughUi,
    missingCredentialVariables,
    storageStatePath,
} from './helpers/auth';

test('patient authentication', async ({ page }) => {
    const credentials = credentialsFor('patient');
    if (!credentials) {
        throw new Error(`Set ${missingCredentialVariables('patient').join(' and ')} for this E2E run.`);
    }

    await loginThroughUi(page, credentials);
    await arriveAtPatientDashboard(page);
    await mkdir(dirname(storageStatePath.patient), { recursive: true, mode: 0o700 });
    await page.context().storageState({ path: storageStatePath.patient, indexedDB: true });
});

test('clinician authentication', async ({ page }) => {
    const credentials = credentialsFor('clinician');
    if (!credentials) {
        throw new Error(`Set ${missingCredentialVariables('clinician').join(' and ')} for this E2E run.`);
    }

    await loginThroughUi(page, credentials);
    await arriveAtClinicianDashboard(page);
    await mkdir(dirname(storageStatePath.clinician), { recursive: true, mode: 0o700 });
    await page.context().storageState({ path: storageStatePath.clinician, indexedDB: true });
});
