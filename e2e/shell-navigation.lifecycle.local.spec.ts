import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { completeConsumerOnboarding, consumerHome, signUpFreshAccountThroughUi, skipHeadsetSetupButton } from './helpers/journeys';

// The signed-in shell: Home, Train, Progress and Profile each have their own
// address, so a reload or the browser's Back keeps the player where they were,
// and leaving headset setup never leaves it behind in history.

const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function expectTab(page: Page, name: string, hash: RegExp) {
  await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(hash);
}

test('each tab has its own address, which survives a reload and the browser’s Back', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await signUpFreshAccountThroughUi(page, {
      displayName: 'Shell Player',
      email: `shell-nav-${randomUUID().slice(0, 12)}@example.test`,
      password: 'LocalEmulator!123',
    });
    await completeConsumerOnboarding(page);
    await expectTab(page, 'Home', /#\/$/);

    // Back from Home does not reopen the headset setup that onboarding skipped.
    await page.goBack();
    await expect(consumerHome(page)).toBeVisible();
    await expect(skipHeadsetSetupButton(page)).toHaveCount(0);

    await tab(page, 'Train').click();
    await expectTab(page, 'Train', /#\/train$/);
    await tab(page, 'Progress').click();
    await expectTab(page, 'Progress', /#\/progress$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your Progress', exact: true })).toBeVisible();

    await page.reload();
    await expectTab(page, 'Progress', /#\/progress$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Your Progress', exact: true })).toBeVisible();

    await page.goBack();
    await expectTab(page, 'Train', /#\/train$/);
    await page.goForward();
    await expectTab(page, 'Progress', /#\/progress$/);

    // Headset setup from Profile, skipped, lands Home; Back returns to Profile, not to setup.
    await tab(page, 'Profile').click();
    await expectTab(page, 'Profile', /#\/profile$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Profile', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Set Up Headset/ }).click();
    await expect(skipHeadsetSetupButton(page)).toBeVisible();
    await skipHeadsetSetupButton(page).click();
    await expectTab(page, 'Home', /#\/$/);
    await page.goBack();
    await expectTab(page, 'Profile', /#\/profile$/);
    await expect(skipHeadsetSetupButton(page)).toHaveCount(0);

    // An unknown address inside the app goes Home.
    await page.goto('/#/role-selection');
    await expectTab(page, 'Home', /#\/$/);
  } finally {
    await page.close();
  }
});
