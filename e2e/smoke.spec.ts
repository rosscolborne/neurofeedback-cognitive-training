import { test, expect } from './fixtures';

test('Neurasticity loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
});
