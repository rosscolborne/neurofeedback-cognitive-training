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
  await expect(page.locator('tbody .patient-avatar svg').first()).toBeVisible();
  await expect(page.locator('tbody .patient-avatar img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Messages', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Patient Messages' })).toBeVisible();
  await expect(page.locator('.messaging-participant .patient-avatar svg').first()).toBeVisible();
  const contentWidth = await page.locator('.clinician-main-content').evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  expect((await page.locator('.card-clinician').boundingBox())!.width).toBe(contentWidth);
  await page.getByRole('button', { name: /Open conversation/ }).first().click();
  await expect(page.getByText('Private care-team conversation')).toBeVisible();
  await expect(page.locator('.messaging-participant[aria-current="true"] .patient-avatar')).toBeVisible();
  await expect(page.locator('header .patient-avatar svg').first()).toBeVisible();
  await expect(page.locator('.card-clinician')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('patient composer gives a short message room and grows for wrapped text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/messaging-harness.html');
  await page.getByRole('button', { name: 'Open patient Messages' }).click();

  const input = page.getByRole('textbox', { name: 'Message your clinician' });
  const label = page.locator('label[for="patient-message-input"]');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(input).toBeEnabled();
  await input.fill('A short message');

  const formBox = await input.locator('xpath=../..').boundingBox();
  const labelBox = await label.boundingBox();
  const shortBox = await input.boundingBox();
  const sendBox = await send.boundingBox();
  expect(formBox && labelBox && shortBox && sendBox).toBeTruthy();
  expect(labelBox!.y + labelBox!.height).toBeLessThan(shortBox!.y);
  expect(shortBox!.x - formBox!.x).toBeGreaterThanOrEqual(16);
  expect(shortBox!.width).toBeGreaterThan(200);
  expect(shortBox!.height).toBeLessThanOrEqual(44);
  expect(sendBox!.width).toBeLessThan(105);
  await expect(input).toHaveCSS('font-family', /DM Sans/);

  await input.fill('This message is long enough to wrap across several lines on a narrow phone screen. '.repeat(6));
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeGreaterThan(shortBox!.height);
  const longBox = await input.boundingBox();
  expect(longBox!.height).toBeLessThanOrEqual(120);

  await input.fill('Short again');
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeLessThanOrEqual(44);
});

test('clinician composer gives a short message room and grows for wrapped text', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/e2e/messaging-harness.html');
  await page.getByRole('button', { name: 'Open clinician Messages' }).click();
  await page.getByRole('button', { name: /Linked patient Open conversation/ }).click();

  const input = page.getByRole('textbox', { name: 'Message Linked patient' });
  const label = page.locator('label[for="clinician-message-input"]');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await input.fill('A short message');

  const formBox = await input.locator('xpath=../..').boundingBox();
  const labelBox = await label.boundingBox();
  const shortBox = await input.boundingBox();
  const sendBox = await send.boundingBox();
  expect(formBox && labelBox && shortBox && sendBox).toBeTruthy();
  expect(labelBox!.y + labelBox!.height).toBeLessThan(shortBox!.y);
  expect(shortBox!.x - formBox!.x).toBeGreaterThanOrEqual(16);
  expect(shortBox!.width).toBeGreaterThan(400);
  expect(shortBox!.height).toBeLessThanOrEqual(44);
  expect(sendBox!.width).toBeLessThan(105);
  await expect(input).toHaveCSS('font-family', /DM Sans/);

  await input.fill('This message is long enough to wrap across several lines in the clinician workspace. '.repeat(10));
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeGreaterThan(shortBox!.height);
  const longBox = await input.boundingBox();
  expect(longBox!.height).toBeLessThanOrEqual(120);

  await input.fill('Short again');
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeLessThanOrEqual(44);
});

test('patient Messages list stays compact and suggested messages match the app controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/e2e/messaging-harness.html');
  await page.getByRole('button', { name: 'Open clinician Messages' }).click();

  const card = page.locator('.card-clinician');
  const listBox = await card.boundingBox();
  expect(listBox).toBeTruthy();
  expect(listBox!.height).toBeLessThan(300);
  expect(listBox!.width).toBeGreaterThan(1200);
  const search = page.getByRole('searchbox', { name: 'Search conversations' });
  await expect(search).toHaveCSS('font-family', /DM Sans/);
  await expect(search.locator('..')).toHaveCSS('border-radius', '12px');
  await search.fill('No matching patient');
  await expect(page.getByText('No conversations match your search.')).toBeVisible();
  await search.clear();

  await page.getByRole('button', { name: /Linked patient Open conversation/ }).click();
  await expect(page.getByText('Suggested messages')).toBeVisible();
  const suggestion = page.getByRole('button', { name: 'How did your most recent training session feel?' });
  await expect(suggestion).toHaveCSS('font-family', /DM Sans/);
  await expect(suggestion).toHaveCSS('border-radius', '12px');
  await suggestion.click();
  await expect(page.getByRole('textbox', { name: 'Message Linked patient' })).toHaveValue('How did your most recent training session feel?');
  await expect(suggestion).toHaveAttribute('aria-pressed', 'true');
  expect((await card.boundingBox())!.height).toBe(880);

  await page.setViewportSize({ width: 390, height: 844 });
  const suggestions = page.getByRole('button', { name: /How did your most recent training session feel\?|Please let me know if you had any trouble with your headset\.|Would you like to schedule a protocol check-in\?/ });
  for (const button of await suggestions.all()) {
    const box = await button.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
});
