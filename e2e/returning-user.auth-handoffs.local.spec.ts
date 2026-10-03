import { expect, test } from './fixtures';
import {
  completeConsumerOnboarding,
  expectConsumerHome,
  signUpFreshAccountThroughUi,
  type FreshAccount,
} from './helpers/journeys';

// NFCT-44: an onboarded consumer must never be sent back to role selection
// because their role took a while to load. The inherited lookup gave up after
// 1.8 s and treated the account as having no role, which put returning users
// on the onboarding screen (it failed main's iOS Simulator relaunch check
// three times in a row). A slow read now keeps the loading screen, then offers
// a retry after 15 s; only a server-confirmed missing role means onboarding.

/** Delay every Firestore request made in the first seconds after the reload past the old 1.8 s give-up. */
const SLOW_FIRESTORE_MS = 2_500;
const SLOW_WINDOW_MS = 8_000;

test('an onboarded consumer who reloads while their role is slow to load is never sent to role selection', async ({ page }) => {
  const account: FreshAccount = {
    displayName: 'Returning Player',
    email: `returning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: 'LocalEmulator!123',
  };
  await signUpFreshAccountThroughUi(page, account);
  await completeConsumerOnboarding(page);

  // Records whether the reloaded page ever shows role selection, however briefly.
  await page.addInitScript(() => {
    const seen = { roleSelection: false };
    (window as unknown as { __nfctRoleSelectionSeen: typeof seen }).__nfctRoleSelectionSeen = seen;
    const check = () => {
      if (location.hash.includes('role-selection')
        || /^How will you use /.test(document.querySelector('h1')?.textContent ?? '')) seen.roleSelection = true;
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
  expect(delayed, 'The role read should have been slowed').toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { __nfctRoleSelectionSeen: { roleSelection: boolean } }).__nfctRoleSelectionSeen.roleSelection),
    'Role selection must never appear while the role is still loading').toBe(false);
  await expect(page.getByRole('alert').filter({ hasText: /couldn.t be loaded/ })).toHaveCount(0);
});
