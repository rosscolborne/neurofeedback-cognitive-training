import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, emailOf, past } from '../fixture';
import { players, profileData, resetConsumerWorld } from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

// The transitional legacy branch of users/{uid} (removed by NFCT-4). It allows
// only the writes the inherited app makes; everything else is denied.
const fresh = 'fresh-legacy';
const freshPath = `users/${fresh}`;
const legacyPath = `users/${players.legacy}`;

describe('users/{uid} legacy profile: create', () => {
    it('allows the inherited sign-up write (AuthContext.signup)', async () => {
        await assertSucceeds(setDoc(doc(await as(fresh), freshPath), {
            email: emailOf(fresh), displayName: 'New User', createdAt: new Date().toISOString(), role: null,
        }));
    });

    it('denies another uid and unauthenticated creation', async () => {
        const signup = { email: emailOf(fresh), displayName: null, createdAt: new Date().toISOString(), role: null };
        await assertFails(setDoc(doc(await as(players.a), freshPath), signup));
        await assertFails(setDoc(doc(await anonymous(), freshPath), signup));
    });

    it('denies a role, extra keys or malformed values at creation', async () => {
        const database = await as(fresh);
        const signup = { email: emailOf(fresh), displayName: null, createdAt: new Date().toISOString(), role: null };
        await assertFails(setDoc(doc(database, freshPath), { ...signup, role: 'clinician' }));
        await assertFails(setDoc(doc(database, freshPath), { ...signup, role: 'patient' }));
        for (const key of ['updatedAt', 'clinicId', 'accountDeletionStartedAt', 'preferences', 'eeg']) {
            await assertFails(setDoc(doc(database, freshPath), { ...signup, [key]: null }));
        }
        await assertFails(setDoc(doc(database, freshPath), { email: emailOf(fresh) }));
        await assertFails(setDoc(doc(database, freshPath), { ...signup, email: 42 }));
        await assertFails(setDoc(doc(database, freshPath), { ...signup, createdAt: past }));
    });

    it('denies recovering a missing profile through a role-selection merge', async () => {
        // The inherited selectRole merge on a missing document is now a create
        // with role and updatedAt, which the legacy branch does not allow.
        await assertFails(setDoc(doc(await as(fresh), freshPath), { role: 'patient', updatedAt: new Date().toISOString() }, { merge: true }));
    });
});

describe('users/{uid} legacy profile: read, update, delete', () => {
    it('lets only the owner read', async () => {
        await assertSucceeds(getDoc(doc(await as(players.legacy), legacyPath)));
        await assertFails(getDoc(doc(await as(players.a), legacyPath)));
        await assertFails(getDoc(doc(await anonymous(), legacyPath)));
    });

    it('allows the inherited role selection (AuthContext.selectRole)', async () => {
        const database = await as(players.legacy);
        await assertSucceeds(setDoc(doc(database, legacyPath), { role: 'clinician', updatedAt: new Date().toISOString() }, { merge: true }));
        await assertSucceeds(setDoc(doc(database, legacyPath), { role: null, updatedAt: new Date().toISOString() }, { merge: true }));
    });

    it('allows the inherited account-deletion tombstone (storageEngine.preparePatientAccountDeletion)', async () => {
        await assertSucceeds(setDoc(doc(await as(players.legacy), legacyPath), {
            role: 'patient', email: null, displayName: null, accountDeletionStartedAt: serverTimestamp(),
        }, { merge: true }));
    });

    it('denies other keys, unknown roles and a forged deletion time', async () => {
        const database = await as(players.legacy);
        await assertFails(updateDoc(doc(database, legacyPath), { clinicId: 'clinic-a' }));
        await assertFails(updateDoc(doc(database, legacyPath), { createdAt: new Date().toISOString() }));
        await assertFails(updateDoc(doc(database, legacyPath), { role: 'admin' }));
        await assertFails(updateDoc(doc(database, legacyPath), { accountDeletionStartedAt: past }));
    });

    it('can never become a consumer profile', async () => {
        const database = await as(players.legacy);
        await assertFails(setDoc(doc(database, legacyPath), profileData()));
        await assertFails(updateDoc(doc(database, legacyPath), { schemaVersion: 1 }));
        // Adding schemaVersion alongside a valid legacy change is still denied.
        await assertFails(updateDoc(doc(database, legacyPath), { schemaVersion: 1, accountDeletionStartedAt: serverTimestamp() }));
        await assertFails(setDoc(doc(database, legacyPath), { ...profileData(), role: 'patient' }, { merge: true }));
    });

    it('denies another user and unauthenticated updates', async () => {
        await assertFails(updateDoc(doc(await as(players.a), legacyPath), { role: 'clinician' }));
        await assertFails(updateDoc(doc(await anonymous(), legacyPath), { role: 'clinician' }));
    });

    it('is never deleted by a client', async () => {
        await assertFails(deleteDoc(doc(await as(players.legacy), legacyPath)));
    });
});
