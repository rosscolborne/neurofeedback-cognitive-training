import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { PROFILE_PHOTO_MAX_LENGTH } from '../../../shared/schemas/profile';
import { anonymous, as, closeEnvironment, past } from '../fixture';
import {
    acceptedConsentVersion, minutesAgo, players, profileData, resetConsumerWorld, seededSessionId, storedConsent, without,
} from './consumerFixture';

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

    it('rejects unknown keys and retired fields on update', async () => {
        const database = await as(players.a);
        for (const key of ['role', 'email', 'accountDeletionStartedAt', 'extra']) {
            await assertFails(updateDoc(doc(database, profileA), { [key]: null, updatedAt: serverTimestamp() }));
        }
        await assertFails(updateDoc(doc(database, profileA), { 'preferences.theme': 'dark', updatedAt: serverTimestamp() }));
    });

    it('cannot replace a consumer profile with a document that is not one', async () => {
        await assertFails(setDoc(doc(await as(players.a), profileA), {
            email: 'player-a@example.test', displayName: 'Player', createdAt: '2026-01-15T12:00:00.000Z', role: null,
        }));
        await assertFails(setDoc(doc(await as(players.a), profileA), { displayName: 'Player' }));
    });

    it('cannot turn a document without schemaVersion into a consumer profile, or keep editing it', async () => {
        const reference = doc(await as(players.unversioned), `users/${players.unversioned}`);
        await assertFails(setDoc(reference, profileData()));
        await assertFails(setDoc(reference, profileData(), { merge: true }));
        await assertFails(updateDoc(reference, { displayName: 'Renamed', updatedAt: serverTimestamp() }));
        await assertFails(setDoc(reference, { displayName: 'Renamed' }));
        await assertFails(setDoc(reference, { role: 'patient' }, { merge: true }));
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

/** An image data URL of exactly `length` characters that is otherwise valid. */
function photoDataUrl(length: number, type = 'png'): string {
    const prefix = `data:image/${type};base64,`;
    return prefix + 'A'.repeat(length - prefix.length);
}

const photo = (dataUrl: string) => ({ kind: 'photo', dataUrl });

/** Avatars the rules refuse, matching the shared schema's photo bound and pattern. */
const invalidPhotoAvatars: Record<string, unknown>[] = [
    photo(photoDataUrl(PROFILE_PHOTO_MAX_LENGTH + 1)),
    photo('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    photo('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
    photo('data:text/html;base64,PGgxPmhpPC9oMT4='),
    photo('https://example.test/avatar.png'),
    photo('data:image/png;base64,not base64!'),
    photo(''),
    { kind: 'photo', dataUrl: photoDataUrl(200), presetId: 'fox' },
    { kind: 'photo', presetId: 'fox' },
    { kind: 'photo', dataUrl: 42 },
    { kind: 'preset', dataUrl: photoDataUrl(200) },
];

describe('users/{uid} consumer profile: photo avatar', () => {
    it('lets the owner create a profile with a photo, up to exactly the shared bound', async () => {
        await assertSucceeds(setDoc(doc(await as(fresh), freshPath), profileData({ avatar: photo(photoDataUrl(PROFILE_PHOTO_MAX_LENGTH)) })));
        for (const type of ['jpeg', 'webp']) {
            const uid = `${fresh}-${type}`;
            await assertSucceeds(setDoc(doc(await as(uid), `users/${uid}`), profileData({ avatar: photo(photoDataUrl(200, type)) })));
        }
    });

    it('lets the owner set, replace and clear a photo, and keeps the preset cases', async () => {
        const reference = doc(await as(players.a), profileA);
        await assertSucceeds(updateDoc(reference, { avatar: photo(photoDataUrl(500)), updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(reference, { avatar: photo(photoDataUrl(PROFILE_PHOTO_MAX_LENGTH, 'jpeg')), updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(reference, { avatar: { kind: 'preset', presetId: 'owl' }, updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(reference, { avatar: null, updatedAt: serverTimestamp() }));
    });

    it('refuses oversized, non-image, non-data-URL and malformed photos, on create and on update', async () => {
        const creator = await as(fresh);
        const owner = doc(await as(players.a), profileA);
        for (const avatar of invalidPhotoAvatars) {
            await assertFails(setDoc(doc(creator, freshPath), profileData({ avatar })));
            await assertFails(updateDoc(owner, { avatar, updatedAt: serverTimestamp() }));
        }
    });

    it("never lets another player set or read someone's photo", async () => {
        await assertSucceeds(updateDoc(doc(await as(players.a), profileA), { avatar: photo(photoDataUrl(500)), updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(await as(players.b), profileA), { avatar: photo(photoDataUrl(500, 'jpeg')), updatedAt: serverTimestamp() }));
        await assertFails(getDoc(doc(await as(players.b), profileA)));
        await assertFails(getDoc(doc(await anonymous(), profileA)));
    });

    it('goes with the profile when the owner deletes it', async () => {
        const database = await as(players.a);
        await assertSucceeds(updateDoc(doc(database, profileA), { avatar: photo(photoDataUrl(500)), updatedAt: serverTimestamp() }));
        await assertSucceeds(deleteDoc(doc(database, profileA)));
        const after = await assertSucceeds(getDoc(doc(database, profileA)));
        if (after.exists()) throw new Error('The deleted profile, and its photo, should be gone.');
    });
});

describe('users/{uid} consumer profile: delete', () => {
    it('lets only the owner delete their profile document', async () => {
        await assertFails(deleteDoc(doc(await as(players.b), profileA)));
        await assertFails(deleteDoc(doc(await anonymous(), profileA)));
        await assertSucceeds(deleteDoc(doc(await as(players.a), profileA)));
    });

    it('lets the owner delete a document that is not a consumer profile, or one that does not exist', async () => {
        await assertSucceeds(deleteDoc(doc(await as(players.unversioned), `users/${players.unversioned}`)));
        await assertSucceeds(deleteDoc(doc(await as(players.noProfile), `users/${players.noProfile}`)));
    });

    it('leaves the subcollections, which stay owner-read and never client-deleted', async () => {
        const database = await as(players.a);
        await assertSucceeds(deleteDoc(doc(database, profileA)));
        const sessionPath = `${profileA}/gameSessions/${seededSessionId}`;
        await assertSucceeds(getDoc(doc(database, sessionPath)));
        await assertFails(deleteDoc(doc(database, sessionPath)));
        await assertFails(deleteDoc(doc(database, `${profileA}/progress/mental-math`)));
        await assertFails(getDoc(doc(await as(players.b), sessionPath)));
    });

    it('allows creating a profile again only as a new consumer profile, stamped now, with consent granted anew', async () => {
        const database = await as(players.a);
        await assertSucceeds(deleteDoc(doc(database, profileA)));
        await assertFails(setDoc(doc(database, profileA), profileData({ createdAt: past })));
        await assertFails(setDoc(doc(database, profileA), profileData({ eeg: { enabled: true, consent: storedConsent, preferredDevice: null } })));
        await assertFails(setDoc(doc(database, profileA), { displayName: 'Player', role: 'patient' }));
        await assertSucceeds(setDoc(doc(database, profileA), profileData()));
    });
});
