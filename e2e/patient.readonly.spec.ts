import { expect, test } from './fixtures';
import { arriveAtPatientDashboard } from './helpers/auth';
import { aggregateSessionCount, openAllTimeProgress } from './helpers/patientProgress';

function visibleHistoryCount(page: import('@playwright/test').Page) {
    return page.getByRole('heading', { name: 'Session History', exact: true })
        .locator('..').locator(':scope > .card-patient');
}

// Read-only: navigates and opens the headset gate, then cancels. No Admin access.
test.describe('patient data authenticity (read-only)', () => {
    test('authenticated entry truthfully resolves either supported training or an unavailable protocol, plus Progress/History', async ({ page }) => {
        await page.goto('/');
        await arriveAtPatientDashboard(page);

        await expect(page.getByText('Training Portal', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Begin Session', exact: true })).toBeEnabled();
        await expect(page.getByText('Assignment required', { exact: true })).toHaveCount(0);

        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByRole('button', { name: 'View Protocol Details', exact: true }).click();

        const protocolDialog = page.getByRole('dialog', { name: 'Protocol details' });
        await expect(protocolDialog).toBeVisible();
        await expect(protocolDialog.getByText('Your assigned protocol', { exact: true })).toBeVisible();
        await expect(protocolDialog.getByText('Protocol', { exact: true })).toBeVisible();
        await expect(protocolDialog.getByText('Duration', { exact: true })).toBeVisible();
        await protocolDialog.getByRole('button', { name: 'Close protocol details', exact: true }).click();

        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByRole('button', { name: 'Begin Session', exact: true }).click();
        const headsetGate = page.getByRole('heading', { name: 'Connect Muse Headband', exact: true });
        const unavailableProtocol = page.getByRole('heading', { name: 'Protocol unavailable', exact: true });
        await expect(headsetGate.or(unavailableProtocol)).toBeVisible();
        if (await unavailableProtocol.isVisible()) {
            await expect(page.getByRole('alert')).toContainText('unsupported and block training');
            await page.getByRole('button', { name: 'Return to dashboard', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Cancel & Return to Dashboard', exact: true }).click();
        }

        const sessionCount = await openAllTimeProgress(page);
        await expect(page.getByText('Loading session history…', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Session history unavailable', { exact: true })).toHaveCount(0);

        if (sessionCount === 0) {
            await expect(page.getByText('No sessions in this period', { exact: true })).toBeVisible();
            await expect(aggregateSessionCount(page)).toContainText('0');
        } else {
            await expect(aggregateSessionCount(page)).toContainText(String(sessionCount));
            await expect(page.getByRole('heading', { name: 'Session History', exact: true })).toBeVisible();
        }
    });
});

test('Progress ranges reconcile with visible history and expose the honest export state', async ({ page }) => {
    await page.goto('/');
    await arriveAtPatientDashboard(page);
    const allCount = await openAllTimeProgress(page);

    const counts: number[] = [];
    for (const [range, label] of [
        ['week', 'Past 7 days'],
        ['month', 'Past 30 days'],
        ['All Time', 'All time'],
    ] as const) {
        await page.getByRole('button', { name: range, exact: true }).click();
        await expect(page.getByText(new RegExp(`${label} · \\d+ sessions?`))).toBeVisible();
        const metric = await aggregateSessionCount(page).innerText();
        const count = Number(metric.match(/\d+/)?.[0]);
        expect(Number.isFinite(count)).toBe(true);
        counts.push(count);
        await expect(visibleHistoryCount(page)).toHaveCount(count || 1);
        if (count === 0) {
            await expect(page.getByText('No sessions in this period', { exact: true })).toBeVisible();
        }
    }
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[2]).toBe(allCount);
    if (allCount === 0) {
        await expect(page.getByRole('button', { name: 'No data to export', exact: true })).toBeDisabled();
    } else {
        await expect(page.getByRole('button', { name: 'Export Data (CSV)', exact: true })).toBeEnabled();
    }
});
