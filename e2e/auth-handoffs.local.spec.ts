import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedPatient, seedPractitionerAccount } from './helpers/localEmulator';

test('wrong current password does not change patient sign-in credentials', async ({ browser }) => {
  const fixture = await seedPatient();
  const patientContext = await browser.newContext();
  const verificationContext = await browser.newContext();
  const proposedPassword = 'NewLocalPassword!456';
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByLabel('Current password').fill('WrongLocalPassword!123');
    await patient.getByLabel('New password', { exact: true }).fill(proposedPassword);
    await patient.getByLabel('Confirm new password').fill(proposedPassword);
    await patient.getByRole('button', { name: 'Change password' }).click();
    await expect(patient.getByRole('alert')).toContainText('Your current password is incorrect.');
    await expect(patient.getByRole('status').filter({ hasText: 'Password changed successfully.' })).toHaveCount(0);

    const verifier = await verificationContext.newPage();
    await verifier.goto('/#/login');
    await verifier.getByPlaceholder('name@example.com', { exact: true }).fill(fixture.patient.email);
    await verifier.getByPlaceholder('Your password', { exact: true }).fill(proposedPassword);
    await verifier.getByRole('button', { name: 'Log In', exact: true }).click();
    await expect(verifier.getByText('Incorrect email or password. Please check your credentials and try again.')).toBeVisible();
    await verifier.getByPlaceholder('Your password', { exact: true }).fill(fixture.patient.password);
    await verifier.getByRole('button', { name: 'Log In', exact: true }).click();
    await arriveAtPatientDashboard(verifier);
  } finally {
    await Promise.allSettled([patientContext.close(), verificationContext.close()]);
  }
});

const unsupportedAccount = (page: Page) => page.getByRole('heading', { name: 'Practitioner accounts aren’t supported', level: 1 });

async function expectUnsupportedAccountScreen(page: Page) {
  await expect(unsupportedAccount(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/ is for personal brain training\. Sign out, then create a new account to train\.$/)).toBeVisible();
  // Nothing of the retired clinician workspace, and no patient home.
  await expect(page.getByRole('button', { name: 'Patients', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play Mental Math', exact: true })).toHaveCount(0);
}

test('a practitioner account is told it is unsupported, and Sign out returns to Welcome', async ({ browser }) => {
  // users/{uid}.role is 'clinician' for the seeded practitioner account.
  const practitioner = await seedPractitionerAccount();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginThroughUi(page, practitioner);
    await expectUnsupportedAccountScreen(page);
    await page.reload();
    await expectUnsupportedAccountScreen(page);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Welcome to your\s*brain training journey$/, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Begin Journey' })).toBeVisible();
    await expect(unsupportedAccount(page)).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const { auth } = await import('/src/services/firebase.ts');
      await auth.authStateReady();
      return auth.currentUser?.uid ?? null;
    })).toBeNull();

    // Signing in again shows the same screen.
    await loginThroughUi(page, practitioner);
    await expectUnsupportedAccountScreen(page);
  } finally {
    await context.close();
  }
});
