import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore as getClientFirestore, connectFirestoreEmulator, doc, getDoc } from 'firebase/firestore';
import { inspectResetLock, releaseStaleResetLock, resetE2EFixtures } from '../../e2e/helpers/fixtureReset';
import { FIXTURE_MARKER, fixtureIdentities } from '../../e2e/helpers/fixtureModel';

const projectId = 'demo-neurasticity-fixture-reset';
if (process.env.GCLOUD_PROJECT !== projectId ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Fixture reset tests require local Auth and Firestore emulators for the demo project.');
}
const app = initializeApp({ projectId }, 'fixture-reset-test');
const auth = getAuth(app);
const db = getFirestore(app);
const passwords = {
    patient: randomBytes(18).toString('base64url'),
    clinician: randomBytes(18).toString('base64url'),
    outsider: randomBytes(18).toString('base64url'),
};

beforeAll(async () => {
    await db.doc('testSetup/ready').set({ ready: true });
});
afterAll(async () => { await deleteApp(app); });

test('repeated reset recreates the known pair and outsider without duplicates or stale records', async () => {
    const { patient, clinician, outsider } = fixtureIdentities;
    await resetE2EFixtures(auth, db, passwords);
    await db.doc(`clients/${patient.uid}`).update({ name: 'Mutated' });
    await db.doc('sessions/e2e-run-1').set({ patientId: patient.uid, clinicianId: clinician.uid, isDemo: true });
    await db.doc('appointments/e2e-legacy').set({ clientId: patient.uid, startsAt: '2026-09-26T12:00:00Z' });
    await db.doc(`messageThreads/${patient.uid}/relationships/${clinician.uid}/messages/one`).set({
        patientId: patient.uid, clinicianId: clinician.uid, senderId: patient.uid, text: 'test',
    });
    const receiptPath = `messageThreads/${patient.uid}/relationships/${clinician.uid}/reads/${clinician.uid}`;
    await db.doc(receiptPath).set({ patientId: patient.uid, clinicianId: clinician.uid, readerId: clinician.uid, lastReadMessageId: 'one' });
    await resetE2EFixtures(auth, db, passwords);
    await resetE2EFixtures(auth, db, passwords);

    const users = await Promise.all([patient, clinician, outsider].map((identity) => auth.getUser(identity.uid)));
    expect(users.map((user) => user.email)).toEqual([patient.email, clinician.email, outsider.email]);
    expect(users.every((user) => user.emailVerified)).toBe(true);
    for (const role of ['patient', 'clinician'] as const) {
        const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: fixtureIdentities[role].email, password: passwords[role], returnSecureToken: true }),
        });
        expect(response.ok).toBe(true);
        expect((await response.json()).localId).toBe(fixtureIdentities[role].uid);
    }
    expect((await db.doc(`clients/${patient.uid}`).get()).data()).toMatchObject({
        name: patient.name, clinicianId: clinician.uid, clinicId: clinician.uid, e2eFixture: FIXTURE_MARKER,
        completedSessionsCount: 0,
    });
    expect((await db.doc(`clients/${outsider.uid}`).get()).data()).toMatchObject({
        name: outsider.name, e2eFixture: FIXTURE_MARKER,
    });
    expect((await db.doc(`clients/${outsider.uid}`).get()).get('clinicianId')).toBeUndefined();
    const clientApp = initializeClientApp({ projectId, apiKey: 'demo', appId: 'demo' }, 'outsider-isolation');
    try {
        const clientAuth = getClientAuth(clientApp);
        connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
        const clientDb = getClientFirestore(clientApp);
        connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
        await signInWithEmailAndPassword(clientAuth, outsider.email, passwords.outsider);
        expect((await getDoc(doc(clientDb, 'clients', outsider.uid))).exists()).toBe(true);
        await expect(getDoc(doc(clientDb, 'clients', patient.uid))).rejects.toThrow();
    } finally {
        await deleteClientApp(clientApp);
    }
    expect((await db.doc(`users/${clinician.uid}`).get()).get('role')).toBe('clinician');
    expect((await db.doc('sessions/e2e-run-1').get()).exists).toBe(false);
    expect((await db.doc('appointments/e2e-legacy').get()).exists).toBe(false);
    expect((await db.doc(`messageThreads/${patient.uid}/relationships/${clinician.uid}/messages/one`).get()).exists).toBe(false);
    expect((await db.doc(receiptPath).get()).exists).toBe(false);
});

test('a thread receipt for an unrelated reader blocks reset', async () => {
    const { patient, clinician } = fixtureIdentities;
    const receiptPath = `messageThreads/${patient.uid}/relationships/${clinician.uid}/reads/unrelated`;
    await db.doc(receiptPath).set({ patientId: patient.uid, clinicianId: clinician.uid, readerId: 'unrelated' });
    await expect(resetE2EFixtures(auth, db, passwords)).rejects.toThrow('receipt does not belong to the fixture pair');
    expect((await db.doc(`clients/${patient.uid}`).get()).exists).toBe(true);
    await db.doc(receiptPath).delete();
});

test('unrelated linked data blocks reset before fixture mutation', async () => {
    const { patient, clinician } = fixtureIdentities;
    await db.doc('clients/unrelated').set({ clinicianId: clinician.uid, clinicId: clinician.uid });
    await expect(resetE2EFixtures(auth, db, passwords)).rejects.toThrow('unrelated client');
    expect((await db.doc(`clients/${patient.uid}`).get()).exists).toBe(true);
    await db.doc('clients/unrelated').delete();
});

test('claim pointing at an unrelated invitation blocks reset', async () => {
    const { patient, clinician } = fixtureIdentities;
    const claimPath = `patientInvitationClaims/${clinician.uid}/emails/${patient.email}`;
    await db.doc('patientInvitations/unrelated').set({
        clinicianId: 'other-clinician', clinicId: 'other-clinic', patientEmail: 'other@example.com',
    });
    await db.doc(claimPath).set({
        clinicianId: clinician.uid, clinicId: clinician.uid, patientEmail: patient.email,
        invitationId: 'unrelated',
    });
    await expect(resetE2EFixtures(auth, db, passwords)).rejects.toThrow('unrelated clinician');
    expect((await db.doc(`clients/${patient.uid}`).get()).exists).toBe(true);
    await db.doc(claimPath).delete();
    await db.doc('patientInvitations/unrelated').delete();
});

test('a crashed reset lock requires an aged, reviewed ID before release', async () => {
    const reference = db.doc('e2eHarnessLocks/fixture-reset');
    await reference.set({ runId: 'old-reset', startedAt: Timestamp.fromMillis(Date.now() - 11 * 60_000) });
    expect((await inspectResetLock(db))?.runId).toBe('old-reset');
    await expect(resetE2EFixtures(auth, db, passwords)).rejects.toThrow('lock is held');
    await expect(releaseStaleResetLock(db, 'wrong-reset')).rejects.toThrow('changed');
    await releaseStaleResetLock(db, 'old-reset');
    expect(await inspectResetLock(db)).toBeNull();
    await reference.set({ runId: 'new-reset', startedAt: Timestamp.now() });
    await expect(releaseStaleResetLock(db, 'new-reset')).rejects.toThrow('younger than ten minutes');
    await reference.delete();
});
