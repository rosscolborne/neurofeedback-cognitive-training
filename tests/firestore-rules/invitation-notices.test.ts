import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clinicA, clinicB, closeEnvironment, emailOf, ids, past, resetWorld, seedDocuments } from './fixture';

// Code-free pending-invitation notices: patientInvitationNotices/{email}/clinicians/{clinicianId}.
// Shapes mirror storageEngine.createPatientInvitation, cancelPatientInvitation and acceptPatientInvitation.

beforeEach(resetWorld);
afterAll(closeEnvironment);

const email = emailOf(ids.unlinked);
const codeA = 'NOTA-AAAA-AAAA';
const codeB = 'NOTB-BBBB-BBBB';
const noticePath = (clinicianId: string, forEmail = email) => `patientInvitationNotices/${forEmail}/clinicians/${clinicianId}`;
const claimPath = (clinicianId: string, forEmail = email) => `patientInvitationClaims/${clinicianId}/emails/${forEmail}`;
const inOneWeek = () => Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

/** storageEngine.createPatientInvitation: invitation, claim and notice in one transaction. */
function createInvitation(database: Firestore, clinicianId: string, clinicId: string, code: string,
    notice: Record<string, unknown> | null = {}) {
    const expiresAt = inOneWeek();
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, claimPath(clinicianId)));
        transaction.set(doc(database, `patientInvitations/${code}`), {
            id: code, clinicianId, clinicId, clinicianName: 'Dr', patientEmail: email, patientName: 'Invited',
            condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending',
            uniquenessClaimId: email, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt,
        });
        transaction.set(doc(database, claimPath(clinicianId)), {
            clinicianId, clinicId, patientEmail: email, invitationId: code, status: 'pending', expiresAt, createdAt: serverTimestamp(),
        });
        if (notice) transaction.set(doc(database, noticePath(clinicianId)), { expiresAt, updatedAt: serverTimestamp(), ...notice });
    });
}

/** storageEngine.cancelPatientInvitation */
function cancelInvitation(database: Firestore, clinicianId: string, code: string) {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `patientInvitations/${code}`));
        transaction.set(doc(database, `patientInvitations/${code}`), { status: 'cancelled', updatedAt: serverTimestamp() }, { merge: true });
        transaction.delete(doc(database, claimPath(clinicianId)));
        transaction.delete(doc(database, noticePath(clinicianId)));
    });
}

/** storageEngine.acceptPatientInvitation, as the invited patient holding the code. */
function acceptInvitation(database: Firestore, clinicianId: string, clinicId: string, code: string) {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `patientInvitations/${code}`));
        await transaction.get(doc(database, `clients/${ids.unlinked}`));
        transaction.set(doc(database, `clients/${ids.unlinked}`), {
            clinicianId, clinicId, acceptedInvitationId: code, updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.set(doc(database, `patientInvitations/${code}`), {
            status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.delete(doc(database, claimPath(clinicianId)));
        transaction.delete(doc(database, noticePath(clinicianId)));
    });
}

async function inviteFromBoth() {
    await assertSucceeds(createInvitation(await as(ids.clinicianA), ids.clinicianA, clinicA, codeA));
    await assertSucceeds(createInvitation(await as(ids.clinicianB), ids.clinicianB, clinicB, codeB));
}

describe('invitation notice writes', () => {
    it('are written with the invitation and carry only an expiry', async () => {
        await inviteFromBoth();
        const notices = await getDocs(collection(await as(ids.unlinked), `patientInvitationNotices/${email}/clinicians`));
        expect(notices.docs.map((entry) => entry.id).sort()).toEqual([ids.clinicianA, ids.clinicianB]);
        for (const entry of notices.docs) expect(Object.keys(entry.data()).sort()).toEqual(['expiresAt', 'updatedAt']);
    });

    it('refuse a code or other extra fields, a mismatched expiry, and notices without a pending invitation', async () => {
        const clinician = await as(ids.clinicianA);
        await assertFails(createInvitation(clinician, ids.clinicianA, clinicA, codeA, { invitationId: codeA }));
        await assertFails(createInvitation(clinician, ids.clinicianA, clinicA, codeA, { expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000) }));
        // No claim or invitation behind it.
        await assertFails(setDoc(doc(clinician, noticePath(ids.clinicianA, emailOf(ids.roleless))), {
            expiresAt: inOneWeek(), updatedAt: serverTimestamp(),
        }));
    });

    it('cannot be forged for another clinician or by a patient', async () => {
        await inviteFromBoth();
        const expiresAt = inOneWeek();
        await assertFails(setDoc(doc(await as(ids.clinicianA), noticePath(ids.clinicianB)), { expiresAt, updatedAt: serverTimestamp() }));
        await assertFails(setDoc(doc(await as(ids.unlinked), noticePath(ids.newClinician)), { expiresAt, updatedAt: serverTimestamp() }));
    });
});

describe('invitation notice reads', () => {
    it('let an account read only the notices under its own email', async () => {
        await inviteFromBoth();
        await assertSucceeds(getDocs(collection(await as(ids.unlinked), `patientInvitationNotices/${email}/clinicians`)));
        await assertFails(getDocs(collection(await as(ids.patientA), `patientInvitationNotices/${email}/clinicians`)));
        await assertFails(getDoc(doc(await as(ids.patientA), noticePath(ids.clinicianA))));
        await assertFails(getDocs(collection(await as(ids.roleless), `patientInvitationNotices/${email}/clinicians`)));
        // Each clinician sees only their own notice.
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), noticePath(ids.clinicianA))));
        await assertFails(getDoc(doc(await as(ids.clinicianA), noticePath(ids.clinicianB))));
    });

    it('do not reveal a code: invitations and claims stay unreadable by email', async () => {
        await inviteFromBoth();
        const patient = await as(ids.unlinked);
        await assertFails(getDocs(query(collection(patient, 'patientInvitations'), where('patientEmail', '==', email))));
        await assertFails(getDoc(doc(patient, claimPath(ids.clinicianA))));
        await assertFails(getDocs(collection(patient, `patientInvitationClaims/${ids.clinicianA}/emails`)));
    });
});

describe('invitation notice lifecycle', () => {
    it('knowing a notice exists does not let the patient link without the invitation code', async () => {
        await inviteFromBoth();
        const patient = await as(ids.unlinked);
        // Linking straight to the clinician named by the notice is refused without a pending invitation ID.
        await assertFails(updateDoc(doc(patient, `clients/${ids.unlinked}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, updatedAt: serverTimestamp(),
        }));
        await assertFails(updateDoc(doc(patient, `clients/${ids.unlinked}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'GUES-SEDX-CODE', updatedAt: serverTimestamp(),
        }));
        await assertFails(getDoc(doc(patient, 'patientInvitations/GUES-SEDX-CODE')));
        // With the real code, acceptance works and removes only that clinician's notice.
        await assertSucceeds(acceptInvitation(patient, ids.clinicianA, clinicA, codeA));
        const remaining = await getDocs(collection(patient, `patientInvitationNotices/${email}/clinicians`));
        expect(remaining.docs.map((entry) => entry.id)).toEqual([ids.clinicianB]);
    });

    it('cancelling one clinician’s invitation keeps the other clinician’s notice', async () => {
        await inviteFromBoth();
        await assertSucceeds(cancelInvitation(await as(ids.clinicianA), ids.clinicianA, codeA));
        const remaining = await getDocs(collection(await as(ids.unlinked), `patientInvitationNotices/${email}/clinicians`));
        expect(remaining.docs.map((entry) => entry.id)).toEqual([ids.clinicianB]);
    });

    it('cannot be removed while its invitation is still pending, by the patient or the clinician', async () => {
        await inviteFromBoth();
        await assertFails(deleteDoc(doc(await as(ids.unlinked), noticePath(ids.clinicianA))));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), noticePath(ids.clinicianA))));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), noticePath(ids.clinicianB))));
    });

    it('follows a replacement invitation after the previous one expired', async () => {
        const expired = Timestamp.fromMillis(Date.now() - 60_000);
        await seedDocuments({
            'patientInvitations/OLDX-EXPI-REDX': {
                id: 'OLDX-EXPI-REDX', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, patientName: 'Invited',
                status: 'pending', uniquenessClaimId: email, expiresAt: expired, createdAt: past, updatedAt: past,
            },
            [claimPath(ids.clinicianA)]: {
                clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'OLDX-EXPI-REDX', status: 'pending', expiresAt: expired,
            },
            [noticePath(ids.clinicianA)]: { expiresAt: expired, updatedAt: past },
        });
        const clinician = await as(ids.clinicianA);
        const expiresAt = inOneWeek();
        const batch = writeBatch(clinician);
        batch.set(doc(clinician, `patientInvitations/${codeA}`), {
            id: codeA, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr', patientEmail: email, patientName: 'Invited',
            condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending',
            uniquenessClaimId: email, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt,
        });
        batch.set(doc(clinician, claimPath(ids.clinicianA)), {
            clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: codeA, status: 'pending', expiresAt, createdAt: serverTimestamp(),
        });
        batch.set(doc(clinician, noticePath(ids.clinicianA)), { expiresAt, updatedAt: serverTimestamp() });
        await assertSucceeds(batch.commit());
        const notice = await getDoc(doc(await as(ids.unlinked), noticePath(ids.clinicianA)));
        expect((notice.get('expiresAt') as Timestamp).toMillis()).toBe(expiresAt.toMillis());
    });
});
