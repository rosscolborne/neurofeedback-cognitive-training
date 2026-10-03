import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { anonymous, as, clinicA, closeEnvironment, ids, resetWorld } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

/** The app's clinic onboarding batch (clinicSettingsRepository.save). */
function onboard(database: Firestore, uid: string, clinicId = uid, practitionerIds = [uid]) {
    const batch = writeBatch(database);
    batch.set(doc(database, `clinics/${clinicId}`), {
        id: clinicId, name: 'New clinic', timezone: 'UTC', practitionerIds, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(database, `practitioners/${uid}`), {
        id: uid, userId: uid, clinicId, displayName: 'Dr New', credentials: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });
    return batch.commit();
}

describe('clinic onboarding', () => {
    it('lets a clinician create their own clinic and practitioner record together', async () => {
        await assertSucceeds(onboard(await as(ids.newClinician), ids.newClinician));
    });

    it('rejects role-less users, patients, and clinics under another ID', async () => {
        await assertFails(onboard(await as(ids.roleless), ids.roleless));
        await assertFails(onboard(await as(ids.unlinked), ids.unlinked));
        await assertFails(onboard(await as(ids.newClinician), ids.newClinician, 'some-other-clinic'));
        await assertFails(setDoc(doc(await as(ids.newClinician), `practitioners/${ids.newClinician}`), {
            id: ids.newClinician, userId: ids.newClinician, clinicId: clinicA,
        }));
        await assertFails(setDoc(doc(await as(ids.newClinician), `practitioners/${ids.clinicianB}`), {
            id: ids.clinicianB, userId: ids.clinicianB, clinicId: ids.newClinician,
        }));
    });
});

describe('clinics/{clinicId}', () => {
    it('is readable by its practitioners and its patients only', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `clinics/${clinicA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.colleagueA), `clinics/${clinicA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.patientA), `clinics/${clinicA}`)));
        await assertFails(getDoc(doc(await as(ids.patientB), `clinics/${clinicA}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `clinics/${clinicA}`)));
        await assertFails(getDoc(doc(await as(ids.unlinked), `clinics/${clinicA}`)));
        await assertFails(getDoc(doc(await anonymous(), `clinics/${clinicA}`)));
        await assertFails(getDocs(collection(await as(ids.clinicianA), 'clinics')));
    });

    it("lets a clinician read their own clinic ID before it exists (onboarding check)", async () => {
        await assertSucceeds(getDoc(doc(await as(ids.newClinician), `clinics/${ids.newClinician}`)));
    });

    it('lets members update branding but never membership', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(clinicianA, `clinics/${clinicA}`), { branding: { name: 'Rebranded' }, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(doc(clinicianA, `clinics/${clinicA}`), { practitionerIds: [ids.clinicianA, ids.colleagueA, ids.clinicianB] }));
        await assertFails(updateDoc(doc(clinicianA, `clinics/${clinicA}`), { practitionerIds: [ids.clinicianA] }));
    });

    it('rejects updates and deletion by outsiders and patients', async () => {
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `clinics/${clinicA}`), { branding: { name: 'Defaced' } }));
        await assertFails(updateDoc(doc(await as(ids.patientA), `clinics/${clinicA}`), { branding: { name: 'Defaced' } }));
        await assertFails(deleteDoc(doc(await as(ids.clinicianA), `clinics/${clinicA}`)));
    });

    it("rejects creating a clinic that claims another clinician's ID", async () => {
        await assertFails(setDoc(doc(await as(ids.newClinician), `clinics/${ids.clinicianB}`), {
            id: ids.clinicianB, practitionerIds: [ids.newClinician],
        }));
    });
});

describe('practitioners/{uid}', () => {
    it('lets a clinician read their own record, present or not', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `practitioners/${ids.clinicianA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.newClinician), `practitioners/${ids.newClinician}`)));
    });

    it('shares records within a clinic and hides them from everyone else', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.colleagueA), `practitioners/${ids.clinicianA}`)));
        await assertSucceeds(getDocs(query(collection(await as(ids.colleagueA), 'practitioners'), where('clinicId', '==', clinicA))));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `practitioners/${ids.clinicianA}`)));
        await assertFails(getDoc(doc(await as(ids.patientA), `practitioners/${ids.clinicianA}`)));
        await assertFails(getDoc(doc(await as(ids.patientA), `practitioners/${ids.patientA}`)));
        await assertFails(getDocs(query(collection(await as(ids.clinicianB), 'practitioners'), where('clinicId', '==', clinicA))));
    });

    it('freezes identity and clinic, and rejects outside edits and deletion', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(clinicianA, `practitioners/${ids.clinicianA}`), { displayName: 'Dr A, PhD' }));
        await assertFails(updateDoc(doc(clinicianA, `practitioners/${ids.clinicianA}`), { userId: ids.clinicianB }));
        await assertFails(updateDoc(doc(clinicianA, `practitioners/${ids.clinicianA}`), { clinicId: ids.clinicianB }));
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `practitioners/${ids.clinicianA}`), { displayName: 'x' }));
        await assertFails(deleteDoc(doc(clinicianA, `practitioners/${ids.clinicianA}`)));
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

describe('role selection (documents current policy)', () => {
    it('lets any signed-in user choose the clinician role for their own account', async () => {
        // Clinician privileges come from relationships (invitations, clinics), not the role alone.
        await assertSucceeds(setDoc(doc(await as(ids.unlinked), `users/${ids.unlinked}`), { role: 'clinician' }, { merge: true }));
        await assertFails(getDoc(doc(await as(ids.unlinked), `clients/${ids.patientA}`)));
    });
});
