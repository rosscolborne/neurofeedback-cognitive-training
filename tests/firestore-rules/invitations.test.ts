import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, clinicB, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const code = 'INVU-UUUU-UUUU';
const invitedEmail = emailOf(ids.unlinked);
const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`;

function invitation(overrides: Record<string, unknown> = {}) {
    return {
        id: code, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A',
        patientEmail: invitedEmail, patientName: 'Invited', condition: 'ADHD', assignedProtocol: 'theta-beta-ratio',
        prescribedSessionsPerWeek: 3, status: 'pending', uniquenessClaimId: invitedEmail, schemaVersion: 1,
        createdAt: past, updatedAt: past, expiresAt: future(),
        ...overrides,
    };
}

function claim(expiresAt: Timestamp, overrides: Record<string, unknown> = {}) {
    return {
        clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, invitationId: code,
        status: 'pending', expiresAt, createdAt: past, ...overrides,
    };
}

/** The app's createPatientInvitation transaction: invitation + uniqueness claim together. */
function createInvitation(database: Firestore, overrides: Record<string, unknown> = {}, claimOverrides: Record<string, unknown> = {}) {
    const expiresAt = (overrides.expiresAt as Timestamp | undefined) ?? future();
    const data = { ...invitation({ expiresAt, ...overrides }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const batch = writeBatch(database);
    batch.set(doc(database, `patientInvitations/${data.id}`), data);
    const clinicianId = (claimOverrides.clinicianId as string | undefined) ?? ids.clinicianA;
    const email = (claimOverrides.patientEmail as string | undefined) ?? data.patientEmail as string;
    batch.set(doc(database, `patientInvitationClaims/${clinicianId}/emails/${email}`), {
        ...claim(expiresAt, { clinicId: data.clinicId, patientEmail: data.patientEmail, invitationId: data.id }),
        createdAt: serverTimestamp(),
        ...claimOverrides,
    });
    return batch.commit();
}

/** The app's acceptPatientInvitation transaction. */
function acceptInvitation(database: Firestore, patientId: string, options: { releaseClaim?: boolean; clinicianId?: string } = {}) {
    const batch = writeBatch(database);
    batch.update(doc(database, `patientInvitations/${code}`), {
        status: 'accepted', patientId, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(database, `clients/${patientId}`), {
        clinicianId: options.clinicianId ?? ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code, updatedAt: serverTimestamp(),
    }, { merge: true });
    if (options.releaseClaim ?? true) batch.delete(doc(database, claimPath));
    return batch.commit();
}

async function seedPendingInvitation(overrides: Record<string, unknown> = {}) {
    const expiresAt = (overrides.expiresAt as Timestamp | undefined) ?? future();
    await seedDocuments({
        [`patientInvitations/${code}`]: invitation({ expiresAt, ...overrides }),
        [claimPath]: claim(expiresAt),
    });
}

describe('invitation creation', () => {
    it('lets a practitioner create an invitation and its claim atomically', async () => {
        await assertSucceeds(createInvitation(await as(ids.clinicianA)));
    });

    it('rejects an invitation without its uniqueness claim', async () => {
        const database = await as(ids.clinicianA);
        await assertFails(setDoc(doc(database, `patientInvitations/${code}`), {
            ...invitation(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
    });

    it('rejects role-less users, patients, and clinicians without a practitioner record', async () => {
        await assertFails(createInvitation(await as(ids.roleless), { clinicianId: ids.roleless }, { clinicianId: ids.roleless }));
        await assertFails(createInvitation(await as(ids.patientA), { clinicianId: ids.patientA }, { clinicianId: ids.patientA }));
        await assertFails(createInvitation(await as(ids.newClinician), { clinicianId: ids.newClinician, clinicId: ids.newClinician }, {
            clinicianId: ids.newClinician,
        }));
    });

    it('rejects forged clinician identity, a foreign clinic, a self-invitation, and bad expiry', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertFails(createInvitation(clinicianA, { clinicianId: ids.clinicianB }));
        await assertFails(createInvitation(clinicianA, { clinicId: clinicB }));
        const selfEmail = emailOf(ids.clinicianA);
        await assertFails(createInvitation(clinicianA, { patientEmail: selfEmail, uniquenessClaimId: selfEmail }));
        await assertFails(createInvitation(clinicianA, { expiresAt: Timestamp.fromMillis(Date.now() + 40 * 24 * 60 * 60 * 1000) }));
        await assertFails(createInvitation(clinicianA, { expiresAt: Timestamp.fromMillis(Date.now() - 60_000) }));
        await assertFails(createInvitation(clinicianA, { patientEmail: 'Mixed@Example.test', uniquenessClaimId: 'Mixed@Example.test' }));
    });

    it('rejects a second live invitation for the same patient email', async () => {
        await seedPendingInvitation();
        await assertFails(createInvitation(await as(ids.clinicianA), { id: 'INVU-SECO-NDXX' }));
    });
});

describe('invitation reads', () => {
    it('lets the inviting clinician list and read their invitations', async () => {
        await seedPendingInvitation();
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(clinicianA, `patientInvitations/${code}`)));
        await assertSucceeds(getDocs(query(collection(clinicianA, 'patientInvitations'), where('clinicianId', '==', ids.clinicianA))));
    });

    it('lets the invited account read the invitation by code, but not enumerate invitations by email', async () => {
        await seedPendingInvitation();
        const invited = await as(ids.unlinked);
        await assertSucceeds(getDoc(doc(invited, `patientInvitations/${code}`)));
        await assertFails(getDocs(query(collection(invited, 'patientInvitations'), where('patientEmail', '==', invitedEmail))));
    });

    it('denies other patients and other clinicians', async () => {
        await seedPendingInvitation();
        await assertFails(getDoc(doc(await as(ids.patientA), `patientInvitations/${code}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `patientInvitations/${code}`)));
        await assertFails(getDocs(query(collection(await as(ids.clinicianB), 'patientInvitations'), where('clinicianId', '==', ids.clinicianA))));
    });
});

describe('invitation acceptance', () => {
    it('lets the invited, unlinked patient accept and link atomically', async () => {
        await seedPendingInvitation();
        await assertSucceeds(acceptInvitation(await as(ids.unlinked), ids.unlinked));
    });

    it('rejects acceptance by another account, even one that names itself as the patient', async () => {
        await seedPendingInvitation();
        await assertFails(acceptInvitation(await as(ids.patientB), ids.patientB));
        await assertFails(acceptInvitation(await as(ids.patientB), ids.unlinked));
    });

    it('rejects acceptance that keeps the claim, links a different clinician, or uses an expired invitation', async () => {
        await seedPendingInvitation();
        await assertFails(acceptInvitation(await as(ids.unlinked), ids.unlinked, { releaseClaim: false }));
        await assertFails(acceptInvitation(await as(ids.unlinked), ids.unlinked, { clinicianId: ids.clinicianB }));
        await seedPendingInvitation({ expiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
        await assertFails(acceptInvitation(await as(ids.unlinked), ids.unlinked));
    });

    it('rejects acceptance by a patient who is already linked', async () => {
        const linkedEmail = emailOf(ids.patientB);
        await seedDocuments({
            [`patientInvitations/${code}`]: invitation({ patientEmail: linkedEmail, uniquenessClaimId: linkedEmail }),
            [`patientInvitationClaims/${ids.clinicianA}/emails/${linkedEmail}`]: claim(future(), { patientEmail: linkedEmail }),
        });
        const patientB = await as(ids.patientB);
        const batch = writeBatch(patientB);
        batch.update(doc(patientB, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.patientB, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(patientB, `clients/${ids.patientB}`), { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code }, { merge: true });
        batch.delete(doc(patientB, `patientInvitationClaims/${ids.clinicianA}/emails/${linkedEmail}`));
        await assertFails(batch.commit());
    });

    it('rejects the inviting clinician accepting their own invitation', async () => {
        await seedPendingInvitation({ patientEmail: emailOf(ids.clinicianA), uniquenessClaimId: emailOf(ids.clinicianA) });
        await assertFails(updateDoc(doc(await as(ids.clinicianA), `patientInvitations/${code}`), {
            status: 'accepted', patientId: ids.clinicianA, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
    });
});

describe('invitation cancellation and claims', () => {
    it('lets the inviting clinician cancel while releasing the claim', async () => {
        await seedPendingInvitation();
        const clinicianA = await as(ids.clinicianA);
        const batch = writeBatch(clinicianA);
        batch.update(doc(clinicianA, `patientInvitations/${code}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianA, claimPath));
        await assertSucceeds(batch.commit());
    });

    it('rejects cancellation that keeps the claim or comes from another clinician', async () => {
        await seedPendingInvitation();
        await assertFails(updateDoc(doc(await as(ids.clinicianA), `patientInvitations/${code}`), { status: 'cancelled', updatedAt: serverTimestamp() }));
        const clinicianB = await as(ids.clinicianB);
        const batch = writeBatch(clinicianB);
        batch.update(doc(clinicianB, `patientInvitations/${code}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianB, claimPath));
        await assertFails(batch.commit());
    });

    it('never lets an invitation be deleted', async () => {
        await seedPendingInvitation();
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), `patientInvitations/${code}`)));
    });

    it('keeps claims private to their clinician and undeletable while the invitation is pending', async () => {
        await seedPendingInvitation();
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), claimPath)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), claimPath)));
        await assertFails(getDoc(doc(await as(ids.unlinked), claimPath)));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), claimPath)));
        await assertFails(deleteDoc(doc(await as(ids.unlinked), claimPath)));
    });

    it('lets a clinician replace only an expired claim, bound to a matching new invitation', async () => {
        const expired = Timestamp.fromMillis(Date.now() - 60_000);
        await seedDocuments({
            [`patientInvitations/${code}`]: invitation({ expiresAt: expired }),
            [claimPath]: claim(expired),
        });
        const clinicianA = await as(ids.clinicianA);
        const expiresAt = future();
        const batch = writeBatch(clinicianA);
        batch.set(doc(clinicianA, 'patientInvitations/INVU-NEWX-XXXX'), {
            ...invitation({ id: 'INVU-NEWX-XXXX', expiresAt }), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        batch.set(doc(clinicianA, claimPath), { ...claim(expiresAt, { invitationId: 'INVU-NEWX-XXXX' }), createdAt: serverTimestamp() });
        await assertSucceeds(batch.commit());
    });
});
