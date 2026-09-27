import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, seededAppointmentId } from './fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const newUid = 'patient-new';
const invitationId = 'DELE-REEN-ROLL';
const email = emailOf(ids.patientA);
const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${email}`;

async function deactivateOldPatient() {
  await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
    accountDeletionStartedAt: serverTimestamp(), clinicianId: null, linkedClinicianCode: null,
    clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
  }));
}

describe('bounded patient account deletion', () => {
  it('removes the old UID from the active roster and prevents clinician action or relationship replay', async () => {
    await deactivateOldPatient();
    const clinician = await as(ids.clinicianA);
    const roster = await assertSucceeds(getDocs(query(collection(clinician, 'clients'), where('clinicianId', '==', ids.clinicianA))));
    expect(roster.docs.map((entry) => entry.id)).not.toContain(ids.patientA);
    await assertFails(getDoc(doc(clinician, `clients/${ids.patientA}`)));
    await assertFails(getDoc(doc(clinician, 'sessions/session-a')));
    await assertFails(getDoc(doc(clinician, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`)));
    await assertFails(getDoc(doc(clinician, `appointments/${seededAppointmentId}`)));
    await assertFails(updateDoc(doc(clinician, `clients/${ids.patientA}`), { notes: 'new care' }));
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      accountDeletionStartedAt: null, clinicianId: ids.clinicianA, clinicId: clinicA,
    }));
    await assertFails(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { name: 'Revived' }));
    await assertFails(deleteDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`)));
    await assertFails(setDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
      id: ids.patientA, name: 'Revived', clinicianId: ids.clinicianA, clinicId: clinicA,
    }));
  });

  it('allows a fresh invitation for the same email after the old relationship is removed', async () => {
    await deactivateOldPatient();
    const clinician = await as(ids.clinicianA);
    const code = 'FRES-HINV-ITEE';
    const expiresAt = future();
    const batch = writeBatch(clinician);
    batch.set(doc(clinician, `patientInvitations/${code}`), {
      id: code, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A',
      patientEmail: email, patientName: 'Patient New', condition: 'ADHD',
      assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
      status: 'pending', uniquenessClaimId: email, schemaVersion: 1,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt,
    });
    batch.set(doc(clinician, claimPath), {
      clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email,
      invitationId: code, status: 'pending', expiresAt, createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('allows only deletion cleanup of future canonical appointments and retains historical rows', async () => {
    const patient = await as(ids.patientA);
    const appointmentRef = doc(patient, `appointments/${seededAppointmentId}`);
    await assertFails(updateDoc(appointmentRef, {
      status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.patientA,
      cancellationRequestId: 'cancel_aaaaaaaaaaaaaaaaaaaaaaaa', updatedAt: serverTimestamp(), revision: 2,
    }));
    await deactivateOldPatient();
    await assertSucceeds(updateDoc(appointmentRef, {
      status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.patientA,
      cancellationRequestId: 'cancel_aaaaaaaaaaaaaaaaaaaaaaaa', updatedAt: serverTimestamp(), revision: 2,
    }));
    await assertFails(updateDoc(appointmentRef, { notes: 'altered', updatedAt: serverTimestamp(), revision: 3 }));
    const retained = await assertSucceeds(getDoc(doc(patient, `clients/${ids.patientA}`)));
    expect(retained.data()?.accountDeletionStartedAt).toBeDefined();
  });

  it('lets a new UID with the same email accept a valid pending invitation without reviving the old UID', async () => {
    await seedDocuments({
      [`patientInvitations/${invitationId}`]: {
        id: invitationId, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A',
        patientEmail: email, patientName: 'Patient New', condition: 'ADHD',
        assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
        status: 'pending', uniquenessClaimId: email, schemaVersion: 1,
        createdAt: past, updatedAt: past, expiresAt: future(),
      },
      [claimPath]: {
        clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email,
        invitationId, status: 'pending', expiresAt: future(), createdAt: past,
      },
      [`users/${newUid}`]: { role: 'patient', email },
      [`clients/${newUid}`]: { id: newUid, email, name: 'Patient New', clinicianId: null, clinicId: null },
    });
    await deactivateOldPatient();
    const patient = await as(newUid, { email });
    const batch = writeBatch(patient);
    batch.update(doc(patient, `patientInvitations/${invitationId}`), {
      status: 'accepted', patientId: newUid, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(patient, `clients/${newUid}`), {
      clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: invitationId,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.delete(doc(patient, claimPath));
    await assertSucceeds(batch.commit());
    const roster = await assertSucceeds(getDocs(query(collection(await as(ids.clinicianA), 'clients'), where('clinicianId', '==', ids.clinicianA))));
    expect(roster.docs.map((entry) => entry.id)).toEqual([newUid]);
    const old = await getDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`));
    expect(old.data()?.clinicianId).toBeNull();
    expect(old.data()?.accountDeletionStartedAt).toBeDefined();
    await assertFails(getDoc(doc(patient, `clients/${ids.patientA}`)));
    await assertFails(getDoc(doc(patient, 'sessions/session-a')));
    await assertFails(getDoc(doc(patient, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`)));
  });
});
