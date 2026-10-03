import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, past } from '../fixture';
import { minutesAgo, players, resetConsumerWorld, seededSessionId, sessionData, trials, validResult, without } from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

const newSessionId = 'session-new-0000000001';
const sessionPath = (uid: string, id = newSessionId) => `users/${uid}/gameSessions/${id}`;

// Each ServerResult variant a client might forge. Even a bare `invalid` result
// would set processedAt and stop trusted scoring from ever processing the session.
// Server-owned processing metadata trusted scoring may write for a session it
// could not score. A client must never send it.
const forgedProcessing = [
    { state: 'failed', updatedAt: serverTimestamp() },
    { state: 'unsupported' },
    { state: 'pending' },
    {},
    null,
];

const forgedResults = {
    valid: { ...validResult(serverTimestamp()), score: 9_999, peakLevel: 10, recordValues: { score: 9_999, peakLevel: 10 } },
    flagged: {
        processedAt: serverTimestamp(), scoringVersion: 1, validity: 'flagged', reasons: ['rt-below-floor'],
        score: 1, accuracy: null, responseTime: null, peakLevel: 1, metrics: {},
        performanceIndex: null, performanceIndexVersion: null, domainContributions: {},
    },
    invalid: { processedAt: serverTimestamp(), scoringVersion: 1, validity: 'invalid', reasons: ['schema-invalid'] },
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

    it('rejects a client-supplied server result of any validity, even a null one', async () => {
        const database = await as(players.a);
        for (const result of [...Object.values(forgedResults), null, {}]) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { result })));
        }
    });

    it('rejects client-supplied processing metadata in any form', async () => {
        const database = await as(players.a);
        for (const processing of forgedProcessing) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { processing })));
        }
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { processingState: 'pending' })));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, {
            processing: { state: 'failed' }, result: forgedResults.invalid,
        })));
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
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { createdAt: minutesAgo(1) })));
    });

    it('accepts only games in the allowlist', async () => {
        const database = await as(players.a);
        for (const gameId of ['chess', 'theta-beta-ratio', 'Mental-Math', '', 1]) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameId })));
        }
    });

    it("accepts only gameVersions inside the game's supported window (mental-math: 1 to 2)", async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameVersion: 0 })));
        await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameVersion: 3 })));
        // gameVersion 2: the time-bank run (NFCT-60).
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a, 'session-version-2-0001')), sessionData(players.a, { gameVersion: 2 })));
        for (const gameVersion of [-1, 1.5, '1', null, 1_000_000]) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameVersion })));
        }
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { gameVersion: 1 })));
    });

    it('requires the session seed to be an unsigned 32-bit integer', async () => {
        const database = await as(players.a);
        for (const [index, seed] of [0, 1, 4_294_967_295].entries()) {
            await assertSucceeds(setDoc(doc(database, sessionPath(players.a, `session-seed-ok-00000${index}`)), sessionData(players.a, { seed })));
        }
        for (const seed of [-1, 4_294_967_296, 1.5, '42', null, true, [1], { value: 1 }]) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { seed })));
        }
        await assertFails(setDoc(doc(database, sessionPath(players.a)), without(sessionData(players.a), 'seed')));
    });

    it('accepts an offline session played long ago', async () => {
        const database = await as(players.a);
        const daysAgo = (days: number) => minutesAgo(days * 24 * 60);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, {
            startedAt: Timestamp.fromMillis(daysAgo(400).toMillis() - 120_000), endedAt: daysAgo(400), localDate: '2025-08-26',
        })));
    });

    it('allows up to 5 minutes of device clock skew on endedAt, and no more', async () => {
        const database = await as(players.a);
        const inMinutes = (minutes: number) => Timestamp.fromMillis(Date.now() + minutes * 60_000);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { endedAt: inMinutes(4) })));
        await assertFails(setDoc(doc(database, sessionPath(players.a, 'session-skewed-000001')), sessionData(players.a, { endedAt: inMinutes(6) })));
        await assertFails(setDoc(doc(database, sessionPath(players.a, 'session-skewed-000001')), sessionData(players.a, {
            startedAt: inMinutes(60 * 24), endedAt: inMinutes(60 * 24 + 2),
        })));
    });

    it('rejects malformed envelopes', async () => {
        const database = await as(players.a);
        const future = Timestamp.fromMillis(Date.now() + 10 * 60_000);
        const malformed: Record<string, unknown>[] = [
            { schemaVersion: 2 },
            { schemaVersion: 0 },
            { modeId: 'Timed 90' },
            { modeId: 'x'.repeat(41) },
            { startLevel: 0, peakLevel: 1 },
            { startLevel: 51, peakLevel: 51 },
            { startLevel: 1.5 },
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
            { summary: { ...sessionData(players.a).summary, score: '42' } },
            { summary: { ...sessionData(players.a).summary, accuracy: 'all' } },
            { summary: { ...sessionData(players.a).summary, trialsTotal: null } },
            { summary: { ...sessionData(players.a).summary, trialsCorrect: [] } },
            { summary: { ...sessionData(players.a).summary, metrics: [] } },
            { summary: { ...sessionData(players.a).summary, metrics: null } },
            { summary: { ...sessionData(players.a).summary, metrics: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`m${index}`, index])) } },
            { summary: { ...sessionData(players.a).summary, responseTime: { medianMs: 1 } } },
            { summary: { ...sessionData(players.a).summary, responseTime: { medianMs: 1, meanMs: 1, p90Ms: 1, maxMs: 1 } } },
            { summary: { ...sessionData(players.a).summary, responseTime: { medianMs: 1, meanMs: '1', p90Ms: 1 } } },
            { summary: without(sessionData(players.a).summary, 'metrics') },
        ];
        for (const overrides of malformed) {
            await assertFails(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, overrides)));
        }
    });

    it('accepts a well-typed display summary even when it disagrees with the trials', async () => {
        // The summary is display-only. Trusted scoring recomputes it from the
        // trials, and a mismatch is a diagnostic that never changes validity, so
        // a display bug must not stop the raw trials from being stored.
        const database = await as(players.a);
        const oddSummary = {
            score: -5, accuracy: 1.5, trialsTotal: -1, trialsCorrect: 99,
            responseTime: { medianMs: -1, meanMs: 0.5, p90Ms: 1e9 },
            metrics: Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`m${index}`, index])),
        };
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a)), sessionData(players.a, { summary: oddSummary })));
    });

    it('accepts any bounded client peak level: it is an untrusted observation', async () => {
        // Trusted scoring derives the real peak from the trials. A client peak
        // below the start level, or claiming the top level, is only a diagnostic.
        const database = await as(players.a);
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a, 'session-low-peak-00001')), sessionData(players.a, { startLevel: 4, peakLevel: 3 })));
        await assertSucceeds(setDoc(doc(database, sessionPath(players.a, 'session-high-peak-0001')), sessionData(players.a, { startLevel: 1, peakLevel: 50, trials: trials(1) })));
        for (const peakLevel of [0, 51, 2.5, '10', null]) {
            await assertFails(setDoc(doc(database, sessionPath(players.a, 'session-bad-peak-00001')), sessionData(players.a, { peakLevel })));
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
        await assertFails(updateDoc(reference, { result: forgedResults.valid }));
        await assertFails(updateDoc(reference, { 'result.score': 9_999 }));
        await assertFails(updateDoc(reference, { 'result.peakLevel': 10, 'result.recordValues.peakLevel': 10 }));
        await assertFails(updateDoc(reference, { 'result.processedAt': serverTimestamp() }));
        await assertFails(updateDoc(reference, { 'summary.score': 9_999 }));
        await assertFails(updateDoc(reference, { peakLevel: 10 }));
    });

    it('never lets a client add result or processing to its own pending session', async () => {
        const database = await as(players.a);
        const reference = doc(database, sessionPath(players.a));
        await assertSucceeds(setDoc(reference, sessionData(players.a)));
        for (const result of Object.values(forgedResults)) {
            await assertFails(updateDoc(reference, { result }));
            await assertFails(setDoc(reference, { result }, { merge: true }));
        }
        for (const processing of forgedProcessing) {
            await assertFails(updateDoc(reference, { processing }));
            await assertFails(setDoc(reference, { processing }, { merge: true }));
        }
        await assertFails(updateDoc(reference, { 'processing.state': 'unsupported' }));
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
