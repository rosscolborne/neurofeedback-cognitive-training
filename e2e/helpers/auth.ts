import { expect, type Page } from '@playwright/test';

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

/** Uses the normal UI only when a newly configured patient is shown headset setup. */
export async function skipHeadsetSetupIfPresent(page: Page): Promise<void> {
  const skipToDashboard = page.getByRole('button', { name: 'Skip to Dashboard', exact: true });
  await skipToDashboard.or(page.getByText('Training Session', { exact: true })).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (await skipToDashboard.isVisible().catch(() => false)) {
        await skipToDashboard.click();
    }
}

export async function arriveAtPatientDashboard(page: Page): Promise<void> {
    await skipHeadsetSetupIfPresent(page);
    await expect(page.getByText('Training Session', { exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * Starts a patient experience through the dashboard and uses the supported
 * Demo Mode only if the connection prompt is displayed. This does not test
 * physical Muse hardware, Bluetooth, or live EEG acquisition.
 */
export async function startPatientTrainingInDemoMode(page: Page, experienceName?: string): Promise<void> {
    await arriveAtPatientDashboard(page);

    if (experienceName) {
        await page.getByRole('button', { name: 'Train', exact: true }).click();
        const experience = page.locator('.card-patient').filter({ hasText: experienceName }).first();
        await expect(experience).toBeVisible();
        await experience.click();
    } else {
        await page.getByRole('button', { name: 'Begin Session', exact: true }).click();
    }

    const demoMode = page.getByRole('button', { name: 'Try Demo Mode', exact: true });
    if (await demoMode.isVisible().catch(() => false)) {
        await demoMode.click();
    }

    // The Demo session starts straight away: NeuroGambit has no calibration step.
    await expect(page.getByRole('region', { name: 'Demo state controls' })).toBeVisible();
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
