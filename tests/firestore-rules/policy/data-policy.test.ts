// Security review probe. Data-integrity and data-governance behavior that is
// intentional or a product decision rather than a clear bug.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, clinicB, closeEnvironment, ids, resetWorld, seedDocuments } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('REVIEW: patient-writable clinical fields', () => {
    // POLICY. The patient owns clients/{uid} and may change every non-relationship field,
    // including care-team fields and the legacy embedded QEEG array stored under the
    // retired clinician product.
    it('POLICY: a patient can rewrite their stored protocol, weekly target, condition and legacy QEEG', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
            assignedProtocol: 'alpha-enhancement', prescribedSessionsPerWeek: 0, condition: 'none', notes: 'patient edited',
            brainMaps: [{ id: 'forged', zScores: { frontalTheta: 99 } }],
        }));
    });

    // RESOLVED. Neurofeedback session records are retired: a patient can no longer
    // create one, with or without arbitrary measurements and a clinicianId label.
    it('RESOLVED: a patient cannot create a session record', async () => {
        await assertFails(setDoc(doc(await as(ids.patientA), 'sessions/self-reported'), {
            patientId: ids.patientA, clinicId: clinicA, clinicianId: ids.clinicianB, timeInZonePercent: 100, isDemo: false,
        }));
    });
});

describe('REVIEW: record access after the clinician product was retired', () => {
    // POLICY. No clinician reads a patient's records any more, whatever relationship
    // fields the patient's profile still stores. Session records are retired, so not
    // even their patient reads them.
    it('POLICY: neither a current-link nor a former clinician, nor a colleague, reads sessions or QEEG', async () => {
        await seedDocuments({
            'sessions/old-under-b': { id: 'old-under-b', patientId: ids.unlinked, clinicId: clinicB, clinicianId: ids.clinicianB, clinicianNotes: 'private note by B' },
            [`clients/${ids.unlinked}/brainMaps/by-b`]: { id: 'by-b', createdBy: ids.clinicianB, schemaVersion: 1 },
            [`clients/${ids.unlinked}`]: { id: ids.unlinked, name: 'U', clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'X' },
        });
        for (const uid of [ids.clinicianA, ids.clinicianB, ids.colleagueA]) {
            const database = await as(uid);
            await assertFails(getDoc(doc(database, 'sessions/old-under-b')));
            await assertFails(getDoc(doc(database, `clients/${ids.unlinked}/brainMaps/by-b`)));
            await assertFails(getDoc(doc(database, 'sessions/session-a')));
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}/brainMaps/bm-a`)));
        }
        await assertFails(getDoc(doc(await as(ids.unlinked), 'sessions/old-under-b')));
    });
});

describe('REVIEW: residual documents written under main’s permissive rules', () => {
    // RESOLVED. A legacy appointment row naming the patient, written by anyone, is no
    // longer visible to that patient: appointments fall under the default deny.
    it('a legacy appointment written by an unrelated clinician is denied to the named patient', async () => {
        await seedDocuments({
            'appointments/forged-under-main': { clientId: ids.patientA, patientId: null, clinicianId: ids.clinicianB, title: 'Call this number to reschedule' },
        });
        await assertFails(getDocs(query(collection(await as(ids.patientA), 'appointments'),
            where('clientId', '==', ids.patientA), where('patientId', '==', null))));
        await assertFails(getDoc(doc(await as(ids.patientA), 'appointments/forged-under-main')));
    });
});
