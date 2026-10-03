import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
        await assertSucceeds(setDoc(doc(database, `clients/${fresh}`), { id: fresh, email: emailOf(fresh), name: 'New', status: 'active', brainMaps: [], isDemo: false }));
    });

    // storageEngine.saveClient: the whole read-back profile, with an edit, merged back.
    it('storageEngine.saveClient merges a read-back profile with an edit, including profiles linked under the retired clinician product', async () => {
        for (const uid of [ids.patientA, ids.legacyPatient, ids.splitPatient, ids.unlinked]) {
            const database = await as(uid);
            const stored = (await getDoc(doc(database, `clients/${uid}`))).data()!;
            await assertSucceeds(setDoc(doc(database, `clients/${uid}`), { ...stored, avatarUrl: 'data:image/png;base64,AAAA' }, { merge: true }));
        }
    });

    it('a profile save cannot clear or change the relationship fields, and nothing saves once deletion has started', async () => {
        const database = await as(ids.patientA);
        const reference = doc(database, `clients/${ids.patientA}`);
        const stored = (await getDoc(reference)).data()!;
        await assertFails(setDoc(reference, { ...stored, clinicianId: null }, { merge: true }));
        await assertFails(setDoc(reference, { ...stored, clinicId: 'other-clinic' }, { merge: true }));
        const withoutRelationship = { ...stored };
        for (const field of ['clinicianId', 'clinicId', 'acceptedInvitationId']) delete withoutRelationship[field];
        await assertFails(setDoc(reference, withoutRelationship));

        await assertSucceeds(updateDoc(reference, {
            accountDeletionStartedAt: serverTimestamp(), clinicianId: null, linkedClinicianCode: null,
            clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
        }));
        await assertFails(setDoc(reference, { ...stored, avatarUrl: 'data:image/png;base64,AAAA' }, { merge: true }));
        const marked = (await getDoc(reference)).data()!;
        await assertFails(setDoc(reference, { ...marked, avatarUrl: 'data:image/png;base64,AAAA' }, { merge: true }));
    });
});
