import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, future, ids, past, resetWorld, seededAppointmentId } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const newId = 'appt_bbbbbbbbbbbbbbbbbbbbbbbb';

function appointment(clinicianId: string, patientId: string, overrides: Record<string, unknown> = {}) {
    return {
        clinicianId, patientId, patientDisplayName: `Name ${patientId}`, startsAt: future(), timezone: 'America/Toronto',
        durationMinutes: 45, type: 'remote-training', status: 'scheduled', notes: 'check-in',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: clinicianId, revision: 1, schemaVersion: 1,
        ...overrides,
    };
}

describe('appointment creation', () => {
    it('lets a canonical clinician schedule for their linked patient', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.clinicianA), `appointments/${newId}`), appointment(ids.clinicianA, ids.patientA)));
    });

    it('rejects patients, unrelated clinicians, colleagues, and role-less users', async () => {
        await assertFails(setDoc(doc(await as(ids.patientA), `appointments/${newId}`), appointment(ids.patientA, ids.patientA)));
        await assertFails(setDoc(doc(await as(ids.clinicianB), `appointments/${newId}`), appointment(ids.clinicianB, ids.patientA)));
        await assertFails(setDoc(doc(await as(ids.colleagueA), `appointments/${newId}`), appointment(ids.colleagueA, ids.patientA)));
        await assertFails(setDoc(doc(await as(ids.roleless), `appointments/${newId}`), appointment(ids.roleless, ids.unlinked)));
        await assertFails(setDoc(doc(await anonymous(), `appointments/${newId}`), appointment(ids.clinicianA, ids.patientA)));
    });

    it('rejects forged ownership, display names, timestamps, and malformed fields', async () => {
        const clinicianA = await as(ids.clinicianA);
        const create = (overrides: Record<string, unknown>, id = newId) => setDoc(doc(clinicianA, `appointments/${id}`), appointment(ids.clinicianA, ids.patientA, overrides));
        await assertFails(create({ clinicianId: ids.clinicianB }));
        await assertFails(create({ createdBy: ids.clinicianB }));
        await assertFails(create({ patientDisplayName: 'Someone else' }));
        await assertFails(create({ createdAt: past }));
        await assertFails(create({ revision: 5 }));
        await assertFails(create({ status: 'cancelled' }));
        await assertFails(create({ durationMinutes: 5 }));
        await assertFails(create({ type: 'surgery' }));
        await assertFails(create({ extra: 'field' }));
        await assertFails(create({}, 'short-id'));
        await assertFails(setDoc(doc(clinicianA, `appointments/${newId}`), appointment(ids.clinicianA, ids.splitPatient)));
    });
});

describe('appointment reads and queries', () => {
    const byPatient = (database: Firestore, clinicianId: string, patientId: string) => getDocs(query(
        collection(database, 'appointments'), where('clinicianId', '==', clinicianId), where('patientId', '==', patientId)));

    it('lets the patient and canonical clinician read, including the app query shapes', async () => {
        const patientA = await as(ids.patientA);
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(patientA, `appointments/${seededAppointmentId}`)));
        await assertSucceeds(getDoc(doc(clinicianA, `appointments/${seededAppointmentId}`)));
        await assertSucceeds(getDocs(query(collection(patientA, 'appointments'), where('patientId', '==', ids.patientA))));
        await assertSucceeds(getDocs(query(collection(patientA, 'appointments'), where('clientId', '==', ids.patientA), where('patientId', '==', null))));
        await assertSucceeds(byPatient(clinicianA, ids.clinicianA, ids.patientA));
        await assertSucceeds(getDocs(query(collection(clinicianA, 'appointments'),
            where('clinicianId', '==', ids.clinicianA), where('clientId', '==', ids.patientA), where('patientId', '==', null))));
    });

    it('denies other patients, other clinicians, colleagues, anonymous users, and broad queries', async () => {
        await assertFails(getDoc(doc(await as(ids.patientB), `appointments/${seededAppointmentId}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `appointments/${seededAppointmentId}`)));
        await assertFails(getDoc(doc(await as(ids.colleagueA), `appointments/${seededAppointmentId}`)));
        await assertFails(getDoc(doc(await anonymous(), `appointments/${seededAppointmentId}`)));
        await assertFails(getDocs(query(collection(await as(ids.patientB), 'appointments'), where('patientId', '==', ids.patientA))));
        await assertFails(byPatient(await as(ids.clinicianB), ids.clinicianB, ids.patientA));
        await assertFails(getDocs(query(collection(await as(ids.clinicianA), 'appointments'), where('clinicianId', '==', ids.clinicianA))));
    });
});

describe('appointment edits and cancellation', () => {
    it('lets the owning clinician edit schedule fields with the next revision', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `appointments/${seededAppointmentId}`), {
            durationMinutes: 60, type: 'protocol-review', notes: 'edited', updatedAt: serverTimestamp(), revision: 2,
        }));
    });

    it('rejects edits that skip revisions, move the appointment to another patient, or change authorship', async () => {
        const clinicianA = await as(ids.clinicianA);
        const reference = doc(clinicianA, `appointments/${seededAppointmentId}`);
        await assertFails(updateDoc(reference, { notes: 'edited', updatedAt: serverTimestamp(), revision: 1 }));
        await assertFails(updateDoc(reference, { patientId: ids.patientB, updatedAt: serverTimestamp(), revision: 2 }));
        await assertFails(updateDoc(reference, { createdBy: ids.clinicianB, updatedAt: serverTimestamp(), revision: 2 }));
        await assertFails(updateDoc(reference, { status: 'completed', updatedAt: serverTimestamp(), revision: 2 }));
    });

    it('lets the owning clinician cancel with a request ID, once', async () => {
        const reference = doc(await as(ids.clinicianA), `appointments/${seededAppointmentId}`);
        await assertSucceeds(updateDoc(reference, {
            status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.clinicianA,
            cancellationRequestId: 'cancel_aaaaaaaaaaaaaaaaaaaaaaaa', updatedAt: serverTimestamp(), revision: 2,
        }));
        await assertFails(updateDoc(reference, { notes: 'after cancel', updatedAt: serverTimestamp(), revision: 3 }));
    });

    it('rejects edits from the patient, other clinicians, and deletion by anyone', async () => {
        await assertFails(updateDoc(doc(await as(ids.patientA), `appointments/${seededAppointmentId}`), {
            status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.patientA,
            cancellationRequestId: 'cancel_aaaaaaaaaaaaaaaaaaaaaaaa', updatedAt: serverTimestamp(), revision: 2,
        }));
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `appointments/${seededAppointmentId}`), {
            notes: 'x', updatedAt: serverTimestamp(), revision: 2,
        }));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), `appointments/${seededAppointmentId}`)));
        await assertFails(deleteDoc(doc(await as(ids.patientA), `appointments/${seededAppointmentId}`)));
    });
});
