import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import {
    anonymous, as, clinicA, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, seededAppointmentId, seededMessageId,
} from './fixture';

// The clinician product is retired. Its collections have no rules, so the
// default deny covers documents left behind in them, for the people who used
// them (patient-a and clinician-a, linked under that product) and everyone else.

beforeEach(resetWorld);
afterAll(closeEnvironment);

const invitedEmail = emailOf(ids.unlinked);
const thread = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;
const residualDocuments = [
    'patientInvitations/INVA-AAAA-AAAA',
    'patientInvitations/PEND-INGI-NVIT',
    `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`,
    `patientInvitationNotices/${invitedEmail}/clinicians/${ids.clinicianA}`,
    thread,
    `${thread}/messages/${seededMessageId}`,
    `${thread}/reads/${ids.patientA}`,
    `messages/${ids.patientA}`,
    `appointments/${seededAppointmentId}`,
    'appointments/legacy-appointment-for-a',
    `clinics/${clinicA}`,
    `practitioners/${ids.clinicianA}`,
];

async function seedResidualRelationshipRecords() {
    await seedDocuments({
        'patientInvitations/PEND-INGI-NVIT': {
            id: 'PEND-INGI-NVIT', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail,
            patientName: 'U', status: 'pending', uniquenessClaimId: invitedEmail, assignedProtocol: 'theta-beta-ratio',
            createdAt: past, updatedAt: past, expiresAt: future(), schemaVersion: 1,
        },
        [`patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`]: {
            clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, invitationId: 'PEND-INGI-NVIT',
            status: 'pending', expiresAt: future(), createdAt: past,
        },
        [`patientInvitationNotices/${invitedEmail}/clinicians/${ids.clinicianA}`]: { expiresAt: future(), updatedAt: past },
        [`${thread}/reads/${ids.patientA}`]: { readerId: ids.patientA, lastReadMessageId: seededMessageId, updatedAt: past },
    });
}

describe('retired clinician collections', () => {
    it('deny reads of every residual document to its former participants and everyone else', async () => {
        await seedResidualRelationshipRecords();
        for (const uid of [ids.patientA, ids.clinicianA, ids.colleagueA, ids.unlinked, ids.patientB, ids.roleless]) {
            const database = await as(uid);
            for (const path of residualDocuments) await assertFails(getDoc(doc(database, path)));
        }
        const anyone = await anonymous();
        for (const path of residualDocuments) await assertFails(getDoc(doc(anyone, path)));
    });

    it('deny the queries the retired screens issued', async () => {
        await seedResidualRelationshipRecords();
        const patientA = await as(ids.patientA);
        const clinicianA = await as(ids.clinicianA);
        await assertFails(getDocs(query(collection(patientA, 'appointments'), where('patientId', '==', ids.patientA))));
        await assertFails(getDocs(query(collection(clinicianA, 'appointments'), where('clinicianId', '==', ids.clinicianA))));
        await assertFails(getDocs(collection(patientA, `${thread}/messages`)));
        await assertFails(getDocs(collection(await as(ids.unlinked), `patientInvitationNotices/${invitedEmail}/clinicians`)));
        await assertFails(getDocs(query(collection(clinicianA, 'patientInvitations'), where('clinicianId', '==', ids.clinicianA))));
        await assertFails(getDocs(query(collection(clinicianA, 'practitioners'), where('clinicId', '==', clinicA))));
    });

    it('deny every write, including the flows the retired product used', async () => {
        await seedResidualRelationshipRecords();
        const clinicianA = await as(ids.clinicianA);
        const patientA = await as(ids.patientA);
        const invited = await as(ids.unlinked);

        // Clinic onboarding by an account that still has the clinician role.
        const newClinician = await as(ids.newClinician);
        const onboarding = writeBatch(newClinician);
        onboarding.set(doc(newClinician, `clinics/${ids.newClinician}`), { id: ids.newClinician, name: 'New clinic', practitionerIds: [ids.newClinician] });
        onboarding.set(doc(newClinician, `practitioners/${ids.newClinician}`), { id: ids.newClinician, userId: ids.newClinician, clinicId: ids.newClinician });
        await assertFails(onboarding.commit());
        await assertFails(updateDoc(doc(clinicianA, `clinics/${clinicA}`), { branding: { name: 'Rebranded' } }));

        // Creating an invitation, and accepting the pending one.
        await assertFails(setDoc(doc(clinicianA, 'patientInvitations/NEWI-NVIT-EEEE'), {
            id: 'NEWI-NVIT-EEEE', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: emailOf(ids.patientB),
            status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt: future(),
        }));
        const accept = writeBatch(invited);
        accept.update(doc(invited, 'patientInvitations/PEND-INGI-NVIT'), { status: 'accepted', patientId: ids.unlinked, updatedAt: serverTimestamp() });
        accept.set(doc(invited, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'PEND-INGI-NVIT' }, { merge: true });
        await assertFails(accept.commit());
        await assertFails(deleteDoc(doc(clinicianA, `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`)));
        await assertFails(deleteDoc(doc(invited, `patientInvitationNotices/${invitedEmail}/clinicians/${ids.clinicianA}`)));

        // Messages, read receipts and appointments, from either side.
        for (const database of [patientA, clinicianA]) {
            await assertFails(setDoc(doc(database, `${thread}/messages/new-message`), { text: 'hello', createdAt: serverTimestamp() }));
            await assertFails(updateDoc(doc(database, thread), { lastMessageText: 'edited' }));
            await assertFails(setDoc(doc(database, `${thread}/reads/${ids.patientA}`), { lastReadMessageId: seededMessageId }));
            await assertFails(updateDoc(doc(database, `appointments/${seededAppointmentId}`), {
                status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.patientA, updatedAt: serverTimestamp(), revision: 2,
            }));
        }
        await assertFails(setDoc(doc(clinicianA, 'appointments/appt_newnewnewnewnewnewnewnewn'), {
            clinicianId: ids.clinicianA, patientId: ids.patientA, startsAt: future(), status: 'scheduled',
        }));
    });
});

describe('retired legacy collections (brands, protocolCatalog)', () => {
    it('falls under the default deny for every client', async () => {
        await assertFails(getDoc(doc(await anonymous(), 'brands/brand-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'brands/brand-a')));
        await assertFails(setDoc(doc(await as(ids.clinicianB), 'brands/brand-a'), { name: 'Defaced' }));
        await assertFails(setDoc(doc(await as(ids.patientA), 'brands/new-brand'), { name: 'Spam' }));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), 'brands/brand-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'protocolCatalog/protocol-a')));
        await assertFails(getDoc(doc(await as(ids.patientA), 'protocolCatalog/protocol-a')));
        await assertFails(setDoc(doc(await as(ids.clinicianA), 'protocolCatalog/new-a'), { id: 'new-a', clinicId: clinicA, name: 'A2' }));
        await assertFails(updateDoc(doc(await as(ids.colleagueA), 'protocolCatalog/protocol-a'), { name: 'Renamed' }));
    });
});

describe('role selection (documents current policy until Phase 2 removes the role)', () => {
    it('lets any signed-in user choose the clinician role for their own account, which grants nothing', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.unlinked), `users/${ids.unlinked}`), { role: 'clinician' }, { merge: true }));
        const selfPromoted = await as(ids.unlinked);
        await assertFails(getDoc(doc(selfPromoted, `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(selfPromoted, 'sessions/session-a')));
        const onboarding = writeBatch(selfPromoted);
        onboarding.set(doc(selfPromoted, `clinics/${ids.unlinked}`), { id: ids.unlinked, name: 'Self-made clinic', practitionerIds: [ids.unlinked] });
        onboarding.set(doc(selfPromoted, `practitioners/${ids.unlinked}`), { id: ids.unlinked, userId: ids.unlinked, clinicId: ids.unlinked });
        await assertFails(onboarding.commit());
    });
});
