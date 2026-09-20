import { expect, type Page } from '@playwright/test';

export type E2ERole = 'patient' | 'clinician';

type Credentials = {
    email: string;
    password: string;
};

const requiredEnvironment: Record<E2ERole, readonly [string, string]> = {
    patient: ['E2E_PATIENT_EMAIL', 'E2E_PATIENT_PASSWORD'],
    clinician: ['E2E_CLINICIAN_EMAIL', 'E2E_CLINICIAN_PASSWORD'],
};

export function credentialsFor(role: E2ERole): Credentials | undefined {
    const [emailVariable, passwordVariable] = requiredEnvironment[role];
    const email = process.env[emailVariable];
    const password = process.env[passwordVariable];

    return email && password ? { email, password } : undefined;
}

export function missingCredentialVariables(role: E2ERole): readonly string[] {
    return requiredEnvironment[role].filter((name) => !process.env[name]);
}

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
        await page.getByRole('button', { name: 'Begin 25-Min Session', exact: true }).click();
    }

    const demoMode = page.getByRole('button', { name: 'Try Demo Mode', exact: true });
    if (await demoMode.isVisible().catch(() => false)) {
        await demoMode.click();
    }
}

export async function arriveAtClinicianDashboard(page: Page): Promise<void> {
    await expect(page.getByRole('button', { name: 'Patients', exact: true })).toBeVisible({ timeout: 15_000 });
}
