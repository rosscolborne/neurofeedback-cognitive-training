import {
    collection,
    disableNetwork,
    doc,
    enableNetwork,
    getDoc,
    getDocFromCache,
    getDocFromServer,
    getDocsFromCache,
    onSnapshot,
    query,
    Timestamp,
    where,
    type DocumentReference,
    type Query,
} from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { mentalMath } from '@nfct/shared';
import { auth, db } from '../../src/services/firebase';
import { gameSessionRepository, profileRepository, type EegRecordingDraft } from '../../src/consumer/repositories';

// In-page helpers for the cache isolation specs. Specs load this module with
// `page.evaluate(() => import('/e2e/helpers/cacheIsolation.ts'))`, which the
// local Vite dev server resolves to the same module instances the app uses, so
// every call runs on the app's own Firestore instance and signed-in user.
// Nothing here is part of the app or of a production build.

/** The documents one account left in the cache, addressed by path. */
export type CachedAccountData = {
    uid: string;
    sessionId: string;
    recordingId: string | null;
    clinicalName: string | null;
};

export type CachedRead =
    | { kind: 'document'; exists: boolean; fromCache: boolean }
    | { kind: 'documents'; count: number; fromCache: boolean }
    | { kind: 'error'; code: string };

export type ListenerEvent =
    | { kind: 'snapshot'; exists: boolean; fromCache: boolean }
    | { kind: 'error'; code: string }
    | { kind: 'timeout' };

function errorCode(error: unknown): string {
    return (error as { code?: unknown } | null)?.code?.toString() ?? String(error);
}

function signedInUid(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('A signed-in user is required.');
    return uid;
}

const minutesAgo = (minutes: number) => Timestamp.fromMillis(Date.now() - minutes * 60_000);
const distribution = { mean: 0.5, median: 0.5, p10: 0.2, p90: 0.8, n: 9 };

function sessionDraft() {
    const trial = (index: number) => ({
        level: 1, operands: [2, 3], operators: ['+' as const], grouped: false, expected: 5, response: 5,
        correct: true, timedOut: false, shownAtMs: index * 2_000, rtMs: 1_200, timeLimitMs: 8_000,
    });
    return {
        gameId: 'mental-math',
        gameVersion: 1,
        modeId: 'timed-90',
        startLevel: 1,
        peakLevel: 2,
        status: 'completed' as const,
        startedAt: minutesAgo(3),
        endedAt: minutesAgo(1),
        activeDurationMs: 90_000,
        localDate: '2026-09-30',
        timezone: 'America/Toronto',
        client: { appVersion: '0.1.0', platform: 'web' as const },
        trials: [trial(0), trial(1), trial(2)],
        summary: {
            score: 180, accuracy: 1, trialsTotal: 3, trialsCorrect: 3,
            responseTime: { medianMs: 1_200, meanMs: 1_200, p90Ms: 1_200 },
            metrics: { correct: 3, attempted: 3, timedOut: 0, longestStreak: 3, finalLevel: 1, difficultyPoints: 150, speedBonusPoints: 30 },
        },
    };
}

function measuredEegDraft(): EegRecordingDraft {
    return {
        source: 'measured' as const,
        startedAt: minutesAgo(3),
        endedAt: minutesAgo(1),
        device: { model: 'muse-2' as const, firmwareVersion: '1.2.13', transport: 'web-bluetooth' as const, channels: ['TP9', 'AF7', 'AF8', 'TP10'], sampleRateHz: 256 },
        processing: { service: 'brainflow-service' as const, serviceVersion: '1.4.0', featureVersion: 1, windowSeconds: 4 },
        calibration: { status: 'complete' as const, windowsCollected: 10, windowsRequired: 10 },
        quality: {
            windowsTotal: 20, windowsUsable: 18, usableFraction: 0.9,
            channelGoodFraction: { TP9: 0.9, AF7: 0.95, AF8: 0.92, TP10: 0.88 }, artifactFraction: 0.1,
        },
        summary: {
            mindfulness: distribution,
            restfulness: distribution,
            relativeBandPower: { delta: 0.3, theta: 0.2, alpha: 0.25, beta: 0.2, gamma: 0.05 },
        },
        timeline: { bucketSeconds: 10, mindfulness: [0.4, null, 0.6], restfulness: [0.5, 0.5, null] },
    };
}


/**
 * Creates the signed-in player's consumer profile with EEG consent (the
 * accepted placeholder version in firestore.rules), as the consumer app does.
 */
export async function createConsentedProfile(): Promise<void> {
    await profileRepository.createProfile({
        displayName: 'Cache Isolation Player',
        avatar: { kind: 'preset', presetId: 'fox' },
        preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: false, weeklyGoal: null },
        onboarding: { version: 1 },
        eeg: { enabled: true, preferredDevice: null },
    }).acknowledged;
    await profileRepository.grantEegConsent('placeholder-1').acknowledged;
}

/**
 * Saves a finished Mental Math session through the app's repository, with a
 * measured EEG recording in the same batch when `withEeg` is set. Waits for
 * the server unless `waitForServer` is false (an offline save stays queued).
 */
export async function saveGameSession({ withEeg, waitForServer = true }: { withEeg: boolean; waitForServer?: boolean }) {
    const game = gameSessionRepository.startGameSession();
    const saved = await game.save({
        definition: mentalMath.definition,
        session: sessionDraft(),
        eegRecording: withEeg ? measuredEegDraft() : null,
    });
    if (withEeg && saved.eegRecording.status !== 'included') {
        throw new Error(`The EEG recording was not included: ${JSON.stringify(saved.eegRecording)}`);
    }
    if (waitForServer) await saved.acknowledged;
    else void saved.acknowledged.catch(() => {});
    return {
        uid: game.userId,
        sessionId: saved.sessionId,
        recordingId: saved.eegRecording.status === 'included' ? saved.eegRecording.recordingId : null,
    };
}

/** Reads the signed-in user's inherited clinical document (clients/{uid}) as the patient app does. */
export async function readOwnClinicalDocument(): Promise<string | null> {
    const snapshot = await getDoc(doc(db, 'clients', signedInUid()));
    return (snapshot.data()?.name as string | undefined) ?? null;
}

function targets(data: CachedAccountData): { documents: Record<string, DocumentReference>; queries: Record<string, Query> } {
    const sessions = collection(db, 'users', data.uid, 'gameSessions');
    const recordings = collection(db, 'users', data.uid, 'eegRecordings');
    const documents: Record<string, DocumentReference> = {
        profile: doc(db, 'users', data.uid),
        gameSession: doc(sessions, data.sessionId),
    };
    const queries: Record<string, Query> = { gameSessions: sessions };
    if (data.recordingId) {
        documents.eegRecording = doc(recordings, data.recordingId);
        queries.eegRecordingsForSession = query(recordings, where('gameSessionId', '==', data.sessionId));
    }
    if (data.clinicalName) documents.clinical = doc(db, 'clients', data.uid);
    return { documents, queries };
}

/** What getDocFromCache / getDocsFromCache return for an account's documents and queries. */
export async function readFromCache(data: CachedAccountData): Promise<Record<string, CachedRead>> {
    const { documents, queries } = targets(data);
    const results: Record<string, CachedRead> = {};
    for (const [name, reference] of Object.entries(documents)) {
        try {
            const snapshot = await getDocFromCache(reference);
            results[name] = { kind: 'document', exists: snapshot.exists(), fromCache: snapshot.metadata.fromCache };
        } catch (error) {
            results[name] = { kind: 'error', code: errorCode(error) };
        }
    }
    for (const [name, target] of Object.entries(queries)) {
        try {
            const snapshot = await getDocsFromCache(target);
            results[name] = { kind: 'documents', count: snapshot.size, fromCache: snapshot.metadata.fromCache };
        } catch (error) {
            results[name] = { kind: 'error', code: errorCode(error) };
        }
    }
    return results;
}

/**
 * The first event a listener on each of the account's documents and queries
 * delivers: a cached snapshot or an error.
 */
export async function firstListenerEvents(data: CachedAccountData, timeoutMs = 10_000): Promise<Record<string, ListenerEvent>> {
    const { documents, queries } = targets(data);
    const results: Record<string, ListenerEvent> = {};
    const listen = (name: string, subscribe: (onEvent: (event: ListenerEvent) => void) => () => void) => new Promise<void>((resolve) => {
        let unsubscribe: (() => void) | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (event: ListenerEvent) => {
            if (results[name]) return;
            results[name] = event;
            clearTimeout(timer);
            queueMicrotask(() => unsubscribe?.());
            resolve();
        };
        timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
        unsubscribe = subscribe(finish);
    });
    const onError = (finish: (event: ListenerEvent) => void) => (error: unknown) => finish({ kind: 'error', code: errorCode(error) });
    await Promise.all([
        ...Object.entries(documents).map(([name, reference]) => listen(name, (finish) => onSnapshot(reference, { includeMetadataChanges: true },
            (snapshot) => finish({ kind: 'snapshot', exists: snapshot.exists(), fromCache: snapshot.metadata.fromCache }), onError(finish)))),
        ...Object.entries(queries).map(([name, target]) => listen(name, (finish) => onSnapshot(target, { includeMetadataChanges: true },
            (snapshot) => finish({ kind: 'snapshot', exists: !snapshot.empty, fromCache: snapshot.metadata.fromCache }), onError(finish)))),
    ]);
    return results;
}

/** What an ordinary getDoc returns for the account's documents with the network disabled. */
export async function readWhileOffline(data: CachedAccountData): Promise<Record<string, CachedRead>> {
    const { documents } = targets(data);
    await disableNetwork(db);
    try {
        const results: Record<string, CachedRead> = {};
        for (const [name, reference] of Object.entries(documents)) {
            try {
                const snapshot = await getDoc(reference);
                results[name] = { kind: 'document', exists: snapshot.exists(), fromCache: snapshot.metadata.fromCache };
            } catch (error) {
                results[name] = { kind: 'error', code: errorCode(error) };
            }
        }
        return results;
    } finally {
        await enableNetwork(db);
    }
}

/**
 * Finds, in every Firestore IndexedDB database of this origin, the stored
 * records that contain each needle (for example a user ID or a name), by
 * object store. It opens only databases that already exist, and closes its
 * connection if a deletion needs it, so it never blocks the app's cleanup.
 */
export async function scanFirestoreIndexedDb(needles: string[]): Promise<{ databases: string[]; hits: Record<string, Record<string, number>> }> {
    const names = (await indexedDB.databases()).map((database) => database.name ?? '').filter((name) => name.startsWith('firestore/'));
    const hits: Record<string, Record<string, number>> = Object.fromEntries(needles.map((needle) => [needle, {}]));
    for (const name of names) {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        database.onversionchange = () => database.close();
        try {
            for (const storeName of Array.from(database.objectStoreNames)) {
                const values = await new Promise<unknown[]>((resolve, reject) => {
                    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                for (const value of values) {
                    const text = JSON.stringify(value);
                    for (const needle of needles) {
                        if (!text.includes(needle)) continue;
                        const byStore = hits[needle]!;
                        byStore[storeName] = (byStore[storeName] ?? 0) + 1;
                    }
                }
            }
        } finally {
            database.close();
        }
    }
    return { databases: names, hits };
}

export async function setNetwork(enabled: boolean): Promise<void> {
    await (enabled ? enableNetwork(db) : disableNetwork(db));
}

export function currentUid(): string | null {
    return auth.currentUser?.uid ?? null;
}

/** Whether a document exists on the server, read as the signed-in user (bypassing the cache). */
export async function existsOnServer(path: string): Promise<boolean> {
    return (await getDocFromServer(doc(db, path))).exists();
}

/** Whether a document is in the cache with a write the server has not accepted yet. */
export async function pendingInCache(path: string): Promise<boolean> {
    const snapshot = await getDocFromCache(doc(db, path));
    return snapshot.exists() && snapshot.metadata.hasPendingWrites;
}

/**
 * Signs out through Firebase Auth alone, not through the app's sign-out: what
 * the app sees when the session ends elsewhere (another tab, a revoked token).
 */
export async function signOutOfFirebaseOnly(): Promise<void> {
    await signOut(auth);
}

/** Switches the signed-in account without signing out first. */
export async function signInDirectly(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
}
