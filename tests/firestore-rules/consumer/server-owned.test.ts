import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, increment, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment } from '../fixture';
import { players, resetConsumerWorld, serverOwnedDocuments, sessionData } from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

// progress, stats, dailyStats and achievements are written only by trusted
// scoring (NFCT-19). A client can read its own and write none of them.
describe.each(Object.entries(serverOwnedDocuments))('users/{uid}/%s (server-owned)', (collectionName, relativePath) => {
    const ownPath = `users/${players.a}/${relativePath}`;
    const newPath = `users/${players.a}/${collectionName}/client-forged`;

    it('lets the owner get and list', async () => {
        const database = await as(players.a);
        await assertSucceeds(getDoc(doc(database, ownPath)));
        await assertSucceeds(getDocs(collection(database, `users/${players.a}/${collectionName}`)));
    });

    it('denies other users and unauthenticated reads', async () => {
        await assertFails(getDoc(doc(await as(players.b), ownPath)));
        await assertFails(getDocs(collection(await as(players.b), `users/${players.a}/${collectionName}`)));
        await assertFails(getDoc(doc(await anonymous(), ownPath)));
    });

    it('never lets the owner create, update or delete', async () => {
        const database = await as(players.a);
        await assertFails(setDoc(doc(database, newPath), { schemaVersion: 1 }));
        await assertFails(setDoc(doc(database, ownPath), { schemaVersion: 1, forged: true }));
        await assertFails(updateDoc(doc(database, ownPath), { schemaVersion: 2 }));
        await assertFails(deleteDoc(doc(database, ownPath)));
    });

    it('denies other users and unauthenticated writes', async () => {
        await assertFails(setDoc(doc(await as(players.b), newPath), { schemaVersion: 1 }));
        await assertFails(setDoc(doc(await anonymous(), newPath), { schemaVersion: 1 }));
    });
});

describe('users/{uid}/progress manipulation', () => {
    it('cannot raise a best, unlock a level or inflate totals, alone or batched with a session', async () => {
        const database = await as(players.a);
        const progress = doc(database, `users/${players.a}/${serverOwnedDocuments.progress}`);
        await assertFails(updateDoc(progress, { 'bestPeakLevel.timed-90': 10 }));
        await assertFails(updateDoc(progress, { unlocked: { 'timed-90': 10 } }));
        await assertFails(updateDoc(progress, { sessionsCompleted: increment(100) }));
        await assertFails(setDoc(doc(database, `users/${players.a}/progress/new-game`), {
            schemaVersion: 1, gameId: 'new-game', bestPeakLevel: { endless: 50 }, updatedAt: serverTimestamp(),
        }));
        const batch = writeBatch(database);
        batch.update(progress, { 'bestPeakLevel.timed-90': 10 });
        await assertFails(batch.commit());
    });
});

describe('users/{uid}/stats, dailyStats and achievements manipulation (NFCT-13)', () => {
    it('cannot extend a streak, inflate a day or award an achievement, alone or batched with a new session', async () => {
        const database = await as(players.a);
        const summary = doc(database, `users/${players.a}/${serverOwnedDocuments.stats}`);
        const day = doc(database, `users/${players.a}/${serverOwnedDocuments.dailyStats}`);
        await assertFails(updateDoc(summary, { 'streak.longest': 30, validRuns: increment(100) }));
        await assertFails(updateDoc(summary, { achievements: ['first-run', 'streak-30'] }));
        await assertFails(updateDoc(day, { sessions: increment(5) }));
        await assertFails(setDoc(doc(database, `users/${players.a}/dailyStats/2026-09-30`), {
            schemaVersion: 1, date: '2026-09-30', sessions: 3, updatedAt: serverTimestamp(),
        }));
        await assertFails(setDoc(doc(database, `users/${players.a}/achievements/streak-30`), {
            schemaVersion: 1, achievementId: 'streak-30', earnedAt: serverTimestamp(), sessionId: 'session-forged-000001', gameId: 'mental-math', localDate: '2026-09-30',
        }));
        await assertFails(setDoc(doc(database, `users/${players.a}/stats/other`), { schemaVersion: 1 }));
        // A session the rules accept on its own cannot carry an aggregate write with it.
        const batch = writeBatch(database);
        batch.set(doc(database, `users/${players.a}/gameSessions/session-with-forged-stats`), sessionData(players.a));
        batch.set(doc(database, `users/${players.a}/achievements/runs-100`), { schemaVersion: 1, achievementId: 'runs-100' });
        await assertFails(batch.commit());
        await assertSucceeds(setDoc(doc(database, `users/${players.a}/gameSessions/session-with-forged-stats`), sessionData(players.a)));
    });
});

describe('accountDeletions/{uid} (server-only ledger)', () => {
    it('gives clients no access, not even to their own entry', async () => {
        const database = await as(players.a);
        const own = doc(database, `accountDeletions/${players.a}`);
        await assertFails(getDoc(own));
        await assertFails(getDocs(collection(database, 'accountDeletions')));
        await assertFails(updateDoc(own, { status: 'complete' }));
        await assertFails(deleteDoc(own));
        await assertFails(setDoc(doc(database, `accountDeletions/${players.b}`), { status: 'requested' }));
        await assertFails(setDoc(doc(await as(players.b), `accountDeletions/${players.b}`), { status: 'requested' }));
        await assertFails(getDoc(doc(await anonymous(), `accountDeletions/${players.a}`)));
    });
});

describe('catch-all', () => {
    it('denies unknown subcollections under a user, even to the owner', async () => {
        const database = await as(players.a);
        for (const name of ['settings', 'rawEeg', 'eegRaw', 'sessions', 'trials']) {
            await assertFails(setDoc(doc(database, `users/${players.a}/${name}/doc-1`), { value: 1 }));
            await assertFails(getDoc(doc(database, `users/${players.a}/${name}/doc-1`)));
        }
        await assertFails(setDoc(doc(database, `users/${players.a}/gameSessions/session-seeded-00000001/trials/t-1`), { value: 1 }));
    });

    it('denies unknown top-level collections, including a Firestore game catalogue', async () => {
        const database = await as(players.a);
        for (const path of ['games/mental-math', 'config/app', 'leaderboards/mental-math', 'progress/player-a']) {
            await assertFails(getDoc(doc(database, path)));
            await assertFails(setDoc(doc(database, path), { value: 1 }));
        }
        await assertFails(getDoc(doc(await anonymous(), 'games/mental-math')));
    });
});
