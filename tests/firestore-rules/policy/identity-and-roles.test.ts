// From the independent rules review. POLICY tests pin current behavior that is a
// product decision (reported, not changed); RESOLVED tests pin findings that the
// clinician product's retirement closed.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, clinicA } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const code = 'INVU-VRFY-VRFY';
const invitedEmail = emailOf(ids.unlinked);

describe('REVIEW: email-based identity', () => {
    // RESOLVED. Invitations trusted the token email without email_verified, so an
    // account that registered the invited address first could take over the
    // relationship. Invitations are retired: a leftover one cannot be read or accepted.
    it('RESOLVED: an account whose email is not verified can neither read nor accept a leftover invitation', async () => {
        await seedDocuments({
            [`patientInvitations/${code}`]: {
                id: code, clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, patientName: 'Invited',
                condition: 'ADHD', status: 'pending', uniquenessClaimId: invitedEmail, expiresAt: future(), createdAt: past, updatedAt: past,
            },
        });
        const squatter = await as(ids.unlinked, { email_verified: false });
        await assertFails(getDoc(doc(squatter, `patientInvitations/${code}`)));
        const batch = writeBatch(squatter);
        batch.update(doc(squatter, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(squatter, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code }, { merge: true });
        await assertFails(batch.commit());
    });
});

describe('REVIEW: self-assigned clinician role', () => {
    // POLICY until Phase 2 removes the role: users/{uid}.role is self-asserted.
    // RESOLVED: the role no longer unlocks clinic onboarding or invitations, so it
    // cannot be used to pose as a clinician.
    it('POLICY: a patient can still self-select the clinician role; RESOLVED: it unlocks no clinic or invitation', async () => {
        const uid = ids.patientB;
        const database = await as(uid);
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { role: 'clinician' }, { merge: true }));
        const onboard = writeBatch(database);
        onboard.set(doc(database, `clinics/${uid}`), { id: uid, name: 'Clinic A (Official)', timezone: 'UTC', practitionerIds: [uid] });
        onboard.set(doc(database, `practitioners/${uid}`), { id: uid, userId: uid, clinicId: uid, displayName: 'Dr A', credentials: [] });
        await assertFails(onboard.commit());

        const victim = 'victim@example.test';
        await assertFails(setDoc(doc(database, 'patientInvitations/FAKE-FAKE-FAKE'), {
            id: 'FAKE-FAKE-FAKE', clinicianId: uid, clinicId: uid, clinicianName: 'Dr A, Clinic A', patientEmail: victim,
            patientName: 'Victim', status: 'pending', uniquenessClaimId: victim, expiresAt: future(),
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
    });
});

describe('REVIEW: clinic membership and practitioner records', () => {
    // RESOLVED. Clinic membership and client-asserted practitioner credentials are gone
    // with the clinician product: leftover records cannot be created, read or edited.
    it('RESOLVED: no account creates a clinic or edits a leftover practitioner record', async () => {
        await assertFails(setDoc(doc(await as(ids.newClinician), `clinics/${ids.newClinician}`), {
            id: ids.newClinician, name: 'New', practitionerIds: [ids.newClinician],
        }));
        await assertFails(updateDoc(doc(await as(ids.clinicianA), `practitioners/${ids.clinicianA}`), {
            credentials: [{ id: 'primary-license', type: 'other', label: 'License', identifier: 'X', status: 'verified' }],
        }));
        await assertFails(getDoc(doc(await as(ids.colleagueA), `practitioners/${ids.clinicianA}`)));
    });
});
