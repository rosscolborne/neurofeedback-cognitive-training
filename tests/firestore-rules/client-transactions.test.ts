import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, closeEnvironment, emailOf, ids, resetWorld } from './fixture';

// Replays the app's real transactions, including their reads of documents that
// may not exist yet, so rules that only pass batch-shaped writes cannot hide a
// broken client flow. Shapes mirror src/services/storageEngine.ts.

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('profile transactions', () => {
    it('storageEngine.getCurrentClient creates a missing profile for the signed-in user', async () => {
        const fresh = 'fresh-patient';
        const database = await as(fresh);
        await assertSucceeds(getDoc(doc(database, `clients/${fresh}`)));
        await assertSucceeds(setDoc(doc(database, `clients/${fresh}`), { id: fresh, email: emailOf(fresh), name: 'New', badges: [], brainMaps: [] }));
    });
});

/** storageEngine.createSession: session plus aggregate merge onto the patient profile. */
function createSession(database: Firestore, sessionId: string, patientId: string, extra: Record<string, unknown> = {}) {
    return runTransaction(database, async (transaction) => {
        const client = await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `sessions/${sessionId}`), {
            id: sessionId, patientId, clinicId: 'self-guided', isDemo: true, durationSeconds: 60, averageMindfulness: 70,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: serverTimestamp(), ...extra,
        });
        if (client.exists()) {
            transaction.set(doc(database, `clients/${patientId}`), {
                ...client.data(), completedSessionsCount: 1, recentCompletedSessionIds: [sessionId], badges: ['first-light'],
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    });
}

/** storageEngine.patchSessionNotes */
function patchNotes(database: Firestore, sessionId: string, patch: Record<string, unknown>) {
    return runTransaction(database, async (transaction) => {
        const session = await transaction.get(doc(database, `sessions/${sessionId}`));
        const patientId = session.data()?.patientId as string;
        if (patientId) await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `sessions/${sessionId}`), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    });
}

describe('session transactions', () => {
    it('the patient saves a session with the aggregate merge, including one linked under the retired clinician product', async () => {
        await assertSucceeds(createSession(await as(ids.unlinked), 'tx-unlinked', ids.unlinked));
        await assertSucceeds(createSession(await as(ids.patientA), 'tx-patient', ids.patientA));
    });

    it('a former clinician, their colleague, or another patient cannot save a session for patient-a', async () => {
        await assertFails(createSession(await as(ids.clinicianA), 'tx-clinician', ids.patientA, { clinicianId: ids.clinicianA }));
        await assertFails(createSession(await as(ids.colleagueA), 'tx-colleague', ids.patientA));
        await assertFails(createSession(await as(ids.clinicianB), 'tx-outsider', ids.patientA));
        await assertFails(createSession(await as(ids.patientB), 'tx-outsider', ids.patientA));
    });

    it('note patches work for the patient only', async () => {
        await assertSucceeds(patchNotes(await as(ids.patientA), 'session-a', { patientNotes: 'calm', moodRating: 4 }));
        await assertFails(patchNotes(await as(ids.clinicianA), 'session-a', { clinicianNotes: 'good' }));
        await assertFails(patchNotes(await as(ids.patientA), 'session-a', { clinicianNotes: 'self-review' }));
        await assertFails(patchNotes(await as(ids.clinicianB), 'session-a', { clinicianNotes: 'x' }));
    });
});
