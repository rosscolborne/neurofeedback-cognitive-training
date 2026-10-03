import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome, loginThroughUi } from './helpers/auth';
import { readAccountRecords, seedAccountWithProfileShape, type ShapedAccount } from './helpers/localEmulator';
import { PROFILE_SHAPE_NAMES, PROFILE_SHAPES } from '../shared/__tests__/profileShapes';

// Existing accounts, one per historical shape of the profile document
// (users/{uid}, shared/__tests__/profileShapes.ts). Every new-account test
// writes the current shape; a real account may hold an older or a newer one.
// Each test signs in, relaunches, signs out and signs in again, as a returning
// player does: a readable profile opens the account each time; an unreadable
// one says this version cannot open it, does not blame the connection, offers
// only sign-out, and is never overwritten.

const accountUnreadable = (page: Page) => page.getByRole('alert').filter({ hasText: 'This version of the app can’t open your account.' });
const welcome = (page: Page) => page.getByRole('button', { name: 'Begin Journey' });

async function expectAccountOpens(page: Page, account: ShapedAccount, { afterReload = false } = {}): Promise<void> {
  await arriveAtHome(page, { afterReload });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(account.displayName.split(' ')[0]!);
}

async function expectAccountUnreadable(page: Page): Promise<void> {
  await expect(accountUnreadable(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Check your internet connection', { exact: false })).toHaveCount(0);
  // Trying again cannot help, so it is not offered.
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
}

for (const shape of PROFILE_SHAPE_NAMES) {
  const { appReads, description } = PROFILE_SHAPES[shape];

  test(`an existing account with the ${shape} profile shape signs in, relaunches, signs out and signs in again`, async ({ page }) => {
    test.info().annotations.push({ type: 'profile shape', description });
    const account = await seedAccountWithProfileShape(shape);
    const stored = (await readAccountRecords(account.uid)).profile;

    await test.step('sign in, then relaunch from the persisted session', async () => {
      await loginThroughUi(page, account);
      if (appReads === 'readable') await expectAccountOpens(page, account);
      else await expectAccountUnreadable(page);
      await page.reload();
      if (appReads === 'readable') await expectAccountOpens(page, account, { afterReload: true });
      else await expectAccountUnreadable(page);
    });

    await test.step('sign out to the Welcome screen', async () => {
      if (appReads === 'readable') {
        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByRole('button', { name: 'Log Out' }).click();
      } else {
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      }
      await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await expect(welcome(page)).toBeVisible({ timeout: 30_000 });
    });

    await test.step('sign in again with the same credentials', async () => {
      await loginThroughUi(page, account);
      if (appReads === 'readable') await expectAccountOpens(page, account);
      else await expectAccountUnreadable(page);
    });

    const after = (await readAccountRecords(account.uid)).profile;
    if (appReads === 'readable') {
      expect(after).toMatchObject({ schemaVersion: 1, displayName: account.displayName });
    } else {
      expect(after, 'The app must never overwrite a profile it cannot read').toEqual(stored);
    }
  });
}
