import { expect, test } from './fixtures';

test('clinician and patient Messages remain visible when smooth scrolling returns a Promise', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => Promise.resolve(),
    });
  });
  await page.goto('/e2e/messaging-harness.html');

  await page.getByRole('button', { name: 'Open clinician Messages' }).click();
  await expect(page.getByRole('heading', { name: 'Patient Messages' })).toBeVisible();
  await page.getByRole('button', { name: /Linked patient Open conversation/ }).click();
  await expect(page.getByText('Private care-team conversation')).toBeVisible();
  await expect(page.getByLabel('Message Linked patient')).toBeEnabled();
  await page.getByRole('button', { name: 'Close Messages' }).click();

  await page.getByRole('button', { name: 'Open patient Messages' }).click();
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message your clinician')).toBeEnabled();
  await page.getByRole('button', { name: 'Close Messages' }).click();

  expect(pageErrors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Open patient Messages' })).toBeVisible();
});

test('sample clinician can navigate into Messages and a conversation without a blank screen', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/#/login');
  await page.getByRole('button', { name: 'Open Sample Clinician Workspace' }).click();
  await page.getByRole('button', { name: 'Messages', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Patient Messages' })).toBeVisible();
  await page.getByRole('button', { name: /Open conversation/ }).first().click();
  await expect(page.getByText('Private care-team conversation')).toBeVisible();
  await expect(page.locator('.card-clinician')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
