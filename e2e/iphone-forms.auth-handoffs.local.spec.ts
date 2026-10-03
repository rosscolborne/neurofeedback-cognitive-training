import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient } from './helpers/localEmulator';

// NFCT-33: the account forms and dialogs on a phone, and the bundled fonts. It
// runs in the WebKit iPhone projects (playwright.webkit.config.ts) and in
// desktop Chromium with the protocol suite. iOS zooms into a focused field
// whose text is under 16 px; the software keyboard, AutoFill itself and real
// safe-area insets are device checks (docs/nfct/ios.md).

const fontSize = (field: Locator) => field.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));

async function expectFieldsReadyForIos(fields: Record<string, { field: Locator; autocomplete: string }>): Promise<void> {
  for (const [name, { field, autocomplete }] of Object.entries(fields)) {
    await expect(field, name).toHaveAttribute('autocomplete', autocomplete);
    expect(await fontSize(field), `${name} text is at least 16 px`).toBeGreaterThanOrEqual(16);
  }
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('sign-up and log-in fields offer AutoFill at 16 px, the page can zoom, and the fonts come from the app', async ({ page }) => {
  const thirdPartyFontRequests: string[] = [];
  page.on('request', (request) => {
    if (/^fonts\.(googleapis|gstatic)\.com$/.test(new URL(request.url()).hostname)) thirdPartyFontRequests.push(request.url());
  });

  await page.goto('/#/signup');
  await expect(page.getByRole('heading', { name: 'Create Account', exact: true })).toBeVisible();
  // Pinch-zoom stays available: the viewport neither caps nor disables scaling.
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(/maximum-scale|user-scalable/);
  await expectFieldsReadyForIos({
    name: { field: page.getByPlaceholder('How should we call you?', { exact: true }), autocomplete: 'name' },
    email: { field: page.getByPlaceholder('you@example.com', { exact: true }), autocomplete: 'email' },
    password: { field: page.getByPlaceholder('At least 6 characters', { exact: true }), autocomplete: 'new-password' },
  });
  await expect(page.getByRole('button', { name: 'Create Account', exact: true })).toBeInViewport();
  await expectNoHorizontalScroll(page);

  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: 'Log In', exact: true })).toBeVisible();
  await expectFieldsReadyForIos({
    email: { field: page.getByPlaceholder('name@example.com', { exact: true }), autocomplete: 'email' },
    password: { field: page.getByPlaceholder('Your password', { exact: true }), autocomplete: 'current-password' },
  });
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeInViewport();
  await expectNoHorizontalScroll(page);

  // Every face the app uses loads from its own bundle, which also works offline.
  const faces = await page.evaluate(async () => {
    const fonts = ['400 16px "DM Sans"', '700 16px "DM Sans"', 'italic 400 16px "DM Sans"', '400 16px "DM Serif Display"', '400 16px "JetBrains Mono"', '700 16px "JetBrains Mono"'];
    return Promise.all(fonts.map(async (font) => ({ font, statuses: (await document.fonts.load(font, 'Aa1')).map((face) => face.status) })));
  });
  for (const { font, statuses } of faces) expect(statuses, font).toEqual(expect.arrayContaining(['loaded']));
  for (const { font, statuses } of faces) expect(statuses.filter((status) => status !== 'loaded'), font).toEqual([]);
  expect(await page.evaluate(() => document.fonts.check('16px "DM Sans"'))).toBe(true);
  expect(await page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').count()).toBe(0);
  expect(thirdPartyFontRequests).toEqual([]);
});

test('account fields on Profile are 16 px and a dialog keeps clear of the screen edges', async ({ page }) => {
  const fixture = await seedLinkedPatient();
  await loginThroughUi(page, fixture.patient);
  await arriveAtPatientDashboard(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();

  await expectFieldsReadyForIos({
    'current password': { field: page.getByLabel('Current password', { exact: true }), autocomplete: 'current-password' },
    'new password': { field: page.getByLabel('New password', { exact: true }), autocomplete: 'new-password' },
    'confirmation': { field: page.getByLabel('Confirm new password', { exact: true }), autocomplete: 'new-password' },
  });

  await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
  const deletionPassword = page.getByLabel('Enter your password to confirm account deletion');
  await expectFieldsReadyForIos({ 'account deletion password': { field: deletionPassword, autocomplete: 'current-password' } });
  await page.locator('form').filter({ has: deletionPassword }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deletionPassword).toHaveCount(0);

  await page.getByRole('button', { name: 'Disconnect from Clinician', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect from your clinician?' });
  await expect(dialog).toBeVisible();
  // The overlay covers the visible screen and pads at least 16 px (more under a
  // notch or the home indicator), and the whole dialog stays inside the padding,
  // scrolling within itself when the screen is shorter than its content.
  const screen = page.viewportSize()!;
  for (const size of [screen, { width: screen.width, height: 320 }]) {
    await page.setViewportSize(size);
    const layout = await dialog.evaluate((element) => {
      const overlay = element.parentElement!;
      const style = getComputedStyle(overlay);
      const outer = overlay.getBoundingClientRect();
      const inner = element.getBoundingClientRect();
      return {
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
        covers: outer.width >= (window.visualViewport?.width ?? innerWidth) && outer.height >= (window.visualViewport?.height ?? innerHeight),
        margins: [inner.top - outer.top, outer.right - inner.right, outer.bottom - inner.bottom, inner.left - outer.left],
      };
    });
    const at = `${size.width} x ${size.height}: ${JSON.stringify(layout)}`;
    expect(layout.covers, at).toBe(true);
    for (const side of layout.padding) expect(side, at).toBeGreaterThanOrEqual(16);
    for (const margin of layout.margins) expect(margin, at).toBeGreaterThanOrEqual(16);
  }
  await page.setViewportSize(screen);
  await expect(dialog.getByRole('button', { name: 'Disconnect', exact: true })).toBeInViewport();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
