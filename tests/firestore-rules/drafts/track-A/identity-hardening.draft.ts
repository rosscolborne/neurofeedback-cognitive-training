// DRAFT (Track A): proposed identity/role/credential rules. Run against the
// proposed rules copy via RULES_FILE; the unpatched fixture is used, so tokens
// carry email_verified explicitly and clinician grants are seeded here.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments } from '../../fixture';

const verified = { email_verified: true };
const unverified = { email_verified: false };
const v = (uid: string) => as(uid, verified);

const grants = {
    [`clinicianAccess/${ids.clinicianA}`]: { status: 'active', displayName: 'Dr A', credentialStatus: 'verified' },
    [`clinicianAccess/${ids.colleagueA}`]: { status: 'active', displayName: 'Dr A2', credentialStatus: 'unverified' },
    [`clinicianAccess/${ids.clinicianB}`]: { status: 'active', displayName: 'Dr B', credentialStatus: 'unverified' },
    [`clinicianAccess/${ids.clinicianX}`]: { status: 'active', displayName: 'Dr X', credentialStatus: 'unverified' },
    [`clinicianAccess/${ids.newClinician}`]: { status: 'active', displayName: 'Dr New', credentialStatus: 'unverified' },
};

beforeEach(async () => {
    await resetWorld();
    await seedDocuments(grants);
});
afterAll(closeEnvironment);

const code = 'INVU-DRFT-DRFT';
const invitedEmail = emailOf(ids.unlinked);

function createInvitation(database: Firestore, clinicianId: string = ids.clinicianA, clinicId: string = clinicA, clinicianName = 'Dr A', patientEmail = invitedEmail, id = code) {
    const claim = doc(database, `patientInvitationClaims/${clinicianId}/emails/${patientEmail}`);
    const expiresAt = future();
    return runTransaction(database, async (transaction) => {
        await transaction.get(claim);
        transaction.set(doc(database, `patientInvitations/${id}`), {
            id, clinicianId, clinicId, clinicianName, patientEmail, patientName: 'Invited',
            condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending',
            uniquenessClaimId: patientEmail, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt,
        });
        transaction.set(claim, { clinicianId, clinicId, patientEmail, invitationId: id, status: 'pending', expiresAt, createdAt: serverTimestamp() });
    });
}

async function seedPendingInvitation() {
    const expiresAt = future();
    await seedDocuments({
        [`patientInvitations/${code}`]: {
            id: code, clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A', patientEmail: invitedEmail, patientName: 'Invited',
            condition: 'ADHD', status: 'pending', uniquenessClaimId: invitedEmail, expiresAt, createdAt: past, updatedAt: past,
        },
        [`patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`]: {
            clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: invitedEmail, invitationId: code, status: 'pending', expiresAt, createdAt: past,
        },
    });
}

function accept(database: Firestore) {
    const batch = writeBatch(database);
    batch.update(doc(database, `patientInvitations/${code}`), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(database, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: code }, { merge: true });
    batch.delete(doc(database, `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`));
    return batch.commit();
}

function onboard(database: Firestore, uid: string, credentials: unknown[] = []) {
    const batch = writeBatch(database);
    batch.set(doc(database, `clinics/${uid}`), { id: uid, name: 'Clinic', timezone: 'UTC', practitionerIds: [uid] });
    batch.set(doc(database, `practitioners/${uid}`), { id: uid, userId: uid, clinicId: uid, displayName: 'Dr Someone', credentials });
    return batch.commit();
}

describe('M1: invitation identity requires a verified email', () => {
    it('the verified invited account can read and accept', async () => {
        await seedPendingInvitation();
        await assertSucceeds(getDoc(doc(await v(ids.unlinked), `patientInvitations/${code}`)));
        await assertSucceeds(accept(await v(ids.unlinked)));
    });

    it('an unverified account with the invited email can neither read (PHI) nor accept', async () => {
        await seedPendingInvitation();
        const squatter = await as(ids.unlinked, unverified);
        await assertFails(getDoc(doc(squatter, `patientInvitations/${code}`)));
        await assertFails(accept(squatter));
    });

    it('a token with no email_verified claim at all is treated as unverified', async () => {
        await seedPendingInvitation();
        // undefined is dropped from the JWT, so this works with or without the fixture patch.
        await assertFails(accept(await as(ids.unlinked, { email_verified: undefined })));
    });

    it('email_verified must be boolean true, not a truthy string', async () => {
        await seedPendingInvitation();
        await assertFails(getDoc(doc(await as(ids.unlinked, { email_verified: 'true' }), `patientInvitations/${code}`)));
    });

    it('an unverified invitee cannot release the uniqueness claim', async () => {
        await seedPendingInvitation();
        await assertFails(deleteDoc(doc(await as(ids.unlinked, unverified), `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`)));
    });

    it('end to end: granted clinician creates, verified patient accepts', async () => {
        await assertSucceeds(createInvitation(await v(ids.clinicianA)));
        await assertSucceeds(accept(await v(ids.unlinked)));
        await assertSucceeds(getDoc(doc(await v(ids.clinicianA), `clients/${ids.unlinked}`)));
    });
});

describe('M2: clinician privilege comes only from the server-only grant', () => {
    it('users/{uid}.role = clinician without a grant grants nothing', async () => {
        const uid = ids.roleless;
        const database = await v(uid);
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { role: 'clinician', updatedAt: 'now' }, { merge: true }));
        await assertFails(onboard(database, uid));
        await assertFails(getDoc(doc(database, `clinics/${uid}`)));
    });

    it('an existing patient cannot switch role, onboard, or invite', async () => {
        const uid = ids.patientB;
        const database = await v(uid);
        await assertFails(setDoc(doc(database, `users/${uid}`), { role: 'clinician' }, { merge: true }));
        await assertFails(setDoc(doc(database, `users/${uid}`), { role: null }, { merge: true }));
        await assertFails(onboard(database, uid));
        await assertFails(createInvitation(database, uid, uid, 'Dr A, Clinic A', 'victim@example.test', 'FAKE-FAKE-FAKE'));
    });

    it('a patient cannot mint their own grant', async () => {
        const database = await v(ids.patientB);
        await assertFails(setDoc(doc(database, `clinicianAccess/${ids.patientB}`), { status: 'active', displayName: 'Dr A' }));
        await assertFails(getDoc(doc(database, `clinicianAccess/${ids.clinicianA}`)));
    });

    it('nobody can list grants', async () => {
        await assertFails(getDocs(collection(await v(ids.clinicianA), 'clinicianAccess')));
    });

    it('the owner may still delete their own profile document (account deletion)', async () => {
        await assertSucceeds(deleteDoc(doc(await v(ids.patientB), `users/${ids.patientB}`)));
    });

    it('a granted clinician cannot edit their own grant', async () => {
        const database = await v(ids.clinicianA);
        await assertSucceeds(getDoc(doc(database, `clinicianAccess/${ids.clinicianA}`)));
        await assertFails(updateDoc(doc(database, `clinicianAccess/${ids.clinicianA}`), { credentialStatus: 'verified', displayName: 'Dr Famous' }));
        await assertFails(deleteDoc(doc(database, `clinicianAccess/${ids.clinicianA}`)));
    });

    it('a linked patient can read their clinician grant (badge); an unrelated patient cannot', async () => {
        await assertSucceeds(getDoc(doc(await v(ids.patientA), `clinicianAccess/${ids.clinicianA}`)));
        await assertFails(getDoc(doc(await v(ids.patientB), `clinicianAccess/${ids.clinicianA}`)));
    });

    it('a granted clinician with an unverified email has no clinician privilege', async () => {
        await assertFails(createInvitation(await as(ids.clinicianA, unverified)));
        await assertFails(onboard(await as(ids.newClinician, unverified), ids.newClinician));
    });

    it('a pending, suspended, or revoked grant has no clinician privilege, effective immediately', async () => {
        for (const status of ['pending', 'suspended', 'revoked']) {
            await seedDocuments({ [`clinicianAccess/${ids.clinicianA}`]: { status, displayName: 'Dr A' } });
            await assertFails(createInvitation(await v(ids.clinicianA)));
        }
        await seedDocuments({ [`clinicianAccess/${ids.newClinician}`]: { status: 'pending', displayName: 'Dr New' } });
        await assertFails(onboard(await v(ids.newClinician), ids.newClinician));
    });

    it('a granted, verified clinician onboards a clinic', async () => {
        await assertSucceeds(onboard(await v(ids.newClinician), ids.newClinician));
    });

    it('an invitation without clinicianName is rejected when the grant has a display name', async () => {
        const database = await v(ids.clinicianA);
        const email = 'someone@example.test';
        const expiresAt = future();
        const batch = writeBatch(database);
        batch.set(doc(database, 'patientInvitations/NONM-NONM-NONM'), {
            id: 'NONM-NONM-NONM', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, patientName: 'U',
            status: 'pending', uniquenessClaimId: email, expiresAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        batch.set(doc(database, `patientInvitationClaims/${ids.clinicianA}/emails/${email}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'NONM-NONM-NONM', status: 'pending', expiresAt,
        });
        await assertFails(batch.commit());
    });

    // Replays data-policy.test.ts "superseded expired invitation" with the now-required
    // clinicianName, proving that test's changed outcome is only its missing field.
    it('replacing an expired claim still works when clinicianName matches the grant', async () => {
        const email = emailOf(ids.unlinked);
        const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${email}`;
        const expired = Timestamp.fromMillis(Date.now() - 60_000);
        const base = { clinicianId: ids.clinicianA, clinicId: clinicA, clinicianName: 'Dr A', patientEmail: email, patientName: 'U', status: 'pending', uniquenessClaimId: email, createdAt: past, updatedAt: past };
        await seedDocuments({
            'patientInvitations/OLDX-OLDX-OLDX': { ...base, id: 'OLDX-OLDX-OLDX', expiresAt: expired },
            [claimPath]: { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'OLDX-OLDX-OLDX', status: 'pending', expiresAt: expired },
        });
        const database = await v(ids.clinicianA);
        const expiresAt = future();
        const replace = writeBatch(database);
        replace.set(doc(database, 'patientInvitations/NEWX-NEWX-NEWX'), { ...base, id: 'NEWX-NEWX-NEWX', expiresAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        replace.set(doc(database, claimPath), { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'NEWX-NEWX-NEWX', status: 'pending', expiresAt });
        await assertSucceeds(replace.commit());
        await assertFails(updateDoc(doc(database, 'patientInvitations/OLDX-OLDX-OLDX'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    });

    it('invitation clinicianName must equal the server-verified display name', async () => {
        await assertFails(createInvitation(await v(ids.clinicianA), ids.clinicianA, clinicA, 'Dr B, Clinic B'));
        await assertSucceeds(createInvitation(await v(ids.clinicianA), ids.clinicianA, clinicA, 'Dr A'));
    });
});

describe('users/{uid} profile hardening', () => {
    it('allows the app signup document and first role selection', async () => {
        const uid = 'fresh-user';
        const database = await v(uid);
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { email: emailOf(uid), displayName: null, createdAt: 'now', role: null }));
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { role: 'patient', updatedAt: 'now' }, { merge: true }));
        await assertSucceeds(setDoc(doc(database, `users/${uid}`), { role: 'patient', updatedAt: 'later' }, { merge: true }));
        await assertFails(setDoc(doc(database, `users/${uid}`), { role: 'clinician' }, { merge: true }));
    });

    it('rejects unknown roles and extra fields', async () => {
        const uid = 'fresh-user-2';
        const database = await v(uid);
        await assertFails(setDoc(doc(database, `users/${uid}`), { email: emailOf(uid), role: 'admin' }));
        await assertFails(setDoc(doc(database, `users/${uid}`), { email: emailOf(uid), role: null, clinicianAccess: 'active' }));
    });
});

describe('M4: credential verification is server-owned', () => {
    it('a practitioner cannot mark a license verified or change the credentials list', async () => {
        const database = await v(ids.clinicianA);
        await assertFails(updateDoc(doc(database, `practitioners/${ids.clinicianA}`), {
            credentials: [{ id: 'primary-license', type: 'other', label: 'License', identifier: 'X', status: 'verified' }],
        }));
        await assertFails(updateDoc(doc(database, `practitioners/${ids.clinicianA}`), {
            credentials: [{ id: 'primary-license', type: 'other', label: 'License', identifier: 'X', status: 'unverified' }],
        }));
    });

    it('onboarding cannot seed credentials; self-reported identifier fields still save', async () => {
        await assertFails(onboard(await v(ids.newClinician), ids.newClinician, [{ id: 'primary-license', status: 'verified' }]));
        await assertSucceeds(onboard(await v(ids.newClinician), ids.newClinician, []));
        await assertSucceeds(updateDoc(doc(await v(ids.newClinician), `practitioners/${ids.newClinician}`), {
            displayName: 'Dr New, PhD', reportedLicenseIdentifier: 'CPSO-12345',
        }));
    });

    it('the redesigned saveSettings batch (no credentials, self-reported identifier) onboards and re-saves', async () => {
        const uid = ids.newClinician;
        const save = async () => {
            const database = await v(uid);
            const batch = writeBatch(database);
            batch.set(doc(database, `clinics/${uid}`), { id: uid, name: 'Clinic New', timezone: 'UTC', practitionerIds: [uid], updatedAt: serverTimestamp() }, { merge: true });
            batch.set(doc(database, `practitioners/${uid}`), { id: uid, userId: uid, clinicId: uid, displayName: 'Dr New', reportedLicenseIdentifier: 'CPSO-1', updatedAt: serverTimestamp() }, { merge: true });
            return batch.commit();
        };
        await assertSucceeds(save());
        await assertSucceeds(save());
    });

    it('the current saveSettings batch that writes an unverified primary credential is rejected (client must change)', async () => {
        await assertFails(onboard(await v(ids.newClinician), ids.newClinician, [
            { id: 'primary-license', type: 'other', label: 'Professional license or certification', identifier: 'CPSO-1', status: 'unverified' },
        ]));
    });

    it('a merge save that re-sends unchanged server credentials is allowed', async () => {
        await seedDocuments({
            [`practitioners/${ids.clinicianA}`]: {
                id: ids.clinicianA, userId: ids.clinicianA, clinicId: clinicA, displayName: 'Dr A',
                credentials: [{ id: 'primary-license', status: 'verified', identifier: 'X' }],
            },
        });
        await assertSucceeds(setDoc(doc(await v(ids.clinicianA), `practitioners/${ids.clinicianA}`), {
            displayName: 'Dr A', credentials: [{ id: 'primary-license', status: 'verified', identifier: 'X' }],
        }, { merge: true }));
    });
});
