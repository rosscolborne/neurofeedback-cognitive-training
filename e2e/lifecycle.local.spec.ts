import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { readDeletionRecords, seedPatient } from './helpers/localEmulator';

test('delete a patient linked under the retired clinician product, re-register the same email, and the new account cannot read the old one', async ({ browser, permissionErrorGuard }) => {
  // A profile linked under the retired clinician product still stores relationship fields; deletion clears them.
  const fixture = await seedPatient({ clinicianId: 'retired-clinician', clinicId: 'retired-clinic' });
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

    const stored = await readDeletionRecords(fixture.patient.uid, newUid);
    expect(stored.oldAuthExists).toBe(false);
    expect(stored.oldClient?.accountDeletionStartedAt).toBeDefined();
    expect(stored.oldClient?.clinicianId).toBeNull();
    expect(stored.oldClient?.clinicId).toBeNull();
    expect(stored.newClient?.clinicianId).toBeUndefined();
    expect(stored.newClient?.clinicId).toBeUndefined();
    permissionErrorGuard.expectDenialsIn(newContext);
    const oldRead = await patient.evaluate(async ({ oldUid }) => {
      const { probeDeletedPatientProfile } = await import('/e2e/helpers/firestoreProbe.ts');
      return probeDeletedPatientProfile(oldUid);
    }, { oldUid: fixture.patient.uid });
    expect(oldRead).toBe('permission-denied');
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
