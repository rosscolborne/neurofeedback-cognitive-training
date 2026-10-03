import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { completeConsumerOnboarding, consumerHome, signUpFreshAccountThroughUi } from './helpers/journeys';

// The consumer EEG boundary: there are no EEG protocols, reward bands,
// calibration or neurofeedback training anywhere in the app. EEG is headset
// pairing and fit, plus optional capture during a game.

async function signUpFreshConsumer(page: Page, prefix: string) {
  await signUpFreshAccountThroughUi(page, {
    displayName: 'Consumer EEG',
    email: `${prefix}-${randomUUID().slice(0, 12)}@example.test`,
    password: 'LocalEmulator!123',
  });
  await completeConsumerOnboarding(page);
}

/** EEG-protocol and calibration language that must not reach a consumer screen. */
const PROTOCOL_TERMS = /protocol|theta|beta|alpha|SMR|in zone|target zone|reward|calibrat|neural imprint|baseline|neurofeedback|NeuroGambit/i;

test('a fresh consumer sees no EEG protocol, calibration or neurofeedback training, and headset setup is pairing and fit only', async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await signUpFreshConsumer(page, 'consumer-eeg-setup');

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(consumerHome(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Protocol:/ })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(PROTOCOL_TERMS);

    for (const tab of ['Train', 'Progress']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: tab === 'Train' ? 'Train' : 'Your Progress', exact: true })).toBeVisible();
      await expect(page.locator('main')).not.toContainText(PROTOCOL_TERMS);
    }

    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Neural Imprint' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View Protocol Details' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change Training Setup' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(PROTOCOL_TERMS);

    // Headset setup pairs and checks fit; there is no calibration to run.
    await page.getByRole('button', { name: /Set Up Headset/ }).click();
    await expect(page.getByRole('heading', { name: 'Connect your Muse Headband', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pair Muse Headband' })).toBeEnabled();
    await expect(page.locator('body')).not.toContainText(PROTOCOL_TERMS);
    await page.getByRole('button', { name: 'Skip to Dashboard', exact: true }).click();
    await expect(consumerHome(page)).toBeVisible();
  } finally {
    await page.close();
  }
});
