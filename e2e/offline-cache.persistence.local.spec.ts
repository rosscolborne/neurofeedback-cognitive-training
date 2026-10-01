import { expect, test } from './fixtures';
import { arriveAtPatientDashboard, loginThroughUi } from './helpers/auth';
import { seedLinkedPatient } from './helpers/localEmulator';

// NFCT-20: Firestore runs with the persistent IndexedDB cache, so games can be
// played and saved offline. IndexedDB exists only in a browser, so this is the
// one layer that can observe the cache the app actually gets; the repository
// tests cover offline reads and queued writes against the emulators.

test('the app keeps Firestore data in the persistent IndexedDB cache', async ({ page }) => {
  const fallbackWarnings: string[] = [];
  page.on('console', (message) => {
    if (/Falling back to memory cache|Offline persistence has been disabled/.test(message.text())) fallbackWarnings.push(message.text());
  });
  const fixture = await seedLinkedPatient();

  await loginThroughUi(page, fixture.patient);
  await arriveAtPatientDashboard(page);

  await expect.poll(async () => page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)))
    .toContain('firestore/[DEFAULT]/demo-neurasticity-protocol-e2e/main');
  expect(fallbackWarnings).toEqual([]);
});
