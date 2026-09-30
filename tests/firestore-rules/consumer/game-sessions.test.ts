import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, past } from '../fixture';
import { minutesAgo, players, resetConsumerWorld, seededSessionId, sessionData, trials, without } from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

const newSessionId = 'session-new-0000000001';
const sessionPath = (uid: string, id = newSessionId) => `users/${uid}/gameSessions/${id}`;

const forgedResult = {
    processedAt: serverTimestamp(), scoringVersion: 1, validity: 'valid', reasons: [], score: 9_999,
    accuracy: 1, responseTime: null, metrics: {}, performanceIndex: null, performanceIndexVersion: null,
    domainContributions: { math: 1 }, personalBest: true, unlocked: [{ modeId: 'timed-90', startLevel: 10 }],
    achievementsAwarded: [],
};

describe('users/{uid}/gameSessions: create', () => {
    it('lets the owner create a completed or abandoned session', async () => {
        const database = await as(players.a);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a)));
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a, 'session-abandoned-0001')), sessionData(players.a, { status: 'abandoned' })));
    });

    it('accepts the trial cap of 400 and an empty trial list', async () => {
        const database = await as(players.a);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { trials: trials(400) })));
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a, 'session-no-trials-0001')), sessionData(players.a, { trials: [], status: 'abandoned' })));
    });

    it("denies writing into another user's sessions and unauthenticated writes", async () => {
        await assertFails(setDoc(doc(await as(players.b), sessionPath(players.a)), sessionData(players.a)));
        await assertFails(setDoc(doc(await as(players.b), sessionPath(players.a)), sessionData(players.b)));
        await assertFails(setDoc(doc(await anonymous(), sessionPath(players.a)), sessionData(players.a)));
    });

    it('requires the stored userId to match the path uid', async () => {
        await assertFails(setDoc(doc(await as(players.a), sessionPath(players.a)), sessionData(players.b)));
        await assertFails(setDoc(doc(await as(players.a), sessionPath(players.a)), sessionData('')));
    });

    it('rejects unknown keys, including any EEG flag on the session', async () => {
        const database = await as(players.a);
        for (const key of ['eegLinked', 'hadEegAtCompletion', 'eegRecordingId', 'score', 'validity', 'protocolId', 'extra']) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { [key]: true })));
        }
    });

    it('rejects a client-supplied server result, even a null one', async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { result: forgedResult })));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { result: null })));
    });

    it('rejects a session missing any required key', async () => {
        const database = await as(players.a);
        for (const key of Object.keys(sessionData(players.a))) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), without(sessionData(players.a), key)));
        }
    });

    it('requires createdAt to be the server clock', async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { createdAt: past })));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { createdAt: minutesAgo(0) })));
    });

    it('accepts only games in the allowlist', async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameId: 'chess' })));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameId: 'theta-beta-ratio' })));
    });

    it('rejects malformed envelopes', async () => {
        const database = await as(players.a);
        const future = Timestamp.fromMillis(Date.now() + 10 * 60_000);
        const malformed: Record<string, unknown>[] = [
            { schemaVersion: 2 },
            { schemaVersion: 0 },
            { gameVersion: 0 },
            { gameVersion: 1.5 },
            { modeId: 'Timed 90' },
            { modeId: 'x'.repeat(41) },
            { startLevel: 0, peakLevel: 1 },
            { startLevel: 51, peakLevel: 51 },
            { startLevel: 1.5 },
            { startLevel: 4, peakLevel: 3 },
            { peakLevel: 51 },
            { status: 'won' },
            { startedAt: minutesAgo(1), endedAt: minutesAgo(3) },
            { startedAt: minutesAgo(1), endedAt: minutesAgo(1) },
            { endedAt: future },
            { endedAt: '2026-09-29T12:00:00Z' },
            { activeDurationMs: -1 },
            { activeDurationMs: 3_600_001 },
            { activeDurationMs: 1.5 },
            { localDate: '29/09/2026' },
            { localDate: '2026-9-29' },
            { timezone: '' },
            { timezone: ' America/Toronto' },
            { client: { appVersion: '0.1.0', platform: 'windows' } },
            { client: { appVersion: '0.1.0', platform: 'web', userAgent: 'x' } },
            { client: { platform: 'web' } },
            { trials: trials(401) },
            { trials: { 0: {} } },
            { summary: null },
            { summary: { ...sessionData(players.a).summary, eegScore: 1 } },
            { summary: { ...sessionData(players.a).summary, accuracy: 1.5 } },
            { summary: { ...sessionData(players.a).summary, trialsTotal: -1 } },
            { summary: { ...sessionData(players.a).summary, metrics: [] } },
            { summary: { ...sessionData(players.a).summary, responseTime: { medianMs: 1 } } },
            { summary: without(sessionData(players.a).summary, 'metrics') },
        ];
        for (const overrides of malformed) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, overrides)));
        }
    });

    it('requires a well-formed client-generated session ID', async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, sessionPath(players.a, 'short')), sessionData(players.a)));
        await assertFails(setDoc(doc(database, sessionPath(players.a, 'has spaces in the id 0001')), sessionData(players.a)));
    });
});

describe('users/{uid}/gameSessions: write-once', () => {
    it('never lets a client update a session, including forging its result', async () => {
        const reference = doc(await as(players.a), sessionPath(players.a, seededSessionId));
        await assertFails(updateDoc(reference, { result: forgedResult }));
        await assertFails(updateDoc(reference, { 'result.score': 9_999 }));
        await assertFails(updateDoc(reference, { 'summary.score': 9_999 }));
        await assertFails(updateDoc(reference, { peakLevel: 10 }));
    });

    it('refuses a retried create over an existing session', async () => {
        const database = await as(players.a);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a)));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a)));
    });

    it('never lets a client delete a session', async () => {
        await assertFails(deleteDoc(doc(await as(players.a), sessionPath(players.a, seededSessionId))));
        await assertFails(deleteDoc(doc(await anonymous(), sessionPath(players.a, seededSessionId))));
    });
});

describe('users/{uid}/gameSessions: read', () => {
    it('lets the owner get and query their sessions, including the history queries', async () => {
        const database = await as(players.a);
        const sessions = collection(database, `users/${players.a}/gameSessions`);
        await assertSucceeds(getDoc(doc(database, sessionPath(players.a, seededSessionId))));
        await assertSucceeds(getDocs(query(sessions, orderBy('endedAt', 'desc'), limit(20))));
        await assertSucceeds(getDocs(query(sessions, where('gameId', '==', 'mental-math'), orderBy('endedAt', 'desc'), limit(20))));
    });

    it('denies other users, unauthenticated reads and cross-user collection-group queries', async () => {
        await assertFails(getDoc(doc(await as(players.b), sessionPath(players.a, seededSessionId))));
        await assertFails(getDocs(collection(await as(players.b), `users/${players.a}/gameSessions`)));
        await assertFails(getDoc(doc(await anonymous(), sessionPath(players.a, seededSessionId))));
        await assertFails(getDocs(collectionGroup(await as(players.a), 'gameSessions')));
    });
});
