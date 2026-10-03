import { expect, test } from './fixtures';
import {
  completeConsumerOnboarding,
  expectConsumerHome,
  signUpFreshAccountThroughUi,
  type FreshAccount,
} from './helpers/journeys';

// NFCT-44: an onboarded consumer must never be sent back into onboarding
// because their account took a while to load. The inherited lookup gave up
// after 1.8 s and treated the account as new, which put returning users on
// the onboarding screen (it failed main's iOS Simulator relaunch check three
// times in a row). A slow profile read now keeps the loading screen, then
// offers a retry after 15 s; only a server-confirmed missing profile is
// created, so a slow read never replaces the player's profile.

/** Delay every Firestore request made in the first seconds after the reload past the old 1.8 s give-up. */
const SLOW_FIRESTORE_MS = 2_500;
const SLOW_WINDOW_MS = 8_000;

test('an onboarded consumer who reloads while their profile is slow to load is never sent into onboarding', async ({ page }) => {
  const account: FreshAccount = {
    displayName: 'Returning Player',
    email: `returning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: 'LocalEmulator!123',
  };
  await signUpFreshAccountThroughUi(page, account);
  await completeConsumerOnboarding(page);

  // Records whether the reloaded page ever shows onboarding, however briefly.
  await page.addInitScript(() => {
    const seen = { onboarding: false };
    (window as unknown as { __nfctOnboardingSeen: typeof seen }).__nfctOnboardingSeen = seen;
    const check = () => {
      if (location.hash.includes('hardware-setup')
        || document.body?.innerText.includes('Skip to Dashboard')) seen.onboarding = true;
    };
    window.addEventListener('hashchange', check);
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
    check();
  });

  const slowUntil = Date.now() + SLOW_WINDOW_MS;
  let delayed = 0;
  await page.route(/\/google\.firestore\.v1\.Firestore\//, async (route) => {
    if (Date.now() < slowUntil) {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, SLOW_FIRESTORE_MS));
    }
    await route.continue().catch(() => {});
  });

  await page.reload();
  await expectConsumerHome(page, 'A reloaded, onboarded consumer should arrive home');
  expect(delayed, 'The profile read should have been slowed').toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __nfctOnboardingSeen: { onboarding: boolean } }).__nfctOnboardingSeen.onboarding),
    'Onboarding must never appear while the profile is still loading').toBe(false);
  // Still the same profile: the greeting uses the name typed at sign-up.
  await expect(page.getByRole('heading', { level: 1, name: /, Returning\.$/ })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /couldn.t be loaded/ })).toHaveCount(0);
});
