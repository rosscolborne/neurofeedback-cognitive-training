import { mkdir } from 'node:fs/promises';
import { test } from '@playwright/test';
import {
    arriveAtClinicianDashboard,
    arriveAtPatientDashboard,
    credentialsFor,
    loginThroughUi,
    missingCredentialVariables,
} from './helpers/auth';

test('patient authentication', async ({ page }) => {
    const credentials = credentialsFor('patient');
    if (!credentials) {
        throw new Error(`Set ${missingCredentialVariables('patient').join(' and ')} in .env.e2e before generating patient state.`);
    }

    await loginThroughUi(page, credentials);
    await arriveAtPatientDashboard(page);
    await mkdir('e2e/.auth', { recursive: true });
    await page.context().storageState({ path: 'e2e/.auth/patient.json', indexedDB: true });
});

test('clinician authentication', async ({ page }) => {
    const credentials = credentialsFor('clinician');
    if (!credentials) {
        throw new Error(`Set ${missingCredentialVariables('clinician').join(' and ')} in .env.e2e before generating clinician state.`);
    }

    await loginThroughUi(page, credentials);
    await arriveAtClinicianDashboard(page);
    await mkdir('e2e/.auth', { recursive: true });
    await page.context().storageState({ path: 'e2e/.auth/clinician.json', indexedDB: true });
});
