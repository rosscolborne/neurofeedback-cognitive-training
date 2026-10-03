import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { readAccountRecords, seedConsumerAccount, seedPlayer } from './helpers/localEmulator';

test('wrong current password does not change the player\'s sign-in credentials', async ({ browser }) => {
  const fixture = await seedPlayer();
  const playerContext = await browser.newContext();
  const verificationContext = await browser.newContext();
  const proposedPassword = 'NewLocalPassword!456';
  try {
    const player = await playerContext.newPage();
    await loginThroughUi(player, fixture.player);
    await arriveAtHome(player);
    await player.getByRole('button', { name: 'Profile', exact: true }).click();
    await player.getByLabel('Current password').fill('WrongLocalPassword!123');
    await player.getByLabel('New password', { exact: true }).fill(proposedPassword);
    await player.getByLabel('Confirm new password').fill(proposedPassword);
    await player.getByRole('button', { name: 'Change password' }).click();
    await expect(player.getByRole('alert')).toContainText('Your current password is incorrect.');
    await expect(player.getByRole('status').filter({ hasText: 'Password changed successfully.' })).toHaveCount(0);

    const verifier = await verificationContext.newPage();
    await verifier.goto('/#/login');
    await verifier.getByPlaceholder('name@example.com', { exact: true }).fill(fixture.player.email);
    await verifier.getByPlaceholder('Your password', { exact: true }).fill(proposedPassword);
    await verifier.getByRole('button', { name: 'Log In', exact: true }).click();
    await expect(verifier.getByText('Incorrect email or password. Please check your credentials and try again.')).toBeVisible();
    await verifier.getByPlaceholder('Your password', { exact: true }).fill(fixture.player.password);
    await verifier.getByRole('button', { name: 'Log In', exact: true }).click();
    await arriveAtHome(verifier);
  } finally {
    await Promise.allSettled([playerContext.close(), verificationContext.close()]);
  }
});

test('signing in to an account with no profile creates its consumer profile and arrives home, with no account-type step', async ({ page }) => {
  // An Auth account only, as when sign-up's profile write never reached the server.
  const account = await seedConsumerAccount();
  expect(await readAccountRecords(account.uid)).toEqual({ profile: undefined, authExists: true });

  await loginThroughUi(page, account);
  await arriveAtHome(page);
  await expect(page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Local\.$/ })).toBeVisible();
  await expect.poll(async () => (await readAccountRecords(account.uid)).profile).toMatchObject({
    schemaVersion: 1,
    displayName: 'Local Player',
    onboarding: { version: 1, completedAt: null },
    eeg: { enabled: false, consent: null, preferredDevice: null },
  });

  // The retired role-selection route is gone: it leads home.
  await page.goto('/#/role-selection');
  await arriveAtHome(page);
  await expect(page.getByRole('heading', { name: /^How will you use /, level: 1 })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Practitioner accounts/ })).toHaveCount(0);
});
