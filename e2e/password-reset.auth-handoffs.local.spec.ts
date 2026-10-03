import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedPatient } from './helpers/localEmulator';

const authEmulator = 'http://127.0.0.1:9099';
const projectId = 'demo-neurasticity-protocol-e2e';

type RecordedOobCode = { email: string; oobCode: string; requestType: string };

/** Password reset emails the Auth emulator has recorded for one address. */
async function resetEmailsFor(email: string): Promise<RecordedOobCode[]> {
  const response = await fetch(`${authEmulator}/emulator/v1/projects/${projectId}/oobCodes`);
  expect(response.ok).toBe(true);
  const { oobCodes = [] } = await response.json() as { oobCodes?: RecordedOobCode[] };
  return oobCodes.filter((code) => code.requestType === 'PASSWORD_RESET' && code.email === email);
}

test('password reset cooldown sends one email per request and treats unknown addresses the same', async ({ page, browser }) => {
  const fixture = await seedPatient();
  const email = fixture.patient.email;
  const missingEmail = `missing-${randomUUID().slice(0, 12)}@example.test`;
  const newPassword = 'ResetLocalPassword!789';

  // Installed before navigation; page time flows normally until it is paused below.
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();
  const emailField = page.getByPlaceholder('name@example.com', { exact: true });
  await emailField.fill(email);
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reset Password', exact: true })).toBeVisible();
  // From here on only runFor advances page time, so countdown labels are exact.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  const form = page.locator('form');
  const submit = form.locator('button[type="submit"]');
  const status = page.getByRole('status');

  // A burst of clicks and submissions dispatched before React can re-render.
  await submit.evaluate((button: HTMLButtonElement) => {
    for (let i = 0; i < 5; i += 1) button.click();
    for (let i = 0; i < 3; i += 1) button.form?.requestSubmit();
  });
  await expect(status).toContainText('If an account uses that email address, we’ll send password reset instructions.');
  await expect(status).toContainText('check your spam or junk folder');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Resend in 60s');
  // Enter presses and submissions that bypass the disabled button during the cooldown.
  for (let i = 0; i < 3; i += 1) await emailField.press('Enter');
  await form.evaluate((element: HTMLFormElement) => {
    for (let i = 0; i < 3; i += 1) element.requestSubmit();
  });
  const firstEmails = await resetEmailsFor(email);
  expect(firstEmails).toHaveLength(1);
  const sentStatus = await status.innerText();

  await page.clock.runFor(5_000);
  await expect(submit).toHaveText('Resend in 55s');

  // Leaving and reopening the reset view keeps the cooldown for this address.
  await page.getByRole('button', { name: 'Return to login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(emailField).toHaveValue(email);
  await expect(status).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Resend in 55s');

  // An address without an account can send at once and looks exactly like a real one.
  await emailField.fill(missingEmail);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText('Send reset instructions');
  const missingResponse = page.waitForResponse((response) => response.url().includes('accounts:sendOobCode'));
  await submit.click();
  expect((await missingResponse).ok(), 'the emulator rejects the unknown address').toBe(false);
  await expect(status).toBeVisible();
  expect(await status.innerText()).toBe(sentStatus);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Resend in 60s');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await resetEmailsFor(missingEmail)).toHaveLength(0);

  await emailField.fill(email);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Resend in 55s');
  await page.clock.runFor(55_000);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText('Resend reset instructions');
  expect(await resetEmailsFor(email)).toHaveLength(1);

  // After the cooldown a resend goes out and names the newest email as the one to use.
  await submit.click();
  await expect(status).toContainText('If an account uses that email address, we’ll send a new reset email.');
  await expect(status).toContainText('Use the link in the most recent email. Earlier reset links no longer work.');
  await expect(status).toContainText('check your spam or junk folder');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Resend in 60s');
  const allEmails = await resetEmailsFor(email);
  expect(allEmails).toHaveLength(2);
  const newest = allEmails.find((code) => code.oobCode !== firstEmails[0].oobCode);
  expect(newest).toBeDefined();

  // The newest link still resets the password (the request the hosted reset page makes).
  const reset = await fetch(`${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=local-test-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oobCode: newest!.oobCode, newPassword }),
  });
  expect(reset.ok).toBe(true);
  const verificationContext = await browser.newContext();
  try {
    const verifier = await verificationContext.newPage();
    await loginThroughUi(verifier, { email, password: newPassword });
    await arriveAtPatientDashboard(verifier);
  } finally {
    await verificationContext.close();
  }
});
