import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, clinicA, clinicB, closeEnvironment, emailOf, ids, resetWorld } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('users/{uid}', () => {
    it('lets a user read and write only their own user document', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), `users/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.patientB), `users/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `users/${ids.patientA}`)));
        await assertFails(setDoc(doc(await as(ids.patientB), `users/${ids.patientA}`), { role: 'patient' }));
        await assertFails(getDoc(doc(await anonymous(), `users/${ids.patientA}`)));
    });

    it('creates a new account profile only at its own UID', async () => {
        const fresh = 'fresh-user';
        await assertSucceeds(setDoc(doc(await as(fresh), `users/${fresh}`), { email: emailOf(fresh), role: null }));
        await assertFails(setDoc(doc(await as(fresh), `users/someone-else`), { email: emailOf(fresh), role: null }));
    });
});

describe('clients/{patientId} reads', () => {
    it('allows the patient, their canonical clinician, and their clinic colleagues', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.colleagueA), `clients/${ids.patientA}`)));
    });

    it('denies other patients, unrelated clinicians, role-less users, and anonymous users', async () => {
        await assertFails(getDoc(doc(await as(ids.patientB), `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianX), `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(await as(ids.roleless), `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(await anonymous(), `clients/${ids.patientA}`)));
    });

    it('uses the legacy link only when no canonical clinician is set', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `clients/${ids.legacyPatient}`)));
        // Split-brain: canonical clinician-b wins over the stale legacy clinician-a.
        await assertFails(getDoc(doc(await as(ids.clinicianA), `clients/${ids.splitPatient}`)));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianB), `clients/${ids.splitPatient}`)));
    });

    it("supports the roster queries the app issues and rejects another clinician's roster", async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDocs(query(collection(clinicianA, 'clients'), where('clinicianId', '==', ids.clinicianA))));
        await assertSucceeds(getDocs(query(collection(clinicianA, 'clients'),
            where('linkedClinicianCode', '==', ids.clinicianA), where('clinicianId', '==', null))));
        await assertSucceeds(getDocs(query(collection(await as(ids.colleagueA), 'clients'), where('clinicId', '==', clinicA))));
        await assertFails(getDocs(query(collection(await as(ids.clinicianB), 'clients'), where('clinicianId', '==', ids.clinicianA))));
        await assertFails(getDocs(query(collection(await as(ids.clinicianB), 'clients'), where('clinicId', '==', clinicA))));
        await assertFails(getDocs(collection(await as(ids.clinicianA), 'clients')));
    });
});

describe('clients/{patientId} account creation', () => {
    it('creates a relationship-free profile only for the signed-in user', async () => {
        const fresh = 'fresh-patient';
        const database = await as(fresh);
        await assertSucceeds(setDoc(doc(database, `clients/${fresh}`), { id: fresh, email: emailOf(fresh), name: 'New' }));
        await assertFails(setDoc(doc(database, `clients/another-patient`), { id: 'another-patient', name: 'Forged' }));
    });

    it('rejects a new profile that forges a clinician, clinic, or accepted invitation', async () => {
        const fresh = 'fresh-patient';
        const database = await as(fresh);
        const base = { id: fresh, email: emailOf(fresh), name: 'New' };
        await assertFails(setDoc(doc(database, `clients/${fresh}`), { ...base, clinicianId: ids.clinicianA }));
        await assertFails(setDoc(doc(database, `clients/${fresh}`), { ...base, clinicId: clinicA }));
        await assertFails(setDoc(doc(database, `clients/${fresh}`), { ...base, linkedClinicianCode: ids.clinicianA }));
        await assertFails(setDoc(doc(database, `clients/${fresh}`), {
            ...base, clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
        }));
        await assertFails(setDoc(doc(database, `clients/${fresh}`), { ...base, id: 'someone-else' }));
    });
});

describe('clients/{patientId} updates', () => {
    it('lets a patient edit ordinary profile fields', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { name: 'Renamed' }));
    });

    it('prevents a patient from relinking, unlinking, or moving clinics on their own', async () => {
        const patientA = await as(ids.patientA);
        const reference = doc(patientA, `clients/${ids.patientA}`);
        await assertFails(updateDoc(reference, { clinicianId: ids.clinicianB }));
        await assertFails(updateDoc(reference, { clinicianId: null }));
        await assertFails(updateDoc(reference, { clinicId: clinicB }));
        await assertFails(updateDoc(reference, { linkedClinicianCode: ids.clinicianB }));
        await assertFails(updateDoc(reference, { acceptedInvitationId: 'INVB-BBBB-BBBB' }));
    });

    it('lets the canonical clinician update care fields and fully unlink, but not reassign', async () => {
        const clinicianA = await as(ids.clinicianA);
        const reference = doc(clinicianA, `clients/${ids.patientA}`);
        await assertSucceeds(updateDoc(reference, { assignedProtocol: 'alpha-enhancement' }));
        await assertFails(updateDoc(reference, { clinicianId: ids.clinicianB }));
        await assertFails(updateDoc(reference, { clinicId: clinicB }));
        await assertFails(updateDoc(reference, { clinicianId: null }));
        await assertSucceeds(updateDoc(reference, {
            clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null,
        }));
    });

    it('rejects an unlink that also changes other profile fields', async () => {
        await assertFails(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), {
            clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null, name: 'Renamed on the way out',
        }));
    });

    it('lets clinic colleagues update care fields but never the relationship', async () => {
        const colleague = await as(ids.colleagueA);
        const reference = doc(colleague, `clients/${ids.patientA}`);
        await assertSucceeds(updateDoc(reference, { prescribedSessionsPerWeek: 4 }));
        await assertFails(updateDoc(reference, { clinicianId: ids.colleagueA }));
        await assertFails(updateDoc(reference, {
            clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null,
        }));
    });

    it('denies updates from unrelated clinicians, other patients, stale legacy owners, and anonymous users', async () => {
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `clients/${ids.patientA}`), { assignedProtocol: 'x' }));
        await assertFails(updateDoc(doc(await as(ids.patientB), `clients/${ids.patientA}`), { name: 'x' }));
        await assertFails(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.splitPatient}`), { assignedProtocol: 'x' }));
        await assertFails(updateDoc(doc(await anonymous(), `clients/${ids.patientA}`), { name: 'x' }));
    });

    it('lets a legacy-only clinician unlink but never convert the link into a canonical one', async () => {
        const reference = doc(await as(ids.clinicianA), `clients/${ids.legacyPatient}`);
        await assertFails(updateDoc(reference, { clinicianId: ids.clinicianA }));
        await assertSucceeds(updateDoc(reference, { clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null }));
    });
});

describe('clients/{patientId} deletion', () => {
    it('allows only an unlinked patient to delete their own profile', async () => {
        await assertSucceeds(deleteDoc(doc(await as(ids.unlinked), `clients/${ids.unlinked}`)));
        await assertFails(deleteDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`)));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
    });
});
