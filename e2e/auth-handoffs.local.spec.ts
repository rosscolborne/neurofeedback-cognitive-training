import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient } from './helpers/localEmulator';

test('wrong current password does not change patient sign-in credentials', async ({ browser }) => {
  const fixture = await seedLinkedPatient();
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
