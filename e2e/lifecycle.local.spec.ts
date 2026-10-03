import type { Page } from '@playwright/test';
import { getClinicalProtocolTemplate } from '../src/services/clinicalProtocolTemplates';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { readDeletionRecords, seedPatient, seedReviewSession } from './helpers/localEmulator';

// Every protocol template now recommends the one remaining experience, NeuroGambit.
const allExperienceNames = ['NeuroGambit'];
const thetaIds = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
const thetaNames = ['NeuroGambit'];

async function expectPatientCatalogue(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  for (const name of allExperienceNames) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(names.includes(name) ? 1 : 0);
  }
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  const cards = page.locator('main .card-patient');
  await expect(cards).toHaveCount(names.length);
  for (const name of names) await expect(cards.getByText(name, { exact: true })).toHaveCount(1);
}

async function readCurrentPatientAssignment(page: Page) {
  return page.evaluate(async () => {
    const { auth } = await import('/src/services/firebase.ts');
    const { storageEngine } = await import('/src/services/storageEngine.ts');
    if (!auth.currentUser) throw new Error('Expected a signed-in patient');
    const profile = await storageEngine.getClient(auth.currentUser.uid);
    if (!profile) throw new Error('Expected a persisted patient profile');
    return {
      assignedProtocol: profile.assignedProtocol,
      allowedExperiences: profile.allowedExperiences,
      customProtocolConfig: profile.customProtocolConfig,
      completedSessionsCount: profile.completedSessionsCount,
      tidalGardenState: profile.tidalGardenState,
    };
  });
}

test('delete a patient linked under the retired clinician product, re-register the same email, and the new account cannot read the old one', async ({ browser, permissionErrorGuard }) => {
  // A profile linked under the retired clinician product still stores relationship fields; deletion clears them.
  const fixture = await seedPatient({ clinicianId: 'retired-clinician', clinicId: 'retired-clinic' });
  const retainedSessionId = await seedReviewSession(fixture, 'Retained history');
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
  try {
    const oldPatient = await oldContext.newPage();
    await loginThroughUi(oldPatient, fixture.patient);
    await arriveAtPatientDashboard(oldPatient);
    await oldPatient.getByRole('button', { name: 'Profile', exact: true }).click();
    await oldPatient.getByRole('button', { name: 'Delete Account' }).click();
    await oldPatient.getByLabel('Enter your password to confirm account deletion').fill(fixture.patient.password);
    await oldPatient.getByRole('button', { name: 'Confirm account deletion' }).click();
    await expect(oldPatient).toHaveURL(/welcome/, { timeout: 20_000 });

    const patient = await newContext.newPage();
    await patient.goto('/#/signup');
    await patient.getByPlaceholder('How should we call you?').fill(fixture.name);
    await patient.getByPlaceholder('you@example.com').fill(fixture.patient.email);
    await patient.getByPlaceholder('At least 6 characters').fill(fixture.patient.password);
    await patient.getByRole('button', { name: 'Create Account' }).click();
    await patient.getByRole('button', { name: /Train my brain/ }).click();
    await arriveAtPatientDashboard(patient);
    const newUid = await authenticatedUserId(patient);
    expect(newUid).not.toBe(fixture.patient.uid);
    // The new account starts from the default training setup.
    expect(await readCurrentPatientAssignment(patient)).toMatchObject({ assignedProtocol: 'theta-beta-ratio', allowedExperiences: thetaIds });
    await expectPatientCatalogue(patient, thetaNames);

    const stored = await readDeletionRecords(fixture.patient.uid, newUid);
    expect(stored.oldAuthExists).toBe(false);
    expect(stored.oldClient?.accountDeletionStartedAt).toBeDefined();
    expect(stored.oldClient?.clinicianId).toBeNull();
    expect(stored.oldClient?.clinicId).toBeNull();
    expect(stored.newClient?.clinicianId).toBeUndefined();
    expect(stored.newClient?.clinicId).toBeUndefined();
    permissionErrorGuard.expectDenialsIn(newContext);
    const oldReads = await patient.evaluate(async ({ oldUid, sessionId }) => {
      const { probeDeletedPatientHistory } = await import('/e2e/helpers/firestoreProbe.ts');
      return probeDeletedPatientHistory(oldUid, sessionId);
    }, { oldUid: fixture.patient.uid, sessionId: retainedSessionId });
    expect(oldReads).toEqual(['permission-denied', 'permission-denied']);
  } finally {
    await Promise.allSettled([oldContext.close(), newContext.close()]);
  }
});

test('wrong deletion password keeps the account and profile intact', async ({ browser }) => {
  const fixture = await seedPatient();
  const patientContext = await browser.newContext();
  try {
    const patient = await patientContext.newPage();
    await loginThroughUi(patient, fixture.patient);
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await patient.getByRole('button', { name: 'Delete Account' }).click();
    const deletionPassword = patient.getByLabel('Enter your password to confirm account deletion');
    const confirmDeletion = patient.getByRole('button', { name: 'Confirm account deletion' });
    await deletionPassword.fill('WrongLocalPassword!123');
    await confirmDeletion.click();
    const deletionError = patient.locator('form').filter({ has: deletionPassword }).getByRole('alert');
    await expect(deletionError).toHaveText('Incorrect password. Please try again.');
    await expect(deletionError).not.toContainText('auth/');
    await expect(deletionError).not.toContainText('Firebase');
    // The form stays usable for another attempt, starting from an empty field.
    await expect(deletionPassword).toHaveValue('');
    await expect(deletionPassword).toBeEditable();
    await expect(confirmDeletion).toBeDisabled();
    await deletionPassword.fill('AnotherAttempt!123');
    await expect(confirmDeletion).toBeEnabled();
    expect(await authenticatedUserId(patient)).toBe(fixture.patient.uid);
    await patient.reload();
    await arriveAtPatientDashboard(patient);
    await patient.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(patient.getByText(fixture.patient.email)).toBeVisible();
    const stored = await readDeletionRecords(fixture.patient.uid, fixture.patient.uid);
    expect(stored.oldAuthExists).toBe(true);
    expect(stored.oldClient?.accountDeletionStartedAt).toBeUndefined();
  } finally {
    await patientContext.close();
  }
});
