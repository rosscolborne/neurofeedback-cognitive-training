import { expect, test } from '@playwright/test';
import { arriveAtClinicianDashboard } from './helpers/auth';

// Read-only: confirms the saved clinician session reaches the real roster view.
test('authenticated clinician reaches the patient roster', async ({ page }) => {
    await page.goto('/');
    await arriveAtClinicianDashboard(page);
    await expect(page.getByRole('heading', { name: 'Patient Roster', exact: true })).toBeVisible();
});
