// From the independent rules review. POLICY tests pin current behavior that is a
// product decision (reported, not changed); the rest assert fixed behavior.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, clinicA } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const code = 'INVU-VRFY-VRFY';
const invitedEmail = emailOf(ids.unlinked);

describe('REVIEW: email-based identity', () => {
    // POLICY / MEDIUM (pre-existing on main). isInvitedPatient() trusts
    // request.auth.token.email without email_verified. The app deliberately removed
    // its email-verification gate, so an account that registered the invited address
    // first (and knows the 60-bit code) can accept the invitation and receive the
    // clinician relationship intended for the real person.
    it('POLICY: an account whose email is NOT verified can read and accept an invitation for that email', async () => {
        const expiresAt = future();
        await seedDocuments({
            [`patientInvitations/${code}`]: {
                id: code, clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, patientName: 'Invited',
                condition: 'ADHD', status: 'pending', uniquenessClaimId: invitedEmail, expiresAt, createdAt: past, updatedAt: past,
            },
            [`patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`]: {
                clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, invitationId: code,
                status: 'pending', expiresAt, createdAt: past,
            },
        });
        const squatter = await as(ids.unlinked, { email_verified: false });
        await assertSucceeds(getDoc(doc(squatter, `patientInvitations/${code}`)));
        const batch = writeBatch(squatter);
        batch.update(doc(squatter, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(squatter, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code }, { merge: true });
        batch.delete(doc(squatter, `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`));
        await assertSucceeds(batch.commit());
    });
});

describe('REVIEW: self-assigned clinician role', () => {
    // POLICY (High for a clinical product, pre-existing on main). users/{uid}.role is
    // self-asserted, and clinic + practitioner onboarding needs nothing else, so any
    // account (including an existing patient) becomes a fully capable "clinician" that
    // can issue invitations with an arbitrary, unvalidated clinicianName. Access to a
    // victim still requires the victim to accept, so this is a phishing/impersonation
    // vector, not a direct data bypass.
    it('POLICY: a patient self-promotes, onboards a clinic, and sends an invitation posing as another clinician', async () => {
        const uid = ids.patientB;
        const database = await as(uid);
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { role: 'clinician' }, { merge: true }));
        const onboard = writeBatch(database);
        onboard.set(doc(database, `clinics/${uid}`), { id: uid, name: 'Clinic A (Official)', timezone: 'UTC', practitionerIds: [uid] });
        onboard.set(doc(database, `practitioners/${uid}`), { id: uid, userId: uid, clinicId: uid, displayName: 'Dr A', credentials: [] });
        await assertSucceeds(onboard.commit());

        const victim = 'victim@example.test';
        const expiresAt = future();
        const invite = writeBatch(database);
        invite.set(doc(database, 'patientInvitations/FAKE-FAKE-FAKE'), {
            id: 'FAKE-FAKE-FAKE', clinicianId: uid, clinicId: uid, clinicianName: 'Dr A, Clinic A', patientEmail: victim,
            patientName: 'Victim', status: 'pending', uniquenessClaimId: victim, expiresAt,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        invite.set(doc(database, `patientInvitationClaims/${uid}/emails/${victim}`), {
            clinicianId: uid, clinicId: uid, patientEmail: victim, invitationId: 'FAKE-FAKE-FAKE', status: 'pending', expiresAt,
        });
        await assertSucceeds(invite.commit());
    });
});

describe('REVIEW: clinic membership and practitioner records', () => {
    it('a new clinic starts with its creator as the only member', async () => {
        const creator = await as(ids.newClinician);
        await assertFails(setDoc(doc(creator, `clinics/${ids.newClinician}`), {
            id: ids.newClinician, name: 'New', practitionerIds: [ids.newClinician, ids.clinicianB, ids.patientB],
        }));
        await assertSucceeds(setDoc(doc(creator, `clinics/${ids.newClinician}`), {
            id: ids.newClinician, name: 'New', practitionerIds: [ids.newClinician],
        }));
    });

    // POLICY / MEDIUM (pre-existing on main). Credential status is client-asserted;
    // rules cannot inspect list entries, so verification must move server-side.
    it('POLICY: a practitioner can mark their own license "verified"', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `practitioners/${ids.clinicianA}`), {
            credentials: [{ id: 'primary-license', type: 'other', label: 'License', identifier: 'X', status: 'verified' }],
        }));
    });

    it("a clinic colleague cannot rewrite another practitioner's display name or credentials", async () => {
        await assertFails(updateDoc(doc(await as(ids.colleagueA), `practitioners/${ids.clinicianA}`), {
            displayName: 'Not Dr A', credentials: [{ id: 'primary-license', status: 'revoked' }],
        }));
    });
});
