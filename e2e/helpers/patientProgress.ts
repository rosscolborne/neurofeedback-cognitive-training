import { expect, type Page } from '@playwright/test';

const resolvedProgressCopy = /Tracking \d+ sessions? over time\.|Complete your first session to start tracking progress\./;

export function trackingCopy(count: number): string {
    return `Tracking ${count} ${count === 1 ? 'session' : 'sessions'} over time.`;
}

export async function openAllTimeProgress(page: Page): Promise<number> {
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your Progress', exact: true })).toBeVisible();

    const progressSummary = page.getByText(resolvedProgressCopy).first();
    await expect(progressSummary).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'All Time', exact: true }).click();

    const summary = await progressSummary.textContent();
    const count = summary?.match(/Tracking (\d+) sessions? over time\./)?.[1];
    return count ? Number(count) : 0;
}

export function aggregateSessionCount(page: Page) {
    return page.getByText('Sessions', { exact: true }).locator('..');
}
