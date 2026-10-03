import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard } from './helpers/auth';

// NFCT-12: the Train tab is a game catalogue built from the code-owned shared
// catalogue. Games come first, each filed under its domains; NeuroGambit, the
// one EEG experience, follows in its own optional "Headset training" section
// and keeps its launch path. Also runs in WebKit as an iPhone SE and an
// iPhone 17 (playwright.webkit.config.ts), where the card layout matters most.

async function signUpAndOpenTrain(page: Page): Promise<void> {
  await page.goto('/#/signup');
  await page.getByPlaceholder('How should we call you?').fill('Train Catalogue');
  await page.getByPlaceholder('you@example.com').fill(`train-catalogue-${randomUUID().slice(0, 12)}@example.test`);
  await page.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.getByRole('button', { name: /Train my brain/ }).click();
  await arriveAtPatientDashboard(page);
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Train', exact: true })).toBeVisible();
}

const gamesSection = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Games', exact: true });
const headsetSection = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Headset training', exact: true });

/** The card's icon sits beside its name, and the whole card is a comfortable target. */
async function expectRowCard(button: Locator): Promise<void> {
  const card = button.locator('xpath=ancestor::li[1]');
  const [icon, name, box] = await Promise.all([
    card.locator('.train-card-icon').boundingBox(),
    button.boundingBox(),
    card.boundingBox(),
  ]);
  expect(icon && name && box).toBeTruthy();
  expect(icon!.x + icon!.width).toBeLessThanOrEqual(name!.x);
  expect(Math.abs(icon!.y - name!.y)).toBeLessThan(icon!.height);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test('Train lists games first, filed under their domains, and NeuroGambit after them as optional headset training', async ({ page }) => {
  await signUpAndOpenTrain(page);
  const games = gamesSection(page);
  const headset = headsetSection(page);

  await expect(games.getByRole('listitem')).toHaveCount(1);
  const mentalMath = games.getByRole('button', { name: 'Mental Math', exact: true });
  await expect(mentalMath).toBeVisible();
  await expect(mentalMath).toHaveAccessibleDescription(
    /^Quick arithmetic that adapts to you as you play\.\s+Domains:\s*Math\s*,\s*Processing speed\s*,\s*Memory\s+90 seconds\s*,\s*10 levels$/,
  );
  // Each chip but the last also holds a visually hidden comma for screen readers.
  await expect(games.locator('.train-card-tag')).toHaveText([/^Math,?$/, /^Processing speed,?$/, /^Memory$/]);
  await expect(games.getByText(/^90 seconds,?$/)).toBeVisible();
  await expect(games.getByText(/^10 levels,?$/)).toBeVisible();
  await expect(games.getByText('NeuroGambit')).toHaveCount(0);

  await expect(headset.getByText('Optional', { exact: true })).toBeVisible();
  await expect(headset.getByRole('listitem')).toHaveCount(1);
  await expect(headset.getByRole('button', { name: 'NeuroGambit', exact: true })).toBeVisible();
  await expect(headset.getByText('Muse headset or Demo Mode', { exact: true })).toBeVisible();
  await expect(headset.getByText('Mental Math')).toHaveCount(0);
  const [gamesBox, headsetBox] = await Promise.all([games.boundingBox(), headset.boundingBox()]);
  expect(gamesBox!.y + gamesBox!.height).toBeLessThanOrEqual(headsetBox!.y);

  // One row layout at every width (NFCT-33: the Mental Math card used to stack below 420 px).
  await expectRowCard(mentalMath);
  await expectRowCard(headset.getByRole('button', { name: 'NeuroGambit', exact: true }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Train opens Mental Math and NeuroGambit through their own paths, and Back returns to Train', async ({ page }) => {
  await signUpAndOpenTrain(page);

  await gamesSection(page).getByRole('button', { name: 'Mental Math', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(gamesSection(page).getByRole('button', { name: 'Mental Math', exact: true })).toBeVisible();

  // NeuroGambit keeps its headset launch path: connect a Muse, or try Demo Mode.
  await headsetSection(page).getByRole('button', { name: 'NeuroGambit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect Muse Headband', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Demo Mode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel & Return to Dashboard', exact: true }).click();
  await expect(headsetSection(page).getByRole('button', { name: 'NeuroGambit', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Train', exact: true })).toBeVisible();
});
