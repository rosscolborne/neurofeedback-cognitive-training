import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient, type LocalPatientFixture } from './helpers/localEmulator';

// NFCT-20: a page the browser keeps in its back/forward cache must not bring
// a signed-out or deleted account back. Playwright's Chrome runs with the
// back/forward cache disabled by default; this file turns it back on.
//
// Two layers are checked: the page that navigates away already shows none of
// the account's data (the app replaces the account's screens first), and a
// page restored from the cache after its session ended loads the app afresh
// (firestoreCacheLifecycle's pageshow guard).
test.use({
    launchOptions: { executablePath: '/usr/bin/google-chrome', ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

const RESTORE_PREFIX = 'bfcache-restore:';

/** Records the text of every page the browser restores from the back/forward cache, at the moment it is shown. */
async function recordRestores(page: Page): Promise<string[]> {
    const restores: string[] = [];
    page.on('console', (message) => {
        if (message.text().startsWith(RESTORE_PREFIX)) restores.push(message.text().slice(RESTORE_PREFIX.length));
    });
    // Registered before the app's own listener, so it sees the page as restored.
    await page.addInitScript((prefix) => {
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) console.log(prefix + document.body.innerText);
        });
    }, RESTORE_PREFIX);
    return restores;
}

const accountText = (fixture: LocalPatientFixture) => [fixture.name, fixture.patient.email, 'ADHD (Inattentive)'];

async function openProfile(page: Page, fixture: LocalPatientFixture): Promise<void> {
    await loginThroughUi(page, fixture.patient);
    await arriveAtPatientDashboard(page);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    // The control: the account's details are on screen before it goes.
    await expect(page.getByText(fixture.patient.email)).toBeVisible();
    await expect(page.getByText('ADHD (Inattentive)')).toBeVisible();
}

async function expectNoAccountAfterBack(page: Page, fixture: LocalPatientFixture, restores: string[]): Promise<void> {
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    // Neither a page restored from the cache nor what follows shows the account.
    for (const text of [...restores, await page.locator('body').innerText()]) {
        for (const detail of accountText(fixture)) expect(text).not.toContain(detail);
    }
    expect(await page.evaluate(async () => (await import('/e2e/helpers/cacheIsolation.ts')).currentUid())).toBeNull();
}

test('Back after account deletion shows none of the deleted account', async ({ page }) => {
    const restores = await recordRestores(page);
    const fixture = await seedLinkedPatient();
    await openProfile(page, fixture);

    await page.getByRole('button', { name: 'Delete Account' }).click();
    await page.getByLabel('Enter your password to confirm account deletion').fill(fixture.patient.password);
    await page.getByRole('button', { name: 'Confirm account deletion' }).click();
    await expect(page).toHaveURL(/\/welcome/, { timeout: 20_000 });

    await expectNoAccountAfterBack(page, fixture, restores);
    // The browser did restore the deleted account's page from the cache, so this is the case under test.
    expect(restores.length).toBeGreaterThan(0);
});

test('Back after sign-out shows none of the signed-out account', async ({ page }) => {
    const restores = await recordRestores(page);
    const fixture = await seedLinkedPatient();
    await openProfile(page, fixture);

    await page.getByRole('button', { name: 'Log Out' }).click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });

    // Chrome currently loads this page afresh rather than restoring it (its
    // not-restored reason is masked); either way no account data may show.
    await expectNoAccountAfterBack(page, fixture, restores);
});
