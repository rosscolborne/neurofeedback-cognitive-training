import { expect, test } from './fixtures';

test('fails on a Firestore permission error in the console', async ({ page }) => {
    await page.goto('about:blank');
    await page.evaluate(() => console.error('FirebaseError: [code=permission-denied] Missing or insufficient permissions.'));
    test.fail();
});

test('fails on a permission error in a manually created browser context', async ({ browser }) => {
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.goto('about:blank');
        await page.evaluate(() => console.error('FirebaseError: [code=permission-denied]'));
    } finally {
        await context.close();
    }
    test.fail();
});

test('allows expected denials only in the selected context', async ({ browser, permissionErrorGuard }) => {
    const expectedContext = await browser.newContext();
    permissionErrorGuard.expectDenialsIn(expectedContext);
    try {
        const page = await expectedContext.newPage();
        await page.goto('about:blank');
        await page.evaluate(() => console.error('FirebaseError: [code=permission-denied]'));
    } finally {
        await expectedContext.close();
    }
});

test('still catches another context after an expected-denial exception', async ({ browser, permissionErrorGuard }) => {
    const expectedContext = await browser.newContext();
    const guardedContext = await browser.newContext();
    permissionErrorGuard.expectDenialsIn(expectedContext);
    try {
        const expectedPage = await expectedContext.newPage();
        await expectedPage.goto('about:blank');
        await expectedPage.evaluate(() => console.error('FirebaseError: [code=permission-denied]'));
        const guardedPage = await guardedContext.newPage();
        await guardedPage.goto('about:blank');
        await guardedPage.evaluate(() => console.error('FirebaseError: [code=permission-denied]'));
    } finally {
        await Promise.all([expectedContext.close(), guardedContext.close()]);
    }
    test.fail();
});

test('fails on an uncaught Firestore permission error', async ({ page }) => {
    await page.goto('about:blank');
    const pageError = page.waitForEvent('pageerror');
    await page.evaluate(() => setTimeout(() => { throw new Error('FirebaseError: [code=permission-denied]'); }, 0));
    await pageError;
    test.fail();
});

test('fails on a denied Firestore response even when the page handles it', async ({ page }) => {
    const url = 'https://firestore.googleapis.com/v1/projects/example/databases/(default)/documents/example';
    await page.route(url, (route) => route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } }),
    }));
    await page.goto('about:blank');
    const status = await page.evaluate(async (requestUrl) => (await fetch(requestUrl)).status, url);
    expect(status).toBe(403);
    test.fail();
});

test('fails on a Firestore WebChannel denial inside an HTTP 200 response', async ({ page }) => {
    const url = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel';
    await page.route(url, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify([{ targetChange: { cause: { code: 7, message: 'Missing or insufficient permissions.' } } }]),
    }));
    await page.goto('about:blank');
    const body = await page.evaluate(async (requestUrl) => (await fetch(requestUrl)).text(), url);
    expect(body).toContain('targetChange');
    test.fail();
});

test('ignores unrelated console and network errors', async ({ page }) => {
    await page.goto('about:blank');
    await page.evaluate(() => console.error('An unrelated browser error'));
    await page.route('https://example.test/unavailable', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    const status = await page.evaluate(async () => (await fetch('https://example.test/unavailable', { mode: 'no-cors' })).status);
    expect(status).toBe(0);

    const firestoreUrl = 'https://firestore.googleapis.com/v1/projects/example/databases/(default)/documents/example';
    await page.route(firestoreUrl, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ documents: [{ fields: { note: { stringValue: 'permission-denied' } } }] }),
    }));
    await page.evaluate(async (requestUrl) => (await fetch(requestUrl)).text(), firestoreUrl);
});
