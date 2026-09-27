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

test('Progress ranges and CSV agree with the saved session history', async ({ page }) => {
    await page.goto('/');
    await arriveAtPatientDashboard(page);
    const allCount = await openAllTimeProgress(page);
    expect(allCount, 'The read-only patient fixture needs saved sessions for CSV acceptance').toBeGreaterThan(0);

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

    const historyTexts = await visibleHistoryCount(page).allInnerTexts();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Data (CSV)', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^waveable_progress_\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
    const [header, ...rows] = csv.trimEnd().split(/\r?\n/);
    expect(header).toBe('Date,Protocol,Experience,Duration (s),Time In Zone %,Coherence %,Peak Score,Mood');
    expect(rows.length, 'CSV row count matches visible all-time history').toBe(allCount);
    for (const [index, row] of rows.entries()) {
        const columns = row.split(',');
        const date = columns.slice(0, -7).join(',').replace(/^"|"$/g, '').trim();
        const [protocol, experience, duration] = columns.slice(-7);
        const displayedDate = new Date(date).toLocaleDateString();
        const visible = historyTexts[allCount - index - 1];
        expect(displayedDate !== 'Invalid Date', `CSV row ${index + 1} has a valid date`).toBe(true);
        expect(visible.includes(displayedDate), `CSV row ${index + 1} date matches history`).toBe(true);
        expect(visible.includes(protocol.replace(/-/g, ' ')), `CSV row ${index + 1} protocol matches history`).toBe(true);
        expect(visible.includes(experience.replace(/-/g, ' ')), `CSV row ${index + 1} experience matches history`).toBe(true);
        if (duration) expect(visible.includes(`Duration: ${Math.round(Number(duration) / 60)} mins`), `CSV row ${index + 1} duration matches history`).toBe(true);
    }
});
