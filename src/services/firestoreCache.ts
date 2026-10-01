import { persistentLocalCache, persistentMultipleTabManager, type FirestoreSettings } from 'firebase/firestore';

/**
 * Firestore settings for the app (NFCT-20): a persistent IndexedDB cache, so
 * games can be played and saved offline. Reads fall back to cached documents,
 * and writes are queued on the device and survive an app restart until the
 * server accepts or refuses them.
 *
 * The multiple-tab manager lets every open tab of the web app share one cache
 * and one write queue. With the single-tab manager a second tab could not use
 * persistence, and its offline writes would be lost when it closed. In the
 * Capacitor iOS app there is only one WebView, so it behaves like a single tab.
 *
 * Where IndexedDB is unavailable (for example some private-browsing modes) the
 * SDK logs a warning and falls back to a memory cache: the app still works,
 * but writes queued offline do not survive a restart.
 *
 * The cache holds the signed-in account's documents and queued writes, and
 * belongs to one account at a time: `firestoreCacheLifecycle.ts` deletes it on
 * sign-out, account switch and account deletion, and before first use when
 * its owner is not the signed-in account.
 */
export function appFirestoreSettings(): FirestoreSettings {
  return { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) };
}
