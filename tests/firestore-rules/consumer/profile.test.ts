import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, past } from '../fixture';
import { acceptedConsentVersion, minutesAgo, players, profileData, resetConsumerWorld, storedConsent, without } from './consumerFixture';

beforeEach(resetConsumerWorld);
afterAll(closeEnvironment);

const fresh = 'fresh-player';
const freshPath = `users/${fresh}`;
const profileA = `users/${players.a}`;
const profileB = `users/${players.b}`;

describe('users/{uid} consumer profile: read', () => {
    it('lets only the owner read their profile', async () => {
        await assertSucceeds(getDoc(doc(await as(players.a), profileA)));
        await assertFails(getDoc(doc(await as(players.b), profileA)));
        await assertFails(getDoc(doc(await anonymous(), profileA)));
    });

    it('never lists other users', async () => {
        await assertFails(getDocs(collection(await as(players.a), 'users')));
    });
});

describe('users/{uid} consumer profile: create', () => {
    it('lets the owner create an exact profile stamped with the server clock', async () => {
        await assertSucceeds(setDoc(doc(await as(fresh), freshPath), profileData()));
    });

    it('lets the owner record EEG consent at creation with an accepted version', async () => {
        await assertSucceeds(setDoc(doc(await as(fresh), freshPath), profileData({
            eeg: { enabled: true, consent: { version: acceptedConsentVersion, grantedAt: serverTimestamp() }, preferredDevice: { model: 'muse-s' } },
        })));
    });

    it('denies creating a profile for another uid, and unauthenticated creation', async () => {
        await assertFails(setDoc(doc(await as(players.a), freshPath), profileData()));
        await assertFails(setDoc(doc(await anonymous(), freshPath), profileData()));
    });

    it('requires createdAt and updatedAt to be the server clock', async () => {
        const database = await as(fresh);
        await assertFails(setDoc(doc(database, freshPath), profileData({ createdAt: past })));
        await assertFails(setDoc(doc(database, freshPath), profileData({ updatedAt: past })));
    });

    it('rejects unknown keys, including clinical and identity fields', async () => {
        const database = await as(fresh);
        for (const key of ['role', 'email', 'clinicId', 'clinicianId', 'isAdmin', 'progress']) {
            await assertFails(setDoc(doc(database, freshPath), profileData({ [key]: null })));
        }
        await assertFails(setDoc(doc(database, freshPath), profileData({
            preferences: { timezone: 'UTC', soundEnabled: true, hapticsEnabled: true, weeklyGoal: null, theme: 'dark' },
        })));
        await assertFails(setDoc(doc(database, freshPath), profileData({
            eeg: { enabled: false, consent: null, preferredDevice: null, rawCapture: true },
        })));
        await assertFails(setDoc(doc(database, freshPath), profileData({ onboarding: { version: 1, completedAt: null, step: 2 } })));
    });

    it('rejects a profile missing any required key', async () => {
        const database = await as(fresh);
        for (const key of Object.keys(profileData())) {
            await assertFails(setDoc(doc(database, freshPath), without(profileData(), key)));
        }
    });

    it('rejects malformed fields', async () => {
        const database = await as(fresh);
        const malformed: Record<string, unknown>[] = [
            { schemaVersion: 2 },
            { schemaVersion: '1' },
            { displayName: 'x'.repeat(41) },
            { displayName: ' padded ' },
            { displayName: '' },
            { avatar: { kind: 'upload', presetId: 'fox' } },
            { avatar: 'fox' },
            { preferences: { timezone: '', soundEnabled: true, hapticsEnabled: true, weeklyGoal: null } },
            { preferences: { timezone: 'UTC', soundEnabled: 'yes', hapticsEnabled: true, weeklyGoal: null } },
            { preferences: { timezone: 'UTC', soundEnabled: true, hapticsEnabled: true, weeklyGoal: { kind: 'activeDays', target: 8 } } },
            { preferences: { timezone: 'UTC', soundEnabled: true, hapticsEnabled: true, weeklyGoal: { kind: 'hours', target: 2 } } },
            { preferences: { timezone: 'UTC', soundEnabled: true, hapticsEnabled: true, weeklyGoal: { kind: 'sessions', target: 0 } } },
            { onboarding: { version: -1, completedAt: null } },
            { onboarding: { version: 1, completedAt: 'yesterday' } },
            { eeg: { enabled: 'true', consent: null, preferredDevice: null } },
            { eeg: { enabled: true, consent: null, preferredDevice: { model: 'simulated' } } },
        ];
        for (const overrides of malformed) {
            await assertFails(setDoc(doc(database, freshPath), profileData(overrides)));
        }
    });

    it('accepts EEG consent only with an accepted version stamped now', async () => {
        const database = await as(fresh);
        const withConsent = (consent: unknown) => profileData({ eeg: { enabled: true, consent, preferredDevice: null } });
        await assertFails(setDoc(doc(database, freshPath), withConsent({ version: 'unapproved-copy', grantedAt: serverTimestamp() })));
        await assertFails(setDoc(doc(database, freshPath), withConsent({ version: acceptedConsentVersion, grantedAt: past })));
        await assertFails(setDoc(doc(database, freshPath), withConsent({ version: acceptedConsentVersion })));
        await assertFails(setDoc(doc(database, freshPath), withConsent(true)));
    });
});

describe('users/{uid} consumer profile: update', () => {
    it('lets the owner update preferences with updatedAt stamped now', async () => {
        await assertSucceeds(updateDoc(doc(await as(players.a), profileA), {
            'preferences.soundEnabled': false,
            'preferences.weeklyGoal': { kind: 'activeDays', target: 5 },
            displayName: 'Renamed',
            updatedAt: serverTimestamp(),
        }));
    });

    it('keeps existing consent valid when other fields change', async () => {
        // player-a's consent was granted in the past; an unrelated update does not re-stamp it.
        await assertSucceeds(updateDoc(doc(await as(players.a), profileA), {
            'onboarding.completedAt': minutesAgo(0), updatedAt: serverTimestamp(),
        }));
    });

    it('denies updates without a fresh updatedAt, or that change createdAt', async () => {
        const database = await as(players.a);
        await assertFails(updateDoc(doc(database, profileA), { displayName: 'No stamp' }));
        await assertFails(updateDoc(doc(database, profileA), { displayName: 'Old stamp', updatedAt: past }));
        await assertFails(updateDoc(doc(database, profileA), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    });

    it('denies another user and unauthenticated updates', async () => {
        await assertFails(updateDoc(doc(await as(players.b), profileA), { displayName: 'Hijack', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(await anonymous(), profileA), { displayName: 'Hijack', updatedAt: serverTimestamp() }));
    });

    it('rejects unknown keys and legacy fields on update', async () => {
        const database = await as(players.a);
        for (const key of ['role', 'email', 'accountDeletionStartedAt', 'extra']) {
            await assertFails(updateDoc(doc(database, profileA), { [key]: null, updatedAt: serverTimestamp() }));
        }
        await assertFails(updateDoc(doc(database, profileA), { 'preferences.theme': 'dark', updatedAt: serverTimestamp() }));
    });

    it('cannot turn a consumer profile into a legacy one', async () => {
        await assertFails(setDoc(doc(await as(players.a), profileA), {
            email: 'player-a@example.test', displayName: 'Player', createdAt: '2026-01-15T12:00:00.000Z', role: null,
        }));
    });

    it('records a consent change only when stamped now with an accepted version', async () => {
        const reference = doc(await as(players.b), profileB);
        await assertFails(updateDoc(reference, { 'eeg.consent': { version: acceptedConsentVersion, grantedAt: past }, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(reference, { 'eeg.consent': { version: 'unapproved-copy', grantedAt: serverTimestamp() }, updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(reference, {
            'eeg.enabled': true, 'eeg.consent': { version: acceptedConsentVersion, grantedAt: serverTimestamp() }, updatedAt: serverTimestamp(),
        }));
    });

    it('cannot back-date an existing consent, but can withdraw it', async () => {
        const reference = doc(await as(players.a), profileA);
        await assertFails(updateDoc(reference, {
            'eeg.consent': { ...storedConsent, grantedAt: minutesAgo(60 * 24 * 365) }, updatedAt: serverTimestamp(),
        }));
        await assertSucceeds(updateDoc(reference, { 'eeg.consent': null, 'eeg.enabled': false, updatedAt: serverTimestamp() }));
    });
});

describe('users/{uid} consumer profile: delete', () => {
    it('is never deleted by a client, even the owner', async () => {
        await assertFails(deleteDoc(doc(await as(players.a), profileA)));
        await assertFails(deleteDoc(doc(await anonymous(), profileA)));
    });
});
