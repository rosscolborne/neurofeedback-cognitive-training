import { expect, type Page } from '@playwright/test';

// Critical consumer journeys through the real UI, from a real entry state.
// The nfct-dev canary (e2e/canary) and its emulator rehearsal use them; new
// emulator specs of these journeys should too, so the canary and the
// deterministic tests drive the same screens the same way.
// Role, label and text locators only; update these helpers when the
// onboarding, Home or Train screens change, along with the Simulator scenarios
// (scripts/ios/simulator-scenarios.mjs).
// Nothing here may import the emulator helpers (localEmulator.ts) or the
// Admin SDK: the canary runs these helpers against a real project.

export type FreshAccount = {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
};

/** Headset setup's way past it: setup is optional, and sign-up offers it first. */
export const skipHeadsetSetupButton = (page: Page) => page.getByRole('button', { name: 'Skip to Dashboard', exact: true });

/** The signed-in consumer home: its primary action, playing a game (NFCT-13's games-first Home). */
export const consumerHome = (page: Page) => page.getByRole('button', { name: 'Play Mental Math', exact: true });

/**
 * Starts signed out at `/`, opens Create Account from the Welcome screen and
 * creates the account, arriving at the optional headset setup. The app leaves
 * its loading screen only once the server has accepted the new player's
 * profile (users/{uid}), the account's first Firestore write: when deployed
 * rules denied the first write (TestFlight, 2026-10-02), the account went
 * nowhere with no message. Here that shows as "Your account couldn’t be loaded."
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

  await expect(skipHeadsetSetupButton(page), 'Creating the account should save its profile and reach headset setup').toBeVisible({ timeout: 20_000 });
}

/**
 * After sign-up, skips the optional headset setup and arrives at the home
 * screen. There is one kind of account: nothing asks what it is for.
 */
export async function completeConsumerOnboarding(page: Page): Promise<void> {
  await expect(skipHeadsetSetupButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /practitioner|clinician|account type/i })).toHaveCount(0);
  await skipHeadsetSetupButton(page).click();
  await expect(consumerHome(page), 'Skipping headset setup should arrive home').toBeVisible({ timeout: 15_000 });
}

/**
 * The signed-in consumer arrives home, skipping the optional headset setup if
 * it is shown.
 */
export async function expectConsumerHome(page: Page, message = 'The signed-in consumer should arrive home'): Promise<void> {
  const skipHeadsetSetup = skipHeadsetSetupButton(page);
  await expect(skipHeadsetSetup.or(consumerHome(page)).first(), message).toBeVisible({ timeout: 20_000 });
  if (await skipHeadsetSetup.isVisible()) await skipHeadsetSetup.click();
  await expect(consumerHome(page), message).toBeVisible({ timeout: 15_000 });
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
 * acknowledged the write, so no whole run is needed.
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
