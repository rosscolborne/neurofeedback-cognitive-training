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
    it('lets a patient record their own session and their clinician record one for them', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.patientA), 'sessions/new-a'), session(ids.patientA, clinicA)));
        await assertSucceeds(setDoc(doc(await as(ids.clinicianA), 'sessions/new-a2'), session(ids.patientA, clinicA, { clinicianId: ids.clinicianA })));
    });

    it("rejects sessions written for someone else's patient", async () => {
        await assertFails(setDoc(doc(await as(ids.patientB), 'sessions/forged'), session(ids.patientA, clinicA)));
        await assertFails(setDoc(doc(await as(ids.clinicianB), 'sessions/forged'), session(ids.patientA, clinicA)));
        await assertFails(setDoc(doc(await anonymous(), 'sessions/forged'), session(ids.patientA, clinicA)));
    });

    it('limits reads to the patient, their canonical clinician, and their current clinic', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(await as(ids.colleagueA), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.patientB), 'sessions/session-a')));
        await assertFails(getDoc(doc(await as(ids.clinicianB), 'sessions/session-a')));
        await assertFails(getDoc(doc(await anonymous(), 'sessions/session-a')));
        // A stale legacy link does not reach a split-brain patient's sessions.
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/session-split')));
    });

    it('does not let a forged session clinicId expose data to another clinic', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.patientB), 'sessions/b-claims-clinic-a'), session(ids.patientB, clinicA)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/b-claims-clinic-a')));
        await assertFails(getDoc(doc(await as(ids.colleagueA), 'sessions/b-claims-clinic-a')));
    });

    it('supports the per-patient session queries the app issues, and rejects them for outsiders', async () => {
        const byPatient = (database: Firestore, patientId: string) =>
            getDocs(query(collection(database, 'sessions'), where('patientId', '==', patientId)));
        await assertSucceeds(byPatient(await as(ids.patientA), ids.patientA));
        await assertSucceeds(byPatient(await as(ids.clinicianA), ids.patientA));
        await assertSucceeds(getDocs(query(collection(await as(ids.colleagueA), 'sessions'),
            where('patientId', '==', ids.patientA), where('clinicId', '==', clinicA))));
        await assertFails(byPatient(await as(ids.clinicianB), ids.patientA));
        await assertFails(byPatient(await as(ids.patientB), ids.patientA));
    });

    it('allows note-only updates by the right party and freezes measurements and ownership', async () => {
        const patientA = await as(ids.patientA);
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(patientA, 'sessions/session-a'), { patientNotes: 'felt focused', moodRating: 4, updatedAt: serverTimestamp() }));
        await assertSucceeds(updateDoc(doc(clinicianA, 'sessions/session-a'), { clinicianNotes: 'good', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { timeInZonePercent: 99 }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { clinicianNotes: 'self-review' }));
        await assertFails(updateDoc(doc(clinicianA, 'sessions/session-a'), { patientNotes: 'edited by clinician' }));
        await assertFails(updateDoc(doc(clinicianA, 'sessions/session-a'), { timeInZonePercent: 99 }));
        await assertFails(updateDoc(doc(patientA, 'sessions/session-a'), { patientId: ids.patientB }));
        await assertFails(updateDoc(doc(await as(ids.clinicianB), 'sessions/session-a'), { clinicianNotes: 'x' }));
    });

    it('never allows session deletion', async () => {
        await assertFails(deleteDoc(doc(await as(ids.patientA), 'sessions/session-a')));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
    });
});

function brainMap(id: string, createdBy: string, overrides: Record<string, unknown> = {}) {
    return {
        id, uploadDate: serverTimestamp(), fileName: '', recordingDate: past, deviceSource: 'Muse S Athena',
        technicianNotes: '', zScores: { frontalTheta: 1.2, centralBeta: -0.4, occipitalAlpha: 0.3, temporalDelta: 0, sensorimotorSMR: 0.8 },
        dominantAlphaPeakHz: 10.2, createdBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 1,
        ...overrides,
    };
}

describe('clients/{patientId}/brainMaps (QEEG)', () => {
    const path = (id: string) => `clients/${ids.patientA}/brainMaps/${id}`;

    it("lets the patient's canonical clinician append a validated record", async () => {
        await assertSucceeds(setDoc(doc(await as(ids.clinicianA), path('qeeg-1')), brainMap('qeeg-1', ids.clinicianA)));
    });

    it('rejects patients, unrelated clinicians, forged authorship, and malformed records', async () => {
        await assertFails(setDoc(doc(await as(ids.patientA), path('qeeg-1')), brainMap('qeeg-1', ids.patientA)));
        await assertFails(setDoc(doc(await as(ids.clinicianB), path('qeeg-1')), brainMap('qeeg-1', ids.clinicianB)));
        await assertFails(setDoc(doc(await as(ids.colleagueA), path('qeeg-1')), brainMap('qeeg-1', ids.colleagueA)));
        const clinicianA = await as(ids.clinicianA);
        await assertFails(setDoc(doc(clinicianA, path('qeeg-1')), brainMap('qeeg-1', ids.clinicianB)));
        await assertFails(setDoc(doc(clinicianA, path('qeeg-1')), brainMap('other-id', ids.clinicianA)));
        await assertFails(setDoc(doc(clinicianA, path('qeeg-1')), brainMap('qeeg-1', ids.clinicianA, { extra: true })));
        await assertFails(setDoc(doc(clinicianA, path('qeeg-1')), brainMap('qeeg-1', ids.clinicianA, {
            zScores: { frontalTheta: 42, centralBeta: 0, occipitalAlpha: 0, temporalDelta: 0, sensorimotorSMR: 0 },
        })));
        await assertFails(setDoc(doc(clinicianA, path('qeeg-1')), brainMap('qeeg-1', ids.clinicianA, { createdAt: past })));
    });

    it('keeps records readable by the patient and canonical clinician only, and immutable', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), path('bm-a'))));
        await assertSucceeds(getDocs(collection(await as(ids.clinicianA), `clients/${ids.patientA}/brainMaps`)));
        await assertFails(getDoc(doc(await as(ids.patientB), path('bm-a'))));
        await assertFails(getDocs(collection(await as(ids.clinicianB), `clients/${ids.patientA}/brainMaps`)));
        await assertFails(updateDoc(doc(await as(ids.clinicianA), path('bm-a')), { technicianNotes: 'edited' }));
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
