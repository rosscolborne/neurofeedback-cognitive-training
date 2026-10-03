import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, ids, resetWorld, seedDocuments } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const newUid = 'patient-new';
const email = emailOf(ids.patientA);

// patient-a was linked to clinician-a under the retired clinician product, so
// starting deletion must also clear the stored relationship fields.
async function deactivateOldPatient() {
  await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
    accountDeletionStartedAt: serverTimestamp(), clinicianId: null, linkedClinicianCode: null,
    clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
  }));
}

describe('bounded patient account deletion', () => {
  it('starts deletion only together with clearing the stored relationship, and carries no other edit', async () => {
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      accountDeletionStartedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      accountDeletionStartedAt: serverTimestamp(), clinicianId: null, linkedClinicianCode: null,
      clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(), name: 'Changed on the way out',
    }));
    // A profile with no stored relationship starts deletion the same way the app writes it.
    await assertSucceeds(updateDoc(doc(await as(ids.unlinked), `clients/${ids.unlinked}`), {
      accountDeletionStartedAt: serverTimestamp(), clinicianId: null, linkedClinicianCode: null,
      clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
    }));
  });

  it('freezes the marked profile against revival, relinking, edits and deletion, and keeps it from the former clinician', async () => {
    await deactivateOldPatient();
    const formerClinician = await as(ids.clinicianA);
    await assertFails(getDoc(doc(formerClinician, `clients/${ids.patientA}`)));
    await assertFails(getDoc(doc(formerClinician, 'sessions/session-a')));
    await assertFails(updateDoc(doc(formerClinician, `clients/${ids.patientA}`), { notes: 'new care' }));
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      accountDeletionStartedAt: null, clinicianId: ids.clinicianA, clinicId: clinicA,
    }));
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { name: 'Revived' }));
    await assertFails(deleteDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`)));
    await assertFails(setDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      id: ids.patientA, name: 'Revived', clinicianId: ids.clinicianA, clinicId: clinicA,
    }));
    const retained = await assertSucceeds(getDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`)));
    expect(retained.data()?.accountDeletionStartedAt).toBeDefined();
    expect(retained.data()?.clinicianId).toBeNull();
  });

  it("gives a new UID with the same email no access to the old UID's profile or sessions", async () => {
    await seedDocuments({
      [`users/${newUid}`]: { role: 'patient', email },
      [`clients/${newUid}`]: { id: newUid, email, name: 'Patient New' },
    });
    await deactivateOldPatient();
    const patient = await as(newUid, { email });
    await assertSucceeds(getDoc(doc(patient, `clients/${newUid}`)));
    await assertFails(getDoc(doc(patient, `clients/${ids.patientA}`)));
    await assertFails(getDoc(doc(patient, 'sessions/session-a')));
    // Nor can it claim the old relationship on its own profile.
    await assertFails(updateDoc(doc(patient, `clients/${newUid}`), {
      clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
    }));
  });
});
