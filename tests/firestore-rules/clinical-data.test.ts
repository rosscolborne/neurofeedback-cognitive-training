import { assertFails } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, closeEnvironment, ids, past, resetWorld } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('sessions/{sessionId} (retired neurofeedback session records)', () => {
    it('falls under the default deny for everyone, including the patient who owns a stored record', async () => {
        const patientA = await as(ids.patientA);
        await assertFails(getDoc(doc(patientA, 'sessions/session-a')));
        await assertFails(getDocs(query(collection(patientA, 'sessions'), where('patientId', '==', ids.patientA))));
        await assertFails(setDoc(doc(patientA, 'sessions/new-a'), { patientId: ids.patientA, clinicId: 'self-guided', isDemo: true, createdAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { patientNotes: 'felt focused', moodRating: 4, updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(doc(patientA, 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
        await assertFails(getDoc(doc(await anonymous(), 'sessions/session-a')));
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
