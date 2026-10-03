import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { completeConsumerOnboarding, consumerHome, signUpFreshAccountThroughUi } from './helpers/journeys';
import { readAccountRecords, seedPlayer } from './helpers/localEmulator';

// Phase 2 account flows when the connection to Firestore drops, and long
// names on a small phone. Firestore is cut off by aborting the page's
// requests to its emulator; Firebase Auth stays reachable.

const FIRESTORE = 'http://127.0.0.1:8080/**';
const cutFirestore = (page: Page) => page.route(FIRESTORE, (route) => route.abort());
const restoreFirestore = (page: Page) => page.unroute(FIRESTORE);
const accountUnavailable = (page: Page) => page.getByRole('alert').filter({ hasText: 'Your account couldn’t be loaded.' });

async function openProfile(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Account' })).toBeVisible();
}

test('a deletion that cannot reach the server deletes nothing, and the account is intact after a relaunch', async ({ page }) => {
  test.setTimeout(150_000);
  const { player, name } = await seedPlayer();
  await loginThroughUi(page, player);
  await arriveAtHome(page);
  await openProfile(page);
  await page.getByRole('button', { name: 'Delete Account' }).click();
  await page.locator('#account-deletion-password').fill(player.password);

  await cutFirestore(page);
  await page.getByRole('button', { name: 'Confirm account deletion' }).click();
  // The profile deletion is never queued for later: offline it fails and says so.
  await expect(page.locator('#account-deletion-error')).toHaveText('Unable to connect. Check your internet connection and try again.', { timeout: 90_000 });

  // Relaunch once the connection is back: the same account, with its own profile.
  await restoreFirestore(page);
  await page.reload();
  await arriveAtHome(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name.split(' ')[0]);
  const records = await readAccountRecords(player.uid);
  expect(records.authExists).toBe(true);
  expect(records.profile?.displayName).toBe(name);
});

test('the name typed at sign-up survives a relaunch before the profile could be created', async ({ page }) => {
  test.setTimeout(150_000);
  const id = randomUUID().slice(0, 8);
  const account = { displayName: `Dorothy Vaughan ${id}`, email: `resilience-${id}@example.test`, password: 'LocalEmulator!123' };

  await cutFirestore(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Begin Journey' }).click();
  await page.getByPlaceholder('How should we call you?', { exact: true }).fill(account.displayName);
  await page.getByPlaceholder('you@example.com', { exact: true }).fill(account.email);
  await page.getByPlaceholder('At least 6 characters', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  // The Auth account exists, but its profile could not be read or created.
  await expect(accountUnavailable(page)).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await restoreFirestore(page);
  await expect(page.getByRole('button', { name: 'Skip to Dashboard' }).or(consumerHome(page)).first()).toBeVisible({ timeout: 60_000 });
  await arriveAtHome(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Dorothy');
});

test.describe('a long one-word name on a small phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('wraps on Home and Profile instead of widening the page', async ({ page }) => {
    const id = randomUUID().replace(/-/g, '').slice(0, 8);
    const longName = `Maximiliana${id}Bartholomewsdottirsson`.slice(0, 40);
    await signUpFreshAccountThroughUi(page, { displayName: longName, email: `long-${id}@example.test`, password: 'LocalEmulator!123' });
    await completeConsumerOnboarding(page);

    const pageWidth = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    let width = await pageWidth();
    expect(width.scroll, 'Home').toBeLessThanOrEqual(width.viewport);
    await openProfile(page);
    width = await pageWidth();
    expect(width.scroll, 'Profile').toBeLessThanOrEqual(width.viewport);
    await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeInViewport();
  });
});
