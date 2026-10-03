import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, clinicA, closeEnvironment, ids, past, resetWorld } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

function session(patientId: string, clinicId: string, extra: Record<string, unknown> = {}) {
    return { patientId, clinicId, isDemo: true, timeInZonePercent: 40, createdAt: serverTimestamp(), ...extra };
}

describe('sessions', () => {
    it('lets a patient record their own session, and nobody else record one for them', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.patientA), 'sessions/new-a'), session(ids.patientA, 'self-guided')));
        // patient-a's former clinician under the retired clinician product.
        await assertFails(setDoc(doc(await as(ids.clinicianA), 'sessions/new-a2'), session(ids.patientA, clinicA, { clinicianId: ids.clinicianA })));
        await assertFails(setDoc(doc(await as(ids.patientB), 'sessions/forged'), session(ids.patientA, clinicA)));
        await assertFails(setDoc(doc(await as(ids.clinicianB), 'sessions/forged'), session(ids.patientA, clinicA)));
        await assertFails(setDoc(doc(await anonymous(), 'sessions/forged'), session(ids.patientA, clinicA)));
    });

    it('limits reads to the patient', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.colleagueA), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.patientB), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianB), 'sessions/session-a')));
        await assertFails(getDoc(doc(await anonymous(), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/session-split')));
        await assertFails(getDoc(doc(await as(ids.clinicianB), 'sessions/session-split')));
    });

    it('does not let a session clinicId label expose data to anyone else', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.patientB), 'sessions/b-claims-clinic-a'), session(ids.patientB, clinicA)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/b-claims-clinic-a')));
        await assertFails(getDoc(doc(await as(ids.colleagueA), 'sessions/b-claims-clinic-a')));
    });

    it("supports the patient's own session query and rejects it for everyone else", async () => {
        const byPatient = (database: Firestore, patientId: string) =>
            getDocs(query(collection(database, 'sessions'), where('patientId', '==', patientId)));
        await assertSucceeds(byPatient(await as(ids.patientA), ids.patientA));
        await assertFails(byPatient(await as(ids.clinicianA), ids.patientA));
        await assertFails(getDocs(query(collection(await as(ids.colleagueA), 'sessions'),
            where('patientId', '==', ids.patientA), where('clinicId', '==', clinicA))));
        await assertFails(byPatient(await as(ids.clinicianB), ids.patientA));
        await assertFails(byPatient(await as(ids.patientB), ids.patientA));
    });

    it("allows only the patient's own note updates and freezes measurements and ownership", async () => {
        const patientA = await as(ids.patientA);
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(patientA, 'sessions/session-a'), { patientNotes: 'felt focused', moodRating: 4, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(clinicianA, 'sessions/session-a'), { clinicianNotes: 'good', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { timeInZonePercent: 99 }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { clinicianNotes: 'self-review' }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { clinicId: 'self-guided' }));
        await assertFails(updateDoc(doc(clinicianA, 'sessions/session-a'), { patientNotes: 'edited by clinician' }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { patientId: ids.patientB }));
        await assertFails(updateDoc(doc(await as(ids.patientB), 'sessions/session-a'), { patientNotes: 'x' }));
    });

    it('never allows session deletion', async () => {
        await assertFails(deleteDoc(doc(await as(ids.patientA), 'sessions/session-a')));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
    });
});

describe('clients/{patientId}/brainMaps (retired QEEG records)', () => {
    const path = (id: string) => `clients/${ids.patientA}/brainMaps/${id}`;

    it('falls under the default deny for everyone, including the patient and their former clinician', async () => {
        await assertFails(getDoc(doc(await as(ids.patientA), path('bm-a'))));
        await assertFails(getDocs(collection(await as(ids.clinicianA), `clients/${ids.patientA}/brainMaps`)));
        await assertFails(setDoc(doc(await as(ids.clinicianA), path('qeeg-1')), { id: 'qeeg-1', createdBy: ids.clinicianA, recordedAt: past }));
        await assertFails(setDoc(doc(await as(ids.patientA), path('qeeg-1')), { id: 'qeeg-1', createdBy: ids.patientA }));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), path('bm-a'))));
    });
});

describe('deviceAssignments/{patientId} (retired, no client)', () => {
    it('falls under the default deny, even for the patient', async () => {
        await assertFails(getDoc(doc(await as(ids.patientA), `deviceAssignments/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `deviceAssignments/${ids.patientA}`)));
        await assertFails(updateDoc(doc(await as(ids.patientA), `deviceAssignments/${ids.patientA}`), { deviceId: 'muse-2' }));
        await assertFails(setDoc(doc(await as(ids.patientB), `deviceAssignments/${ids.patientB}`), {
            patientId: ids.patientB, assignedByUserId: ids.patientB, assignedAt: past, deviceId: 'muse-3',
        }));
    });
});
