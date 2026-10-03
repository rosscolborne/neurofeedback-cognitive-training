import { expect, type Page } from '@playwright/test';
import { consumerHome } from './journeys';

export type AuthenticatedE2EIdentity = {
    uid: string;
    email: string;
    projectId: string;
};

type Credentials = {
    email: string;
    password: string;
};

/** Signs in through the production login form; credentials are never logged. */
export async function loginThroughUi(page: Page, credentials: Credentials): Promise<void> {
    await page.goto('/#/login');
    await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();

    // The login page's visible labels currently have no `for` attributes, so
    // placeholders are the stable, user-visible selectors available to E2E.
    await page.getByPlaceholder('name@example.com', { exact: true }).fill(credentials.email);
    await page.getByPlaceholder('Your password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeHidden({ timeout: 15_000 });
}

/** Uses the normal UI only when a newly signed-up player is shown headset setup. */
export async function skipHeadsetSetupIfPresent(page: Page): Promise<void> {
  const skipToDashboard = page.getByRole('button', { name: 'Skip to Dashboard', exact: true });
  await skipToDashboard.or(consumerHome(page)).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await skipToDashboard.isVisible().catch(() => false)) {
        await skipToDashboard.click();
    }
}

/**
 * Arrives at Home, skipping headset setup if it is shown. After a reload, which
 * keeps the tab the player was on, pass `afterReload` to press Home when the
 * app opened on another tab; otherwise the app must open on Home itself.
 */
export async function arriveAtHome(page: Page, { afterReload = false }: { afterReload?: boolean } = {}): Promise<void> {
    if (!afterReload) {
        await skipHeadsetSetupIfPresent(page);
    } else {
        const skipToDashboard = page.getByRole('button', { name: 'Skip to Dashboard', exact: true });
        const homeTab = page.getByRole('button', { name: 'Home', exact: true });
        await skipToDashboard.or(consumerHome(page)).or(homeTab).first()
          .waitFor({ state: 'visible', timeout: 15_000 });
        if (await skipToDashboard.isVisible().catch(() => false)) {
            await skipToDashboard.click();
        } else if (await homeTab.getAttribute('aria-current').catch(() => null) !== 'page') {
            await homeTab.click();
        }
    }
    await expect(consumerHome(page)).toBeVisible({ timeout: 15_000 });
}

/** Reads only the current Firebase UID from the authenticated app runtime. */
export async function authenticatedUserId(page: Page): Promise<string> {
    return (await authenticatedFirebaseIdentity(page)).uid;
}

/** Reads the minimum identity needed to bind privileged E2E cleanup safely. */
export async function authenticatedFirebaseIdentity(page: Page): Promise<AuthenticatedE2EIdentity> {
    const identity = await page.evaluate(async () => {
        const { auth } = await import('/src/services/firebase.ts');
        await auth.authStateReady();
        return auth.currentUser && auth.currentUser.email && auth.app.options.projectId
            ? { uid: auth.currentUser.uid, email: auth.currentUser.email, projectId: auth.app.options.projectId }
            : null;
    });
    if (!identity) throw new Error('Expected an authenticated Firebase user and project.');
    return identity;
}
