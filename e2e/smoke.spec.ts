import { test, expect } from '@playwright/test';

test('Neurasticity loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
});