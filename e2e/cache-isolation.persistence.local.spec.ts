import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import type { CachedAccountData } from './helpers/cacheIsolation';
import { seedAdditionalLinkedPatient, seedConsumerAccount, seedLinkedPatient } from './helpers/localEmulator';
import { FIRESTORE_CACHE_STATE_KEY, type CacheState } from '../src/services/firestoreCacheLifecycle';

// NFCT-20: the persistent Firestore cache belongs to one account at a time.
// Sign-out, an account switch, a sign-out elsewhere and account deletion
// delete it (firestoreCacheLifecycle.ts), so the next account on this browser
// profile cannot read the previous account's cached documents through the
// app's Firestore instance: not with getDocFromCache / getDocsFromCache, not
// through a listener's first (cached) snapshot, not with getDoc offline, and
// not in IndexedDB itself. The same account keeps its cache, so offline play
// survives reloads.
//
// Probes run in the page on the app's own Firestore instance, through
// e2e/helpers/cacheIsolation.ts, which the Vite dev server loads as the same
// module instances the app uses. Nothing in the app exposes a test hook.

const FIRESTORE = 'http://127.0.0.1:8080';

async function cacheState(page: Page): Promise<CacheState | null> {
    const raw = await page.evaluate((key) => localStorage.getItem(key), FIRESTORE_CACHE_STATE_KEY);
    return raw === null ? null : JSON.parse(raw) as CacheState;
}

/** Marks the current document; after a full page load the mark is gone. */
async function markDocument(page: Page): Promise<void> {
    await page.evaluate(() => { (window as unknown as { cacheIsolationMark?: boolean }).cacheIsolationMark = true; });
}

async function wasReloaded(page: Page): Promise<boolean> {
    return page.evaluate(() => (window as unknown as { cacheIsolationMark?: boolean }).cacheIsolationMark !== true)
        .catch(() => false);
}

async function currentUid(page: Page): Promise<string | null> {
    return page.evaluate(async () => (await import('/e2e/helpers/cacheIsolation.ts')).currentUid());
}

/** Before sign-out: the account's documents really are in the cache (the control for the checks below). */
async function expectCachedForOwner(page: Page, data: CachedAccountData): Promise<void> {
    const reads = await page.evaluate(async (target) => (await import('/e2e/helpers/cacheIsolation.ts')).readFromCache(target), data);
    for (const [name, read] of Object.entries(reads)) {
        if (read.kind === 'documents') expect(read.count, name).toBeGreaterThan(0);
        else expect(read, name).toMatchObject({ kind: 'document', exists: true, fromCache: true });
    }
}

/** No record in this origin's Firestore IndexedDB mentions any of the needles. */
async function expectNoTrace(page: Page, needles: string[]): Promise<void> {
    const scan = await page.evaluate(async (values) => (await import('/e2e/helpers/cacheIsolation.ts')).scanFirestoreIndexedDb(values), needles);
    for (const needle of needles) expect(scan.hits[needle], `IndexedDB records containing ${needle}`).toEqual({});
}

/** The signed-in account cannot read `data` (another account's) from the cache by any app path. */
async function expectNothingReadable(page: Page, data: CachedAccountData): Promise<void> {
    const reads = await page.evaluate(async (target) => (await import('/e2e/helpers/cacheIsolation.ts')).readFromCache(target), data);
    for (const [name, read] of Object.entries(reads)) {
        if (read.kind === 'documents') expect(read.count, `getDocsFromCache ${name}`).toBe(0);
        else expect(read, `getDocFromCache ${name}`).toEqual({ kind: 'error', code: 'unavailable' });
    }
    // A listener's first event is the server's refusal, never a cached snapshot.
    const events = await page.evaluate(async (target) => (await import('/e2e/helpers/cacheIsolation.ts')).firstListenerEvents(target), data);
    for (const [name, event] of Object.entries(events)) expect(event, `listener ${name}`).toEqual({ kind: 'error', code: 'permission-denied' });
    const offline = await page.evaluate(async (target) => (await import('/e2e/helpers/cacheIsolation.ts')).readWhileOffline(target), data);
    for (const [name, read] of Object.entries(offline)) expect(read, `offline getDoc ${name}`).toEqual({ kind: 'error', code: 'unavailable' });
}

async function saveSessionAndReadClinicalDocument(page: Page): Promise<CachedAccountData> {
    return page.evaluate(async () => {
        const helper = await import('/e2e/helpers/cacheIsolation.ts');
        const saved = await helper.saveGameSession({ withEeg: false });
        return { ...saved, clinicalName: await helper.readOwnClinicalDocument() };
    });
}

async function logOutOfPatientApp(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('button', { name: 'Log Out' }).click();
}

test('after sign-out, the next account on this browser cannot read the previous account\'s cached data', async ({ page, context, permissionErrorGuard }) => {
    // The second account's probes of the first account's paths are refused by the rules, as they must be.
    permissionErrorGuard.expectDenialsIn(context);
    const a = await seedLinkedPatient();
    const b = await seedAdditionalLinkedPatient(a);

    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);
    const aData = await saveSessionAndReadClinicalDocument(page);
    expect(aData.clinicalName).toBe(a.name);
    await expectCachedForOwner(page, aData);
    expect(await cacheState(page)).toEqual({ v: 1, owner: a.patient.uid });

    // A game saved while Firestore is offline stays queued on this device.
    const queued = await page.evaluate(async () => {
        const helper = await import('/e2e/helpers/cacheIsolation.ts');
        await helper.setNetwork(false);
        const saved = await helper.saveGameSession({ withEeg: false, waitForServer: false });
        return `users/${saved.uid}/gameSessions/${saved.sessionId}`;
    });

    // Sign-out says so before deleting it. Staying signed in is the default and keeps it.
    await logOutOfPatientApp(page);
    const dialog = page.getByRole('alertdialog', { name: 'Some activity hasn’t uploaded yet' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Signing out now will delete it from this device');
    const stay = dialog.getByRole('button', { name: 'Stay signed in' });
    await expect(stay).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Log Out' })).toBeFocused();
    expect(await page.evaluate(async (path) => (await import('/e2e/helpers/cacheIsolation.ts')).pendingInCache(path), queued)).toBe(true);

    // Choosing to sign out anyway, with the keyboard.
    await page.getByRole('button', { name: 'Log Out' }).click();
    await expect(stay).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Sign out anyway' })).toBeFocused();
    await markDocument(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });

    // A full page load, with the cache deleted and marked empty.
    expect(await wasReloaded(page)).toBe(true);
    expect(await currentUid(page)).toBeNull();
    expect(await cacheState(page)).toEqual({ v: 1, owner: null });
    await expectNoTrace(page, [a.patient.uid, a.name, a.patient.email, queued]);

    // The next account signs in on the same browser profile.
    await loginThroughUi(page, b.patient);
    await arriveAtPatientDashboard(page);
    expect(await cacheState(page)).toEqual({ v: 1, owner: b.patient.uid });
    await expectNoTrace(page, [a.patient.uid, a.name, a.patient.email]);
    await expectNothingReadable(page, aData);

    // The discarded game was deleted with the cache: it never reaches the server, even when its account returns.
    await logOutOfPatientApp(page);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);
    expect(await page.evaluate(async (path) => (await import('/e2e/helpers/cacheIsolation.ts')).existsOnServer(path), queued)).toBe(false);
});

test('switching accounts without signing out removes the previous player\'s profile, games and EEG', async ({ page, context, permissionErrorGuard }) => {
    permissionErrorGuard.expectDenialsIn(context);
    const player = await seedConsumerAccount();
    const next = (await seedLinkedPatient()).patient;

    // A consumer player with EEG consent saves a game with a measured EEG recording.
    await loginThroughUi(page, player);
    await expect(page).toHaveURL(/role-selection/);
    const playerData: CachedAccountData = await page.evaluate(async () => {
        const helper = await import('/e2e/helpers/cacheIsolation.ts');
        await helper.createConsentedProfile();
        return { ...(await helper.saveGameSession({ withEeg: true })), clinicalName: null };
    });
    expect(playerData.recordingId).not.toBeNull();
    await expectCachedForOwner(page, playerData);

    // Another account signs in over it, with no sign-out in between.
    await markDocument(page);
    await page.evaluate(async ({ email, password }) => (await import('/e2e/helpers/cacheIsolation.ts')).signInDirectly(email, password), next)
        .catch((error: Error) => { if (!/Execution context was destroyed|navigat/i.test(error.message)) throw error; });
    await arriveAtPatientDashboard(page);
    expect(await wasReloaded(page)).toBe(true);
    expect(await currentUid(page)).toBe(next.uid);
    expect(await cacheState(page)).toEqual({ v: 1, owner: next.uid });
    await expectNoTrace(page, [player.uid, playerData.sessionId, playerData.recordingId!]);
    await expectNothingReadable(page, playerData);
});

test('a session that ends outside the app (another tab, a revoked sign-in) also deletes the cache', async ({ page }) => {
    const a = await seedLinkedPatient();
    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);
    const aData = await saveSessionAndReadClinicalDocument(page);
    await expectCachedForOwner(page, aData);

    await markDocument(page);
    await page.evaluate(async () => (await import('/e2e/helpers/cacheIsolation.ts')).signOutOfFirebaseOnly())
        .catch((error: Error) => { if (!/Execution context was destroyed|navigat/i.test(error.message)) throw error; });
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => wasReloaded(page)).toBe(true);
    await expect.poll(() => cacheState(page)).toEqual({ v: 1, owner: null });
    await expectNoTrace(page, [a.patient.uid, a.name]);
});

test('signing out in one tab reloads the other tabs, which do not hold the deletion up', async ({ page, context }) => {
    const a = await seedLinkedPatient();
    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);
    const aData = await saveSessionAndReadClinicalDocument(page);

    const second = await context.newPage();
    await second.goto('/');
    await arriveAtPatientDashboard(second);
    await expectCachedForOwner(second, aData);
    await markDocument(second);

    await logOutOfPatientApp(page);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => wasReloaded(second)).toBe(true);
    await expect(second.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    expect(await cacheState(page)).toEqual({ v: 1, owner: null });
    // The deletion completed although the second tab had the database open.
    // (Its SDK, shutting down, may create an empty database again right
    // afterwards: no documents and no queued writes.)
    await expectNoTrace(second, [a.patient.uid, a.name, a.patient.email, aData.sessionId]);
});

test('if the cache cannot be deleted, sign-out still completes and the next account waits until it is', async ({ page, context, permissionErrorGuard }) => {
    permissionErrorGuard.expectDenialsIn(context);
    const a = await seedLinkedPatient();
    const b = await seedAdditionalLinkedPatient(a);
    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);
    const aData = await saveSessionAndReadClinicalDocument(page);

    // Another page of this origin, not running the app, holds the cache
    // database open and ignores requests to close it, as a frozen tab or
    // devtools can. Deleting the database waits for it.
    const holder = await context.newPage();
    await holder.route('**/cache-holder', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cache holder</title>' }));
    await holder.goto('/cache-holder');
    await holder.evaluate(async () => {
        const name = (await indexedDB.databases()).map((database) => database.name).find((candidate) => candidate?.startsWith('firestore/'));
        if (!name) throw new Error('The app has no Firestore cache to hold.');
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => { (window as unknown as { held: IDBDatabase }).held = request.result; resolve(); };
            request.onerror = () => reject(request.error);
        });
    });

    // Sign-out still finishes: signed out, with the unfinished cleanup recorded.
    await logOutOfPatientApp(page);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 30_000 });
    expect(await currentUid(page)).toBeNull();
    expect((await cacheState(page))?.cleanup).toMatchObject({ reason: 'sign-out', signOut: true, previousOwner: a.patient.uid });

    // The next account to sign in waits, and nothing reads Firestore for it meanwhile.
    const firestoreRequests: string[] = [];
    page.on('request', (request) => { if (request.url().startsWith(FIRESTORE)) firestoreRequests.push(request.url()); });
    await loginThroughUi(page, b.patient);
    await expect(page.getByText('Finishing sign-out on this device…')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Close any other tabs or windows with this app open to continue.')).toBeVisible();
    await expect(page.getByText('Training Session', { exact: true })).toBeHidden();
    const waitingScreen = await page.locator('body').innerText();
    expect(waitingScreen).not.toContain(a.name);
    expect(waitingScreen).not.toContain(a.patient.email);
    expect(firestoreRequests).toEqual([]);

    // Once the database is released, the deletion completes and the account opens on an empty cache.
    await holder.evaluate(() => (window as unknown as { held: IDBDatabase }).held.close());
    await arriveAtPatientDashboard(page);
    expect(await cacheState(page)).toEqual({ v: 1, owner: b.patient.uid });
    await expectNoTrace(page, [a.patient.uid, a.name, a.patient.email]);
    await expectNothingReadable(page, aData);
});

test('the same account keeps its offline data across a reload, and it uploads later', async ({ page, context }) => {
    const a = await seedLinkedPatient();
    await loginThroughUi(page, a.patient);
    await arriveAtPatientDashboard(page);

    // Firestore unreachable (the app itself still loads): a game is saved and stays queued.
    await context.route(`${FIRESTORE}/**`, (route) => route.abort());
    const queued = await page.evaluate(async () => {
        const saved = await (await import('/e2e/helpers/cacheIsolation.ts')).saveGameSession({ withEeg: false, waitForServer: false });
        return `users/${saved.uid}/gameSessions/${saved.sessionId}`;
    });

    await markDocument(page);
    await page.reload();
    expect(await wasReloaded(page)).toBe(true);
    await expect.poll(() => currentUid(page)).toBe(a.patient.uid);
    // Same account: the cache was kept, with the queued game in it.
    expect(await cacheState(page)).toEqual({ v: 1, owner: a.patient.uid });
    expect(await page.evaluate(async (path) => (await import('/e2e/helpers/cacheIsolation.ts')).pendingInCache(path), queued)).toBe(true);

    // Back online, the queued game reaches the server. Restarting the
    // connection skips the SDK's retry back-off instead of waiting it out.
    await context.unroute(`${FIRESTORE}/**`);
    await page.evaluate(async () => {
        const helper = await import('/e2e/helpers/cacheIsolation.ts');
        await helper.setNetwork(false);
        await helper.setNetwork(true);
    });
    await expect.poll(() => page.evaluate(async (path) => (await import('/e2e/helpers/cacheIsolation.ts')).existsOnServer(path), queued)
        .catch(() => false), { timeout: 30_000 }).toBe(true);
});
