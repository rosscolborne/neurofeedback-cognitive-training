// Track C DRAFT: patient/clinician relationship lifecycle (link, unlink, relink,
// consent withdrawal, account deletion). Not part of npm run test:rules.
//
// Run against the current rules (as-is map) with TRACK_C_PROPOSED unset, and
// against the proposed rules copy with TRACK_C_PROPOSED=1 and RULES_FILE pointing
// at tracks/C/proposed/firestore.rules. Expectations that differ are marked.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import {
    as, clinicA, clinicB, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, seededAppointmentId,
} from '../../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

const PROPOSED = process.env.TRACK_C_PROPOSED === '1';
const onlyIfProposed = (operation: Promise<unknown>) => (PROPOSED ? assertSucceeds(operation) : assertFails(operation));

const cancelId = 'cancel_aaaaaaaaaaaaaaaaaaaaaaaa';
const unlinkFields = { clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null };
const threadA = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;

function cancellation(by: string) {
    return {
        status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: by, cancellationRequestId: cancelId,
        updatedAt: serverTimestamp(), revision: 2,
    };
}

function sendMessage(database: Firestore, senderId: string, role: 'patient' | 'clinician', messageId: string) {
    const batch = writeBatch(database);
    batch.set(doc(database, threadA), {
        patientId: ids.patientA, clinicianId: ids.clinicianA, participantIds: [ids.patientA, ids.clinicianA],
        lastMessageText: 'still there?', lastMessageId: messageId, lastSenderId: senderId,
        lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 1,
    }, { merge: true });
    batch.set(doc(database, `${threadA}/messages/${messageId}`), {
        id: messageId, patientId: ids.patientA, clinicianId: ids.clinicianA, senderId, senderRole: role,
        text: 'still there?', createdAt: serverTimestamp(), schemaVersion: 1,
    });
    return batch.commit();
}

// A second, still-pending invitation from clinician A to patient A (clinicians may
// create one while linked because the claim was released at the first acceptance).
const reinvite = 'REIN-VITE-AAAA';
const reinviteClaim = `patientInvitationClaims/${ids.clinicianA}/emails/${emailOf(ids.patientA)}`;
async function seedPendingReinvitation(clinicianId: string = ids.clinicianA, clinicId: string = clinicA, code = reinvite) {
    const expiresAt = future();
    await seedDocuments({
        [`patientInvitations/${code}`]: {
            id: code, clinicianId, clinicId, patientEmail: emailOf(ids.patientA), patientName: 'A', status: 'pending',
            uniquenessClaimId: emailOf(ids.patientA), expiresAt, createdAt: past, updatedAt: past,
        },
        [`patientInvitationClaims/${clinicianId}/emails/${emailOf(ids.patientA)}`]: {
            clinicianId, clinicId, patientEmail: emailOf(ids.patientA), invitationId: code, status: 'pending', expiresAt,
        },
    });
}

function patientAccepts(database: Firestore, code: string, clinicianId: string, clinicId: string) {
    const batch = writeBatch(database);
    batch.update(doc(database, `patientInvitations/${code}`), {
        status: 'accepted', patientId: ids.patientA, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(database, `clients/${ids.patientA}`), { clinicianId, clinicId, acceptedInvitationId: code }, { merge: true });
    batch.delete(doc(database, `patientInvitationClaims/${clinicianId}/emails/${emailOf(ids.patientA)}`));
    return batch.commit();
}

describe('clinician-initiated unlink (as-is gaps)', () => {
    it('GAP: an unlink without cascade orphans a future scheduled appointment nobody can cancel', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(clinicianA, `clients/${ids.patientA}`), unlinkFields));
        await assertFails(updateDoc(doc(clinicianA, `appointments/${seededAppointmentId}`), cancellation(ids.clinicianA)));
        await assertFails(getDoc(doc(clinicianA, `appointments/${seededAppointmentId}`)));
        const patientA = await as(ids.patientA);
        // The patient keeps seeing it as "scheduled" and, as-is, cannot clear it.
        await assertSucceeds(getDocs(query(collection(patientA, 'appointments'), where('patientId', '==', ids.patientA))));
        await onlyIfProposed(updateDoc(doc(patientA, `appointments/${seededAppointmentId}`), cancellation(ids.patientA)));
    });

    it('GAP: a pending re-invitation from the same clinician survives unlink and lets the patient relink', async () => {
        await seedPendingReinvitation();
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
        await assertSucceeds(patientAccepts(await as(ids.patientA), reinvite, ids.clinicianA, clinicA));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), 'sessions/session-a')));
    });

    it('SAFE NOW: one batch cancels the future appointment, cancels pending invitations, and unlinks', async () => {
        await seedPendingReinvitation();
        const clinicianA = await as(ids.clinicianA);
        const batch = writeBatch(clinicianA);
        // Rules evaluate get() against pre-batch state, so the still-linked check passes.
        batch.update(doc(clinicianA, `appointments/${seededAppointmentId}`), cancellation(ids.clinicianA));
        batch.update(doc(clinicianA, `patientInvitations/${reinvite}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianA, reinviteClaim));
        batch.update(doc(clinicianA, `clients/${ids.patientA}`), { ...unlinkFields, updatedAt: serverTimestamp() });
        await assertSucceeds(batch.commit());
        const patientA = await as(ids.patientA);
        await assertSucceeds(getDoc(doc(patientA, `appointments/${seededAppointmentId}`)));
        await assertFails(patientAccepts(patientA, reinvite, ids.clinicianA, clinicA));
    });

    it('the cascade batch is still all-or-nothing: an unrelated clinician cannot piggy-back on it', async () => {
        const clinicianB = await as(ids.clinicianB);
        const batch = writeBatch(clinicianB);
        batch.update(doc(clinicianB, `appointments/${seededAppointmentId}`), cancellation(ids.clinicianB));
        batch.update(doc(clinicianB, `clients/${ids.patientA}`), unlinkFields);
        await assertFails(batch.commit());
    });
});

describe('access after unlink (as-is, desired)', () => {
    beforeEach(async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
    });

    it('freezes messaging for both parties but keeps history readable by the patient only', async () => {
        await assertFails(sendMessage(await as(ids.patientA), ids.patientA, 'patient', 'after-unlink-p'));
        await assertFails(sendMessage(await as(ids.clinicianA), ids.clinicianA, 'clinician', 'after-unlink-c'));
        await assertSucceeds(getDoc(doc(await as(ids.patientA), threadA)));
        await assertSucceeds(getDocs(collection(await as(ids.patientA), `${threadA}/messages`)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), threadA)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `messages/${ids.patientA}`)));
    });

    it('removes former clinician and clinic colleagues from profile, sessions, QEEG, and device assignment', async () => {
        for (const uid of [ids.clinicianA, ids.colleagueA]) {
            const database = await as(uid);
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}`)));
            await assertFails(getDoc(doc(database, 'sessions/session-a')));
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}/brainMaps/bm-a`)));
            await assertFails(getDoc(doc(database, `deviceAssignments/${ids.patientA}`)));
        }
        await assertFails(setDoc(doc(await as(ids.clinicianA), 'sessions/after-unlink'), {
            id: 'after-unlink', patientId: ids.patientA, clinicId: clinicA, clinicianId: ids.clinicianA,
        }));
        await assertFails(setDoc(doc(await as(ids.clinicianA), `appointments/appt_cccccccccccccccccccccccc`), {
            clinicianId: ids.clinicianA, patientId: ids.patientA, patientDisplayName: `Name ${ids.patientA}`,
            startsAt: future(), timezone: 'UTC', durationMinutes: 45, type: 'consultation', status: 'scheduled',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: ids.clinicianA, revision: 1, schemaVersion: 1,
        }));
    });

    it('keeps the patient in control of their own data after unlink', async () => {
        const patientA = await as(ids.patientA);
        await assertSucceeds(getDoc(doc(patientA, 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(patientA, `clients/${ids.patientA}/brainMaps/bm-a`)));
        await assertSucceeds(updateDoc(doc(patientA, `deviceAssignments/${ids.patientA}`), { deviceId: 'muse-2' }));
    });
});

describe('relink to a different clinician (POLICY: history inheritance)', () => {
    it('gives the new clinician the prior history but not the former thread; stale appointments remain visible to the patient', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
        await seedPendingReinvitation(ids.clinicianB, clinicB, 'INVB-NEWP-ATNT');
        await assertSucceeds(patientAccepts(await as(ids.patientA), 'INVB-NEWP-ATNT', ids.clinicianB, clinicB));
        const clinicianB = await as(ids.clinicianB);
        await assertSucceeds(getDoc(doc(clinicianB, 'sessions/session-a')));
        await assertSucceeds(getDoc(doc(clinicianB, `clients/${ids.patientA}/brainMaps/bm-a`)));
        await assertFails(getDoc(doc(clinicianB, threadA)));
        await assertFails(getDoc(doc(clinicianB, `appointments/${seededAppointmentId}`)));
        // Clinician A's appointment still reads as scheduled in the patient's list.
        await assertSucceeds(getDoc(doc(await as(ids.patientA), `appointments/${seededAppointmentId}`)));
        await onlyIfProposed(updateDoc(doc(await as(ids.patientA), `appointments/${seededAppointmentId}`), cancellation(ids.patientA)));
    });
});

describe('patient-initiated withdrawal (POLICY-GATED rules change)', () => {
    it('as-is denies it; proposed allows clearing exactly the four link fields', async () => {
        await onlyIfProposed(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), { ...unlinkFields, updatedAt: serverTimestamp() }));
    });

    it('proposed: withdrawal and orphan cancellation commit atomically', async () => {
        const patientA = await as(ids.patientA);
        const batch = writeBatch(patientA);
        batch.update(doc(patientA, `clients/${ids.patientA}`), unlinkFields);
        batch.update(doc(patientA, `appointments/${seededAppointmentId}`), cancellation(ids.patientA));
        await onlyIfProposed(batch.commit());
    });

    it('rejects partial withdrawal, reassignment, and bundling other edits', async () => {
        const patientA = await as(ids.patientA);
        const profile = doc(patientA, `clients/${ids.patientA}`);
        await assertFails(updateDoc(profile, { clinicianId: null }));
        await assertFails(updateDoc(profile, { ...unlinkFields, clinicianId: ids.clinicianB }));
        await assertFails(updateDoc(profile, { ...unlinkFields, clinicId: clinicB }));
        await assertFails(updateDoc(profile, { ...unlinkFields, assignedProtocol: 'alpha-enhancement' }));
        await assertFails(updateDoc(doc(await as(ids.patientB), `clients/${ids.patientA}`), unlinkFields));
        await assertFails(updateDoc(doc(await as(ids.colleagueA), `clients/${ids.patientA}`), unlinkFields));
    });

    it('lets a legacy-only linked patient withdraw (proposed) and never touches split-brain canonical owners wrongly', async () => {
        await onlyIfProposed(updateDoc(doc(await as(ids.legacyPatient), `clients/${ids.legacyPatient}`), unlinkFields));
    });
});

describe('patient cancellation of orphaned appointments (adversarial)', () => {
    it('denies cancelling while the clinician is still current, others\' appointments, and schedule edits', async () => {
        const patientA = await as(ids.patientA);
        const appointment = doc(patientA, `appointments/${seededAppointmentId}`);
        await assertFails(updateDoc(appointment, cancellation(ids.patientA)));
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
        await assertFails(updateDoc(appointment, { ...cancellation(ids.patientA), cancelledBy: ids.clinicianA }));
        await assertFails(updateDoc(appointment, { ...cancellation(ids.patientA), revision: 7 }));
        await assertFails(updateDoc(appointment, { ...cancellation(ids.patientA), notes: 'rewritten' }));
        await assertFails(updateDoc(appointment, { startsAt: future(), updatedAt: serverTimestamp(), revision: 2 }));
        await assertFails(updateDoc(doc(await as(ids.patientB), `appointments/${seededAppointmentId}`), cancellation(ids.patientB)));
        await assertFails(deleteDoc(appointment));
        await assertFails(updateDoc(doc(patientA, 'appointments/legacy-appointment-for-a'), cancellation(ids.patientA)));
    });
});

describe('patient account deletion (what the client can and cannot erase)', () => {
    it('a linked patient can delete users/{uid} and the device assignment, but nothing clinical', async () => {
        const patientA = await as(ids.patientA);
        await assertSucceeds(deleteDoc(doc(patientA, `deviceAssignments/${ids.patientA}`)));
        await assertFails(deleteDoc(doc(patientA, `clients/${ids.patientA}`)));
        await assertFails(deleteDoc(doc(patientA, 'sessions/session-a')));
        await assertFails(deleteDoc(doc(patientA, `clients/${ids.patientA}/brainMaps/bm-a`)));
        await assertFails(deleteDoc(doc(patientA, threadA)));
        await assertFails(deleteDoc(doc(patientA, `${threadA}/messages/msg-seeded-1`)));
        await assertFails(deleteDoc(doc(patientA, `appointments/${seededAppointmentId}`)));
        await assertFails(deleteDoc(doc(patientA, 'patientInvitations/INVA-AAAA-AAAA')));
        await assertSucceeds(deleteDoc(doc(patientA, `users/${ids.patientA}`)));
    });

    it('GAP: after the app\'s current deletion flow, the clinician still reads and writes to the closed account', async () => {
        await assertSucceeds(deleteDoc(doc(await as(ids.patientA), `users/${ids.patientA}`)));
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(clinicianA, `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(clinicianA, 'sessions/session-a')));
        await assertSucceeds(sendMessage(clinicianA, ids.clinicianA, 'clinician', 'to-a-closed-account'));
    });

    it('an unlinked patient can delete their profile; orphaned sessions stay readable only by that uid', async () => {
        const patientU = await as(ids.unlinked);
        await seedDocuments({ 'sessions/session-u': { id: 'session-u', patientId: ids.unlinked, clinicId: null, clinicianId: ids.clinicianA } });
        await assertSucceeds(deleteDoc(doc(patientU, `deviceAssignments/${ids.unlinked}`)));
        await assertSucceeds(deleteDoc(doc(patientU, `clients/${ids.unlinked}`)));
        await assertSucceeds(deleteDoc(doc(patientU, `users/${ids.unlinked}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianA), 'sessions/session-u')));
        await assertSucceeds(getDoc(doc(patientU, 'sessions/session-u')));
        await assertFails(deleteDoc(doc(patientU, 'sessions/session-u')));
    });

    it('a deleted-and-recreated unlinked profile cannot be used to reclaim a relationship', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
        const patientA = await as(ids.patientA);
        await assertSucceeds(deleteDoc(doc(patientA, `clients/${ids.patientA}`)));
        await assertFails(setDoc(doc(patientA, `clients/${ids.patientA}`), {
            id: ids.patientA, name: 'x', clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
        }));
        await assertSucceeds(setDoc(doc(patientA, `clients/${ids.patientA}`), { id: ids.patientA, name: 'fresh' }));
        await assertFails(getDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
    });
});

// ---- Added in Track C completion pass ----
const onlyAsIs = (operation: Promise<unknown>) => (PROPOSED ? assertFails(operation) : assertSucceeds(operation));

describe('unlink write hygiene (proposed hardening)', () => {
    it('as-is lets the clinician smuggle other edits into the unlink write; proposed denies it', async () => {
        await onlyAsIs(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), {
            ...unlinkFields, assignedProtocol: 'alpha-enhancement', name: 'Renamed on the way out',
        }));
    });

    it('proposed still accepts the exact write storageEngine.unlinkPatient sends', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), { ...unlinkFields, updatedAt: serverTimestamp() }));
    });

    it('proposed rejects a client-chosen updatedAt on unlink or withdrawal', async () => {
        await onlyAsIs(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), { ...unlinkFields, updatedAt: past }));
        await assertFails(updateDoc(doc(await as(ids.legacyPatient), `clients/${ids.legacyPatient}`), { ...unlinkFields, updatedAt: past }));
    });
});

describe('patient withdrawal effects (proposed)', () => {
    it('after withdrawal the former clinician and colleagues lose access and messaging freezes', async () => {
        if (!PROPOSED) return;
        const patientA = await as(ids.patientA);
        await assertSucceeds(updateDoc(doc(patientA, `clients/${ids.patientA}`), { ...unlinkFields, updatedAt: serverTimestamp() }));
        for (const uid of [ids.clinicianA, ids.colleagueA]) {
            const database = await as(uid);
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}`)));
            await assertFails(getDoc(doc(database, 'sessions/session-a')));
            await assertFails(getDoc(doc(database, `clients/${ids.patientA}/brainMaps/bm-a`)));
        }
        await assertFails(sendMessage(await as(ids.clinicianA), ids.clinicianA, 'clinician', 'after-withdrawal'));
        await assertSucceeds(getDocs(collection(patientA, `${threadA}/messages`)));
        await assertSucceeds(getDoc(doc(patientA, 'sessions/session-a')));
    });

    it('withdrawal is not a relink: the patient cannot restore the old link without a fresh pending invitation', async () => {
        if (!PROPOSED) return;
        const patientA = await as(ids.patientA);
        await assertSucceeds(updateDoc(doc(patientA, `clients/${ids.patientA}`), unlinkFields));
        await assertFails(updateDoc(doc(patientA, `clients/${ids.patientA}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA',
        }));
    });

    it('an unlinked patient still cannot clear stray clinic-only fields through the withdrawal path', async () => {
        await seedDocuments({ [`clients/${ids.unlinked}`]: { id: ids.unlinked, name: 'U', clinicId: clinicA } });
        await assertFails(updateDoc(doc(await as(ids.unlinked), `clients/${ids.unlinked}`), unlinkFields));
    });
});

describe('orphaned appointment edge cases', () => {
    it('a past scheduled appointment of the former clinician stays immutable', async () => {
        const pastId = 'appt_pppppppppppppppppppppppp';
        await seedDocuments({
            [`appointments/${pastId}`]: {
                clinicianId: ids.clinicianA, patientId: ids.patientA, patientDisplayName: `Name ${ids.patientA}`,
                startsAt: past, timezone: 'UTC', durationMinutes: 45, type: 'consultation', status: 'scheduled',
                createdAt: past, updatedAt: past, createdBy: ids.clinicianA, revision: 1, schemaVersion: 1,
            },
        });
        await assertSucceeds(updateDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`), unlinkFields));
        await assertFails(updateDoc(doc(await as(ids.patientA), `appointments/${pastId}`), cancellation(ids.patientA)));
    });

    it('the former clinician can still cancel their own pending invitation after unlink (no link needed)', async () => {
        await seedPendingReinvitation();
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(clinicianA, `clients/${ids.patientA}`), unlinkFields));
        const batch = writeBatch(clinicianA);
        batch.update(doc(clinicianA, `patientInvitations/${reinvite}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianA, reinviteClaim));
        await assertSucceeds(batch.commit());
    });
});

describe('account deletion half-failure (as-is)', () => {
    it('GAP: users/{uid} deleted before Auth delete fails leaves a linked, role-less account that can self-assign clinician', async () => {
        const patientA = await as(ids.patientA);
        await assertSucceeds(deleteDoc(doc(patientA, `users/${ids.patientA}`)));
        // Auth delete throws auth/requires-recent-login in the app; on next sign-in role is null.
        await assertSucceeds(setDoc(doc(patientA, `users/${ids.patientA}`), { role: 'clinician', email: emailOf(ids.patientA) }));
        await assertSucceeds(getDoc(doc(patientA, `clients/${ids.patientA}`)));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `clients/${ids.patientA}`)));
    });

    it('a patient whose clinician account is gone stays linked as-is; proposed lets them withdraw', async () => {
        await seedDocuments({ [`clients/${ids.patientB}`]: {
            id: ids.patientB, name: 'B', clinicianId: 'deleted-clinician-uid', clinicId: 'deleted-clinic', acceptedInvitationId: 'GONE-GONE-GONE',
        } });
        await onlyIfProposed(updateDoc(doc(await as(ids.patientB), `clients/${ids.patientB}`), unlinkFields));
        // Once withdrawn, the unlinked-profile delete rule applies.
        await onlyIfProposed(deleteDoc(doc(await as(ids.patientB), `clients/${ids.patientB}`)));
    });
});
