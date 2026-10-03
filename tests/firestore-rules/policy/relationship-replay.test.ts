// Regression tests from the independent rules review: a patient can never write
// clinician relationship fields onto their own profile, even naming an invitation
// that was once accepted under the retired clinician product.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, ids, resetWorld } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const oldInvitation = 'INVA-AAAA-AAAA'; // seeded: accepted by patient-a, clinician-a, clinic-a

describe('relationship replay', () => {
    it('denies relinking by replaying an old invitation (update path)', async () => {
        const unlinked = await as(ids.unlinked);
        await assertFails(updateDoc(doc(unlinked, `clients/${ids.unlinked}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: oldInvitation,
        }));
        // A patient who still stores a relationship cannot move it either.
        await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
            clinicianId: ids.clinicianB, clinicId: ids.clinicianB, acceptedInvitationId: 'INVB-BBBB-BBBB',
        }));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `clients/${ids.unlinked}`)));
    });

    it('denies the same replay through delete and recreate of the profile (create path)', async () => {
        const unlinked = await as(ids.unlinked);
        await assertSucceeds(deleteDoc(doc(unlinked, `clients/${ids.unlinked}`)));
        await assertFails(setDoc(doc(unlinked, `clients/${ids.unlinked}`), {
            id: ids.unlinked, email: emailOf(ids.unlinked), name: 'Back again',
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: oldInvitation,
        }));
        await assertSucceeds(setDoc(doc(unlinked, `clients/${ids.unlinked}`), {
            id: ids.unlinked, email: emailOf(ids.unlinked), name: 'Back again',
        }));
    });
});
