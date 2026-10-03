import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtHome } from './helpers/auth';

// NFCT-12: the Train tab is a game catalogue built from the code-owned shared
// catalogue, each game showing what it trains as percentages of its domain
// weights (NFCT-65). Also runs in WebKit as an iPhone SE and an iPhone 17 (playwright.webkit.config.ts), where the card
// layout matters most.

async function signUpAndOpenTrain(page: Page): Promise<void> {
  await page.goto('/#/signup');
  await page.getByPlaceholder('How should we call you?').fill('Train Catalogue');
  await page.getByPlaceholder('you@example.com').fill(`train-catalogue-${randomUUID().slice(0, 12)}@example.test`);
  await page.getByPlaceholder('At least 6 characters').fill('LocalEmulator!123');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await arriveAtHome(page);
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Train', exact: true })).toBeVisible();
}

const gamesSection = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Games', exact: true });

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

test('Train lists the games, with what each trains, and nothing else', async ({ page }) => {
  await signUpAndOpenTrain(page);
  const games = gamesSection(page);

  await expect(games.getByRole('listitem')).toHaveCount(1);
  const mentalMath = games.getByRole('button', { name: 'Mental Math', exact: true });
  await expect(mentalMath).toBeVisible();
  await expect(mentalMath).toHaveAccessibleDescription(
    /^Quick arithmetic that adapts to you as you play\.\s+Trains\s*:\s*Math 70%\s*,\s*Processing speed 20%\s*,\s*Memory 10%\s+Up to 3 minutes\s*,\s*10 levels$/,
  );
  // Mental Math's real mix, as text (each item but the last also holds a
  // visually hidden comma for screen readers), beside a bar split the same way.
  const mix = games.locator('.train-card-mix');
  // The title also holds a visually hidden colon.
  await expect(mix.locator('.train-card-mix-title')).toBeVisible();
  await expect(mix.locator('.train-card-mix-title')).toHaveText(/^Trains:?\s*$/);
  await expect(mix.locator('.train-card-mix-item')).toHaveText([/^Math 70%,?$/, /^Processing speed 20%,?$/, /^Memory 10%$/]);
  const segments = await mix.locator('.train-card-mix-segment').evaluateAll(
    (nodes) => nodes.map((node) => node.getBoundingClientRect().width),
  );
  expect(segments).toHaveLength(3);
  expect(segments[0]!).toBeGreaterThan(segments[1]!);
  expect(segments[1]!).toBeGreaterThan(segments[2]!);
  const mentalMathCard = mentalMath.locator('xpath=ancestor::li[1]');
  await expect(mentalMathCard.getByText(/^Up to 3 minutes,?$/)).toBeVisible();
  await expect(mentalMathCard.getByText(/^10 levels,?$/)).toBeVisible();
  // Mental Math never needs a headset, so its card says nothing about one.
  await expect(mentalMathCard.getByText(/headset/i)).toHaveCount(0);
  // The Games section is the whole catalogue: no headset training section or experience.
  await expect(page.getByRole('main').getByRole('region')).toHaveCount(1);
  await expect(page.getByRole('main')).not.toContainText(/NeuroGambit|Headset training/);

  // One row layout at every width (NFCT-33: the Mental Math card used to stack below 420 px).
  await expectRowCard(mentalMath);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Train opens Mental Math, and Back returns to Train', async ({ page }) => {
  await signUpAndOpenTrain(page);

  await gamesSection(page).getByRole('button', { name: 'Mental Math', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mental Math', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(gamesSection(page).getByRole('button', { name: 'Mental Math', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Train', exact: true })).toBeVisible();
});
