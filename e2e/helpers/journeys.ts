import { expect, type Page } from '@playwright/test';

// Critical consumer journeys through the real UI, from a real entry state.
// Shared by the emulator suites and the nfct-dev canary (e2e/canary), so the
// canary and the deterministic tests drive the same screens the same way.
// Role, label and text locators only; update these helpers when the
// onboarding or Train screens change, along with scripts/ios/simulator-probe.js.
// Nothing here may import the emulator helpers (localEmulator.ts) or the
// Admin SDK: the canary runs these helpers against a real project.

export type FreshAccount = {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
};

/** The role-selection screen's title; its product name changes with branding. */
export const roleSelectionHeading = (page: Page) => page.getByRole('heading', { name: /^How will you use /, level: 1 });

/** The signed-in consumer home (the patient dashboard). */
export const consumerHome = (page: Page) => page.getByText('Training Session', { exact: true });

/**
 * Starts signed out at `/`, opens Create Account from the Welcome screen and
 * creates the account. Creating it is Firebase Auth only; Firestore rules do
 * not govern it, so reaching role selection proves nothing about Firestore.
 */
export async function signUpFreshAccountThroughUi(page: Page, account: FreshAccount): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^Welcome to your\s*brain training journey$/, level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Begin Journey' }).click();

  await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
  await page.getByPlaceholder('How should we call you?', { exact: true }).fill(account.displayName);
  await page.getByPlaceholder('you@example.com', { exact: true }).fill(account.email);
  await page.getByPlaceholder('At least 6 characters', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();

  await expect(roleSelectionHeading(page), 'Creating the account should reach role selection').toBeVisible({ timeout: 20_000 });
}

/**
 * From role selection, takes the consumer path ("Train my brain") and arrives
 * at the home screen. The role choice is the account's first Firestore write
 * that the user waits on: when the deployed rules denied it (TestFlight,
 * 2026-10-02), the app returned to role selection with no message.
 */
export async function completeConsumerOnboarding(page: Page): Promise<void> {
  await expect(roleSelectionHeading(page)).toBeVisible();
  // NFCT-4 removes the practitioner choice from consumer onboarding. Once it
  // lands, assert here that no practitioner or clinician option is offered.
  await page.getByRole('button', { name: /Train my brain/ }).click();
  await expectConsumerHome(page, 'Choosing "Train my brain" should save the role and leave role selection');
}

/**
 * The signed-in consumer arrives home, skipping the optional headset setup if
 * it is shown, and is not sent back to role selection.
 */
export async function expectConsumerHome(page: Page, message = 'The signed-in consumer should arrive home'): Promise<void> {
  const skipHeadsetSetup = page.getByRole('button', { name: 'Skip to Dashboard', exact: true });
  await expect(skipHeadsetSetup.or(consumerHome(page)).first(), message).toBeVisible({ timeout: 20_000 });
  if (await skipHeadsetSetup.isVisible()) await skipHeadsetSetup.click();
  await expect(consumerHome(page), message).toBeVisible({ timeout: 15_000 });
  await expect(roleSelectionHeading(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/role-selection/);
}

/** Opens a game through the user-facing entry point: the Train tab, then the game. */
export async function openGameFromTrain(page: Page, gameName: string): Promise<void> {
  await page.getByRole('button', { name: 'Train', exact: true }).click();
  await page.getByRole('button', { name: gameName, exact: true }).click();
  await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
}

/**
 * Mental Math's start screen once the player's progress and recent sessions
 * have loaded from the server. A failed read (denied by the rules, or a
 * missing composite index, which only a real project enforces) still offers
 * level 1, so the button alone proves nothing: the help text tells them apart.
 */
export async function expectMentalMathReadyForNewPlayer(page: Page): Promise<void> {
  const help = page.locator('#mm-levels-help');
  await expect(help, 'Mental Math should load the player\'s progress and recent sessions')
    .toHaveText('Reach higher levels during a run to unlock higher start levels.', { timeout: 20_000 });
  await expect(page.getByRole('radio', { name: 'Level 1', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Start at level 1', exact: true })).toBeEnabled();
}

/**
 * Starts a Mental Math run, pauses it and quits. Quitting saves the run as
 * unfinished; the handoff says it is saved only once the server has
 * acknowledged the write, so no 90-second run is needed.
 */
export async function startPauseAndQuitMentalMathRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start at level 1', exact: true }).click();
  await expect(page.locator('[data-hud="level"]')).toHaveText('1');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quit run', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run ended early', exact: true })).toBeVisible();
  await expect(page.locator('.mm-save'), 'The quit run should be saved to the account')
    .toHaveText('Run saved to your account.', { timeout: 20_000 });
}
