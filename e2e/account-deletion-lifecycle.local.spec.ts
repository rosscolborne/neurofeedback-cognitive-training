import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, authenticatedUserId, loginThroughUi } from './helpers/auth';
import { readAccountRecords, seedPlayer, type LocalPlayerFixture } from './helpers/localEmulator';
import { FIRESTORE_CACHE_STATE_KEY } from '../src/services/firestoreCacheLifecycle';

// Role, label and text locators only: Profile layout and classes differ between UI revisions.
const PASSWORD_LABEL = 'Enter your password to confirm account deletion';
const WRONG_PASSWORD = 'WrongLocalPassword!123';

const passwordField = (page: Page) => page.getByLabel(PASSWORD_LABEL);
const deletionForm = (page: Page) => page.locator('form').filter({ has: passwordField(page) });
const confirmButton = (page: Page) => page.getByRole('button', { name: 'Confirm account deletion' });
const deletingStatus = (page: Page) => page.getByRole('status').filter({ hasText: 'Deleting your account…' });

/** The deletion flow is entirely in-app; any browser dialog is a regression. */
function recordBrowserDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return dialogs;
}

/**
 * Records whether the password field renders at any point after the deletion
 * form is submitted, however briefly, until the page unloads.
 */
async function recordTeardownRenders(page: Page): Promise<string[]> {
  const renders: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('account-deletion-teardown:')) renders.push(text);
  });
  await page.evaluate(() => {
    let submitted = false;
    const check = () => {
      if (!submitted) return;
      if (document.getElementById('account-deletion-password')) console.log('account-deletion-teardown: password field rendered');
    };
    document.addEventListener('submit', () => { submitted = true; requestAnimationFrame(check); }, true);
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  return renders;
}

/** Holds the final Auth account deletion request until released, so the post-cleanup state can be inspected. */
async function holdAuthAccountDeletion(page: Page) {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/accounts:delete\b/, async (route) => {
    markHeld();
    await released;
    await route.continue();
  });
  return { held, release };
}

async function expectSignInRejected(page: Page, credentials: LocalPlayerFixture['player']) {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();
  await page.getByPlaceholder('name@example.com', { exact: true }).fill(credentials.email);
  await page.getByPlaceholder('Your password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByText('Incorrect email or password. Please check your credentials and try again.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();
}

async function openProfileDeletion(page: Page, fixture: LocalPlayerFixture) {
  await loginThroughUi(page, fixture.player);
  await arriveAtHome(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Account' }).click();
}

test('Delete Account opens an in-app step with no browser dialog, and Cancel closes it and clears the password', async ({ page }) => {
  const fixture = await seedPlayer();
  const dialogs = recordBrowserDialogs(page);
  await openProfileDeletion(page, fixture);

  await expect(passwordField(page)).toBeVisible();
  await expect(passwordField(page)).toBeFocused();
  await expect(deletionForm(page)).toContainText('This action cannot be undone.');
  await expect(confirmButton(page)).toBeDisabled();
  expect(dialogs).toEqual([]);

  await passwordField(page).fill('Half-Typed-Password');
  await expect(confirmButton(page)).toBeEnabled();
  await deletionForm(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(passwordField(page)).toHaveCount(0);
  await expect(confirmButton(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete Account' }).click();
  await expect(passwordField(page)).toHaveValue('');

  // Cancel also clears a previous error before the step is reopened.
  await passwordField(page).fill(WRONG_PASSWORD);
  await confirmButton(page).click();
  await expect(deletionForm(page).getByRole('alert')).toHaveText('Incorrect password. Please try again.');
  await deletionForm(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Account' }).click();
  await expect(passwordField(page)).toHaveValue('');
  await expect(deletionForm(page).getByRole('alert')).toHaveCount(0);

  expect(dialogs).toEqual([]);
  expect(await authenticatedUserId(page)).toBe(fixture.player.uid);
});

test('successful deletion holds a pending status instead of the password form, lands on /welcome, and ends the old sign-in', async ({ page }) => {
  const fixture = await seedPlayer();
  const dialogs = recordBrowserDialogs(page);
  await openProfileDeletion(page, fixture);
  await passwordField(page).fill(fixture.player.password);

  const authDeletion = await holdAuthAccountDeletion(page);
  const teardownRenders = await recordTeardownRenders(page);
  await confirmButton(page).click();
  await expect(deletingStatus(page)).toBeVisible();

  // The server has accepted the profile deletion before the Auth account is
  // deleted: only the Auth deletion is outstanding, and the masked field
  // never flashes back.
  await authDeletion.held;
  expect(await readAccountRecords(fixture.player.uid)).toEqual({ profile: undefined, authExists: true });
  await expect(deletingStatus(page)).toBeVisible();
  await expect(passwordField(page)).toHaveCount(0);
  await expect(confirmButton(page)).toHaveCount(0);

  authDeletion.release();
  await expect(page).toHaveURL(/\/welcome/, { timeout: 20_000 });
  expect(teardownRenders).toEqual([]);
  expect(dialogs).toEqual([]);

  // The deleted account's cached documents left this device with it (NFCT-20).
  expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key) ?? 'null', FIRESTORE_CACHE_STATE_KEY))).toEqual({ v: 1, owner: null });
  const scan = await page.evaluate(async (needles) => (await import('/e2e/helpers/cacheIsolation.ts')).scanFirestoreIndexedDb(needles), [fixture.player.uid, fixture.name]);
  expect(scan.hits).toEqual({ [fixture.player.uid]: {}, [fixture.name]: {} });

  expect(await readAccountRecords(fixture.player.uid)).toEqual({ profile: undefined, authExists: false });
  await expectSignInRejected(page, fixture.player);
});

test('a failed Auth deletion keeps the player signed in with a readable error, and trying again finishes it', async ({ page }) => {
  const fixture = await seedPlayer();
  const dialogs = recordBrowserDialogs(page);
  await openProfileDeletion(page, fixture);

  // The profile is deleted, then the Auth deletion cannot reach the server.
  await page.route(/\/accounts:delete\b/, (route) => route.abort('internetdisconnected'));
  await passwordField(page).fill(fixture.player.password);
  await confirmButton(page).click();
  const error = deletionForm(page).getByRole('alert');
  await expect(error).toHaveText('Unable to connect. Check your internet connection and try again.');
  await expect(error).not.toContainText('auth/');
  await expect(passwordField(page)).toHaveValue('');
  expect(await authenticatedUserId(page)).toBe(fixture.player.uid);
  expect(await readAccountRecords(fixture.player.uid)).toEqual({ profile: undefined, authExists: true });

  // Trying again repeats both steps; deleting the already-deleted profile is harmless.
  await page.unroute(/\/accounts:delete\b/);
  await passwordField(page).fill(fixture.player.password);
  await confirmButton(page).click();
  await expect(page).toHaveURL(/\/welcome/, { timeout: 20_000 });
  expect(dialogs).toEqual([]);

  expect(await readAccountRecords(fixture.player.uid)).toEqual({ profile: undefined, authExists: false });
  await expectSignInRejected(page, fixture.player);
});
