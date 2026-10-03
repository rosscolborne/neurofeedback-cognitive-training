import { expect, test } from './fixtures';
import { arriveAtHome, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { completeConsumerOnboarding, signUpFreshAccountThroughUi } from './helpers/journeys';
import { readAccountRecords, seedPlayer } from './helpers/localEmulator';

test('delete a player, re-register the same email, and the new account cannot read the old one', async ({ browser, permissionErrorGuard }) => {
  const fixture = await seedPlayer();
  const oldContext = await browser.newContext();
  const newContext = await browser.newContext();
  try {
    const oldPlayer = await oldContext.newPage();
    await loginThroughUi(oldPlayer, fixture.player);
    await arriveAtHome(oldPlayer);
    await oldPlayer.getByRole('button', { name: 'Profile', exact: true }).click();
    await oldPlayer.getByRole('button', { name: 'Delete Account' }).click();
    await oldPlayer.getByLabel('Enter your password to confirm account deletion').fill(fixture.player.password);
    await oldPlayer.getByRole('button', { name: 'Confirm account deletion' }).click();
    await expect(oldPlayer).toHaveURL(/welcome/, { timeout: 20_000 });
    expect(await readAccountRecords(fixture.player.uid)).toEqual({ profile: undefined, authExists: false });

    const player = await newContext.newPage();
    await signUpFreshAccountThroughUi(player, { displayName: fixture.name, ...fixture.player });
    await completeConsumerOnboarding(player);
    const newUid = await authenticatedUserId(player);
    expect(newUid).not.toBe(fixture.player.uid);

    // The new account gets a fresh consumer profile of its own.
    const created = await readAccountRecords(newUid);
    expect(created.authExists).toBe(true);
    expect(created.profile).toMatchObject({ schemaVersion: 1, displayName: fixture.name, eeg: { consent: null } });
    permissionErrorGuard.expectDenialsIn(newContext);
    const oldRead = await player.evaluate(async ({ oldUid }) => {
      const { probeDeletedPlayerData } = await import('/e2e/helpers/firestoreProbe.ts');
      return probeDeletedPlayerData(oldUid);
    }, { oldUid: fixture.player.uid });
    expect(oldRead).toEqual({ profile: 'permission-denied', gameSessions: 'permission-denied' });
  } finally {
    await Promise.allSettled([oldContext.close(), newContext.close()]);
  }
});

test('wrong deletion password keeps the account and profile intact', async ({ browser }) => {
  const fixture = await seedPlayer();
  const playerContext = await browser.newContext();
  try {
    const player = await playerContext.newPage();
    await loginThroughUi(player, fixture.player);
    await arriveAtHome(player);
    await player.getByRole('button', { name: 'Profile', exact: true }).click();
    await player.getByRole('button', { name: 'Delete Account' }).click();
    const deletionPassword = player.getByLabel('Enter your password to confirm account deletion');
    const confirmDeletion = player.getByRole('button', { name: 'Confirm account deletion' });
    await deletionPassword.fill('WrongLocalPassword!123');
    await confirmDeletion.click();
    const deletionError = player.locator('form').filter({ has: deletionPassword }).getByRole('alert');
    await expect(deletionError).toHaveText('Incorrect password. Please try again.');
    await expect(deletionError).not.toContainText('auth/');
    await expect(deletionError).not.toContainText('Firebase');
    // The form stays usable for another attempt, starting from an empty field.
    await expect(deletionPassword).toHaveValue('');
    await expect(deletionPassword).toBeEditable();
    await expect(confirmDeletion).toBeDisabled();
    await deletionPassword.fill('AnotherAttempt!123');
    await expect(confirmDeletion).toBeEnabled();
    expect(await authenticatedUserId(player)).toBe(fixture.player.uid);
    await player.reload();
    await arriveAtHome(player);
    await player.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(player.getByText(fixture.player.email)).toBeVisible();
    const stored = await readAccountRecords(fixture.player.uid);
    expect(stored.authExists).toBe(true);
    expect(stored.profile).toMatchObject({ schemaVersion: 1, displayName: fixture.name });
  } finally {
    await playerContext.close();
  }
});
