// Regression tests from the independent rules review: an invitation accepted
// earlier cannot be replayed to relink after the clinician unlinks.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, ids, resetWorld } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const oldInvitation = 'INVA-AAAA-AAAA'; // seeded: accepted by patient-a, clinician-a, clinic-a

async function clinicianUnlinksPatientA() {
    await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), {
        clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null,
    }));
    // Precondition: the clinician's access really is gone.
    await assertFails(getDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
}

function patientSends(database: Firestore, messageId: string) {
    const threadPath = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;
    const batch = writeBatch(database);
    batch.set(doc(database, threadPath), {
        patientId: ids.patientA, clinicianId: ids.clinicianA, participantIds: [ids.patientA, ids.clinicianA],
        lastMessageText: 'I am back', lastMessageId: messageId, lastSenderId: ids.patientA,
        lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 1,
    }, { merge: true });
    batch.set(doc(database, `${threadPath}/messages/${messageId}`), {
        id: messageId, patientId: ids.patientA, clinicianId: ids.clinicianA, senderId: ids.patientA,
        senderRole: 'patient', text: 'I am back', createdAt: serverTimestamp(), schemaVersion: 1,
    });
    return batch.commit();
}

describe('accepted-invitation replay after clinician unlink', () => {
    it('denies relinking by replaying the old invitation (update path)', async () => {
        await clinicianUnlinksPatientA();
        const patientA = await as(ids.patientA);
        await assertFails(updateDoc(doc(patientA, `clients/${ids.patientA}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: oldInvitation,
        }));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
        await assertFails(patientSends(patientA, 'replayed-msg'));
    });

    it('denies the same replay through delete and recreate of the profile (create path)', async () => {
        await clinicianUnlinksPatientA();
        const patientA = await as(ids.patientA);
        await assertSucceeds(deleteDoc(doc(patientA, `clients/${ids.patientA}`)));
        await assertFails(setDoc(doc(patientA, `clients/${ids.patientA}`), {
            id: ids.patientA, email: emailOf(ids.patientA), name: 'Back again',
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: oldInvitation,
        }));
    });

    it('the replay cannot target a clinician whose invitation the patient never accepted', async () => {
        await clinicianUnlinksPatientA();
        await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
            clinicianId: ids.clinicianB, clinicId: ids.clinicianB, acceptedInvitationId: 'INVB-BBBB-BBBB',
        }));
    });
});
