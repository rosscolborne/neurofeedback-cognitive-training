import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
    type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clinicA, clinicB, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments, seededAppointmentId } from './fixture';

// Replays the app's real transactions, including their reads of documents that
// may not exist yet, so rules that only pass batch-shaped writes cannot hide a
// broken client flow. Shapes mirror src/services/storageEngine.ts,
// messageRepository.ts, appointmentRepository.ts, and clinicSettingsRepository.ts.

beforeEach(resetWorld);
afterAll(closeEnvironment);

const code = 'INVU-TXNX-TXNX';
const invitedEmail = emailOf(ids.unlinked);
const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${invitedEmail}`;
const noticePath = `patientInvitationNotices/${invitedEmail}/clinicians/${ids.clinicianA}`;

/** storageEngine.createPatientInvitation */
function createInvitation(database: Firestore, clinicianId: string = ids.clinicianA, clinicId: string = clinicA) {
    const claim = doc(database, `patientInvitationClaims/${clinicianId}/emails/${invitedEmail}`);
    const expiresAt = future();
    return runTransaction(database, async (transaction) => {
        await transaction.get(claim);
        transaction.set(doc(database, `patientInvitations/${code}`), {
            id: code, clinicianId, clinicId, clinicianName: 'Dr A', patientEmail: invitedEmail, patientName: 'Invited',
            condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3, status: 'pending',
            uniquenessClaimId: invitedEmail, schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt,
        });
        transaction.set(claim, {
            clinicianId, clinicId, patientEmail: invitedEmail, invitationId: code, status: 'pending', expiresAt, createdAt: serverTimestamp(),
        });
        transaction.set(doc(database, `patientInvitationNotices/${invitedEmail}/clinicians/${clinicianId}`), { expiresAt, updatedAt: serverTimestamp() });
    });
}

/** storageEngine.acceptPatientInvitation */
function acceptInvitation(database: Firestore, patientId: string = ids.unlinked) {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `patientInvitations/${code}`));
        await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `clients/${patientId}`), {
            id: patientId, patientId, email: invitedEmail, name: `Name ${patientId}`, clinicianId: ids.clinicianA, clinicId: clinicA,
            acceptedInvitationId: code, condition: 'ADHD', assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.set(doc(database, `patientInvitations/${code}`), {
            status: 'accepted', patientId, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: true });
        transaction.delete(doc(database, claimPath));
        transaction.delete(doc(database, noticePath));
    });
}

/** storageEngine.cancelPatientInvitation */
function cancelInvitation(database: Firestore) {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `patientInvitations/${code}`));
        transaction.set(doc(database, `patientInvitations/${code}`), { status: 'cancelled', updatedAt: serverTimestamp() }, { merge: true });
        transaction.delete(doc(database, claimPath));
        transaction.delete(doc(database, noticePath));
    });
}

describe('invitation transactions', () => {
    it('create, then accept, links the patient end to end', async () => {
        await assertSucceeds(createInvitation(await as(ids.clinicianA)));
        await assertSucceeds(acceptInvitation(await as(ids.unlinked)));
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), `clients/${ids.unlinked}`)));
    });

    it('create, then cancel, releases the claim so a new invitation can follow', async () => {
        await assertSucceeds(createInvitation(await as(ids.clinicianA)));
        await assertSucceeds(cancelInvitation(await as(ids.clinicianA)));
    });

    it('outsiders cannot run the create, accept, or cancel transactions', async () => {
        await assertFails(createInvitation(await as(ids.clinicianB), ids.clinicianB, clinicA));
        await assertSucceeds(createInvitation(await as(ids.clinicianA)));
        await assertFails(acceptInvitation(await as(ids.patientB), ids.patientB));
        await assertFails(cancelInvitation(await as(ids.clinicianB)));
    });

    it('claim reads stay private to the owning clinician, present or not', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.clinicianA), claimPath)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), claimPath)));
        await assertFails(getDoc(doc(await as(ids.unlinked), claimPath)));
    });
});

/** storageEngine.disconnectFromClinician, as the signed-in patient */
function disconnectFromClinician(
    database: Firestore, patientId: string, appointmentIds: string[] = [],
    appointmentExtra: Record<string, unknown> = {}, profileExtra: Record<string, unknown> = {},
) {
    return runTransaction(database, async (transaction) => {
        const client = await transaction.get(doc(database, `clients/${patientId}`));
        const appointments = await Promise.all(appointmentIds.map((id) => transaction.get(doc(database, `appointments/${id}`))));
        for (const appointment of appointments) {
            transaction.update(appointment.ref, {
                status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: client.id,
                cancellationRequestId: 'cancel_dddddddddddddddddddddddd', updatedAt: serverTimestamp(),
                revision: (appointment.get('revision') as number) + 1,
                ...appointmentExtra,
            });
        }
        transaction.update(client.ref, {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
            ...profileExtra,
        });
    });
}

describe('relationship transactions', () => {
    it('storageEngine.unlinkPatient lets the canonical clinician clear the relationship', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(clinicianA, `clients/${ids.patientA}`)));
        await assertSucceeds(setDoc(doc(clinicianA, `clients/${ids.patientA}`), {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
        }, { merge: true }));
    });

    it('storageEngine.unlinkPatient cancels future appointments and pending invitations with the unlink, atomically', async () => {
        const patientEmail = emailOf(ids.patientA);
        const reinvite = 'REIN-VITE-AAAA';
        const reinviteClaim = `patientInvitationClaims/${ids.clinicianA}/emails/${patientEmail}`;
        const legacyInvite = 'LEGA-CYNO-CLAI'; // pending with a claim id whose claim document is missing
        const expiresAt = future();
        const extraAppointments: Record<string, Record<string, unknown>> = {};
        for (const suffix of ['b', 'c', 'd', 'e']) {
            extraAppointments[`appointments/appt_${suffix.repeat(24)}`] = {
                clinicianId: ids.clinicianA, patientId: ids.patientA, patientDisplayName: `Name ${ids.patientA}`,
                startsAt: expiresAt, timezone: 'UTC', durationMinutes: 45, type: 'consultation', status: 'scheduled',
                createdAt: past, updatedAt: past, createdBy: ids.clinicianA, revision: 1, schemaVersion: 1,
            };
        }
        await seedDocuments({
            ...extraAppointments,
            [`patientInvitations/${reinvite}`]: {
                id: reinvite, clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail, patientName: 'A', status: 'pending',
                uniquenessClaimId: patientEmail, expiresAt, createdAt: past, updatedAt: past,
            },
            [reinviteClaim]: { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail, invitationId: reinvite, status: 'pending', expiresAt },
            [`patientInvitations/${legacyInvite}`]: {
                id: legacyInvite, clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail, patientName: 'A', status: 'pending',
                uniquenessClaimId: 'someone-else@example.test', expiresAt, createdAt: past, updatedAt: past,
            },
        });
        const clinicianA = await as(ids.clinicianA);
        // The same reads the client makes before building the batch, including claim ownership.
        await assertSucceeds(getDocs(query(collection(clinicianA, 'appointments'),
            where('clinicianId', '==', ids.clinicianA), where('patientId', '==', ids.patientA))));
        await assertSucceeds(getDocs(query(collection(clinicianA, 'patientInvitations'), where('clinicianId', '==', ids.clinicianA))));
        await assertSucceeds(getDoc(doc(clinicianA, reinviteClaim)));
        await assertSucceeds(getDoc(doc(clinicianA, `patientInvitationClaims/${ids.clinicianA}/emails/someone-else@example.test`)));

        const batch = writeBatch(clinicianA);
        for (const path of [`appointments/${seededAppointmentId}`, ...Object.keys(extraAppointments)]) {
            batch.update(doc(clinicianA, path), {
                status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.clinicianA,
                cancellationRequestId: 'cancel_cccccccccccccccccccccccc', updatedAt: serverTimestamp(), revision: 2,
            });
        }
        batch.update(doc(clinicianA, `patientInvitations/${reinvite}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianA, reinviteClaim));
        batch.delete(doc(clinicianA, `patientInvitationNotices/${patientEmail}/clinicians/${ids.clinicianA}`));
        // Missing claim: cancel the invitation without a claim delete.
        batch.update(doc(clinicianA, `patientInvitations/${legacyInvite}`), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.update(doc(clinicianA, `clients/${ids.patientA}`), {
            clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
        });
        await assertSucceeds(batch.commit());

        await assertFails(getDoc(doc(clinicianA, `clients/${ids.patientA}`)));
        const patientA = await as(ids.patientA);
        const appointment = await getDoc(doc(patientA, `appointments/${seededAppointmentId}`));
        expect(appointment.get('status')).toBe('cancelled');
        expect(appointment.get('revision')).toBe(2);
        const invitation = await getDoc(doc(patientA, `patientInvitations/${reinvite}`));
        expect(invitation.get('status')).toBe('cancelled');
        expect((await getDoc(doc(clinicianA, reinviteClaim))).exists()).toBe(false);
    });

    it('storageEngine.disconnectFromClinician lets the patient end their own relationship and cancel that clinician’s future appointments', async () => {
        const patientA = await as(ids.patientA);
        const appointments = await assertSucceeds(getDocs(query(collection(patientA, 'appointments'), where('patientId', '==', ids.patientA))));
        expect(appointments.docs.map((entry) => entry.id)).toContain(seededAppointmentId);
        await assertSucceeds(disconnectFromClinician(patientA, ids.patientA, [seededAppointmentId]));

        const clinicianA = await as(ids.clinicianA);
        await assertFails(getDoc(doc(clinicianA, `clients/${ids.patientA}`)));
        await assertFails(getDoc(doc(clinicianA, 'sessions/session-a')));
        await assertFails(getDoc(doc(clinicianA, `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`)));
        await assertFails(getDoc(doc(clinicianA, `appointments/${seededAppointmentId}`)));
        await assertFails(updateDoc(doc(clinicianA, `clients/${ids.patientA}`), { notes: 'new care' }));
        const profile = await assertSucceeds(getDoc(doc(patientA, `clients/${ids.patientA}`)));
        expect(profile.get('clinicianId')).toBeNull();
        expect(profile.get('assignedProtocol')).toBe('theta-beta-ratio');
        await assertSucceeds(getDoc(doc(patientA, 'sessions/session-a')));
        const appointment = await getDoc(doc(patientA, `appointments/${seededAppointmentId}`));
        expect(appointment.get('status')).toBe('cancelled');
        expect(appointment.get('cancelledBy')).toBe(ids.patientA);
        // The accepted invitation is consumed, so the relationship cannot be replayed.
        await assertFails(updateDoc(doc(patientA, `clients/${ids.patientA}`), {
            clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA', updatedAt: serverTimestamp(),
        }));
    });

    it('lets a patient linked only through the legacy code disconnect', async () => {
        await assertSucceeds(disconnectFromClinician(await as(ids.legacyPatient), ids.legacyPatient));
    });

    it('a patient disconnect cannot carry other edits, relink elsewhere, or touch another patient', async () => {
        const patientA = await as(ids.patientA);
        const clientRef = doc(patientA, `clients/${ids.patientA}`);
        const cleared = { clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp() };
        await assertFails(updateDoc(clientRef, { ...cleared, name: 'Renamed' }));
        await assertFails(updateDoc(clientRef, { ...cleared, clinicianId: ids.clinicianB, clinicId: clinicB }));
        await assertFails(updateDoc(doc(await as(ids.patientB), `clients/${ids.patientA}`), cleared));
    });

    it.each([
        ['notes', { notes: 'changed during disconnect' }],
        ['startsAt', { startsAt: Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000) }],
        ['patientId', { patientId: ids.patientB }],
        ['clinicianId', { clinicianId: ids.clinicianB }],
        ['cancelledBy', { cancelledBy: ids.clinicianA }],
    ])('a disconnect cannot also change the appointment’s %s', async (_field, appointmentExtra) => {
        const patientA = await as(ids.patientA);
        await assertFails(disconnectFromClinician(patientA, ids.patientA, [seededAppointmentId], appointmentExtra));
        // The canonical cancellation alone, in the same disconnect, is still allowed.
        await assertSucceeds(disconnectFromClinician(patientA, ids.patientA, [seededAppointmentId]));
        const appointment = await getDoc(doc(patientA, `appointments/${seededAppointmentId}`));
        expect(appointment.get('status')).toBe('cancelled');
        expect(appointment.get('notes')).toBe('seeded');
        expect(appointment.get('patientId')).toBe(ids.patientA);
        expect(appointment.get('clinicianId')).toBe(ids.clinicianA);
        expect(appointment.get('cancelledBy')).toBe(ids.patientA);
    });

    it.each([
        ['keeping clinicId', { clinicId: clinicA }],
        ['clearing only clinicianId', { clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA' }],
        ['relinking through linkedClinicianCode', { linkedClinicianCode: ids.clinicianB }],
        ['changing the assignment', { assignedProtocol: 'alpha-enhancement', allowedExperiences: ['neuro-gambit'] }],
        ['changing the custom protocol config', { customProtocolConfig: { id: 'custom', name: 'Patient-made rule' } }],
    ])('a disconnect write refuses %s', async (_label, profileExtra) => {
        const patientA = await as(ids.patientA);
        await assertFails(disconnectFromClinician(patientA, ids.patientA, [], {}, profileExtra));
        const profile = await getDoc(doc(patientA, `clients/${ids.patientA}`));
        expect(profile.get('clinicianId')).toBe(ids.clinicianA);
        expect(profile.get('assignedProtocol')).toBe('theta-beta-ratio');
    });

    it('a patient cancels a clinician’s appointment only in the write that disconnects from that clinician', async () => {
        const patientA = await as(ids.patientA);
        const cancel = {
            status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.patientA,
            cancellationRequestId: 'cancel_pppppppppppppppppppppppp', updatedAt: serverTimestamp(), revision: 2,
        };
        // Still linked: cancelling alone is not a disconnect.
        await assertFails(updateDoc(doc(patientA, `appointments/${seededAppointmentId}`), cancel));
        // Another clinician's appointment cannot ride along with this disconnect.
        const otherId = 'appt_oooooooooooooooooooooooo';
        await seedDocuments({
            [`appointments/${otherId}`]: {
                clinicianId: ids.clinicianB, patientId: ids.patientA, patientDisplayName: `Name ${ids.patientA}`,
                startsAt: future(), timezone: 'UTC', durationMinutes: 45, type: 'consultation', status: 'scheduled',
                createdAt: past, updatedAt: past, createdBy: ids.clinicianB, revision: 1, schemaVersion: 1,
            },
        });
        await assertFails(disconnectFromClinician(patientA, ids.patientA, [otherId]));
        // Once disconnected, a later cancellation on its own is refused.
        await assertSucceeds(disconnectFromClinician(patientA, ids.patientA));
        await assertFails(updateDoc(doc(patientA, `appointments/${seededAppointmentId}`), cancel));
    });

    it('an unrelated clinician cannot cancel another clinician’s appointment, even alone', async () => {
        await assertFails(updateDoc(doc(await as(ids.clinicianB), `appointments/${seededAppointmentId}`), {
            status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.clinicianB,
            cancellationRequestId: 'cancel_cccccccccccccccccccccccc', updatedAt: serverTimestamp(), revision: 2,
        }));
    });

    it('a clinician cannot cancel another clinician’s invitation or release their claim', async () => {
        const email = emailOf(ids.unlinked);
        const claimPath = `patientInvitationClaims/${ids.clinicianB}/emails/${email}`;
        const expiresAt = future();
        await seedDocuments({
            'patientInvitations/BINV-BBBB-BBBB': {
                id: 'BINV-BBBB-BBBB', clinicianId: ids.clinicianB, clinicId: ids.clinicianB, patientEmail: email, patientName: 'U',
                status: 'pending', uniquenessClaimId: email, expiresAt, createdAt: past, updatedAt: past,
            },
            [claimPath]: { clinicianId: ids.clinicianB, clinicId: ids.clinicianB, patientEmail: email, invitationId: 'BINV-BBBB-BBBB', status: 'pending', expiresAt },
        });
        const clinicianA = await as(ids.clinicianA);
        const batch = writeBatch(clinicianA);
        batch.update(doc(clinicianA, 'patientInvitations/BINV-BBBB-BBBB'), { status: 'cancelled', updatedAt: serverTimestamp() });
        batch.delete(doc(clinicianA, claimPath));
        await assertFails(batch.commit());
        await assertFails(deleteDoc(doc(clinicianA, claimPath)));
    });

    it('storageEngine.getCurrentClient creates a missing profile for the signed-in user', async () => {
        const fresh = 'fresh-patient';
        const database = await as(fresh);
        await assertSucceeds(getDoc(doc(database, `clients/${fresh}`)));
        await assertSucceeds(setDoc(doc(database, `clients/${fresh}`), { id: fresh, email: emailOf(fresh), name: 'New', badges: [], brainMaps: [] }));
    });
});

/** storageEngine.createSession: session plus aggregate merge onto the patient profile. */
function createSession(database: Firestore, sessionId: string, patientId: string, extra: Record<string, unknown> = {}) {
    return runTransaction(database, async (transaction) => {
        const client = await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `sessions/${sessionId}`), {
            id: sessionId, patientId, clinicId: clinicA, isDemo: true, timeInZonePercent: 50,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: serverTimestamp(), ...extra,
        });
        if (client.exists()) {
            transaction.set(doc(database, `clients/${patientId}`), {
                ...client.data(), completedSessionsCount: 1, recentCompletedSessionIds: [sessionId], badges: ['first-light'],
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    });
}

/** storageEngine.patchSessionNotes */
function patchNotes(database: Firestore, sessionId: string, patch: Record<string, unknown>) {
    return runTransaction(database, async (transaction) => {
        const session = await transaction.get(doc(database, `sessions/${sessionId}`));
        const patientId = session.data()?.patientId as string;
        if (patientId) await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `sessions/${sessionId}`), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
    });
}

describe('session transactions', () => {
    it('the patient, canonical clinician, and clinic colleague can save sessions with the aggregate merge', async () => {
        await assertSucceeds(createSession(await as(ids.patientA), 'tx-patient', ids.patientA));
        await assertSucceeds(createSession(await as(ids.clinicianA), 'tx-clinician', ids.patientA, { clinicianId: ids.clinicianA }));
        await assertSucceeds(createSession(await as(ids.colleagueA), 'tx-colleague', ids.patientA));
    });

    it('an unrelated clinician or patient cannot save a session for patient-a', async () => {
        await assertFails(createSession(await as(ids.clinicianB), 'tx-outsider', ids.patientA));
        await assertFails(createSession(await as(ids.patientB), 'tx-outsider', ids.patientA));
    });

    it('note patches work for the right party only', async () => {
        await assertSucceeds(patchNotes(await as(ids.patientA), 'session-a', { patientNotes: 'calm', moodRating: 4 }));
        await assertSucceeds(patchNotes(await as(ids.clinicianA), 'session-a', { clinicianNotes: 'good' }));
        await assertFails(patchNotes(await as(ids.clinicianB), 'session-a', { clinicianNotes: 'x' }));
    });
});

/** storageEngine.appendBrainMap */
function appendBrainMap(database: Firestore, clinicianId: string, id = 'qeeg-tx') {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `clients/${ids.patientA}`));
        await transaction.get(doc(database, `clients/${ids.patientA}/brainMaps/${id}`));
        transaction.set(doc(database, `clients/${ids.patientA}/brainMaps/${id}`), {
            id, fileName: '', deviceSource: 'Muse S Athena', technicianNotes: '',
            zScores: { frontalTheta: 1, centralBeta: 0, occipitalAlpha: 0, temporalDelta: 0, sensorimotorSMR: 0 },
            dominantAlphaPeakHz: 10, createdBy: clinicianId, schemaVersion: 1,
            uploadDate: serverTimestamp(), recordingDate: past, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
    });
}

describe('QEEG transaction', () => {
    it('only the canonical clinician can append', async () => {
        await assertSucceeds(appendBrainMap(await as(ids.clinicianA), ids.clinicianA));
        await assertFails(appendBrainMap(await as(ids.clinicianB), ids.clinicianB));
    });
});

/** messageRepository.send: summary plus immutable message. */
function sendMessage(database: Firestore, sender: string, messageId: string) {
    const threadPath = `messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`;
    return runTransaction(database, async (transaction) => {
        const summary = await transaction.get(doc(database, threadPath));
        transaction.set(doc(database, threadPath), {
            patientId: ids.patientA, clinicianId: ids.clinicianA, participantIds: [ids.patientA, ids.clinicianA],
            lastMessageText: 'hi', lastMessageId: messageId, lastSenderId: sender, lastMessageAt: serverTimestamp(),
            updatedAt: serverTimestamp(), schemaVersion: 1, ...(!summary.exists() ? { createdAt: serverTimestamp() } : {}),
        }, { merge: true });
        transaction.set(doc(database, `${threadPath}/messages/${messageId}`), {
            id: messageId, patientId: ids.patientA, clinicianId: ids.clinicianA, senderId: sender,
            senderRole: sender === ids.patientA ? 'patient' : 'clinician', text: 'hi', createdAt: serverTimestamp(), schemaVersion: 1,
        });
    });
}

describe('messaging transaction', () => {
    it('both participants can send; outsiders cannot', async () => {
        await assertSucceeds(sendMessage(await as(ids.patientA), ids.patientA, 'tx-p'));
        await assertSucceeds(sendMessage(await as(ids.clinicianA), ids.clinicianA, 'tx-c'));
        await assertFails(sendMessage(await as(ids.clinicianB), ids.clinicianB, 'tx-x'));
    });
});

const newAppointmentId = 'appt_txnxtxnxtxnxtxnxtxnxtxnx';

/** AppointmentRepository.create */
function createAppointment(database: Firestore, clinicianId: string, patientId: string) {
    return runTransaction(database, async (transaction) => {
        await transaction.get(doc(database, `appointments/${newAppointmentId}`));
        await transaction.get(doc(database, `clients/${patientId}`));
        transaction.set(doc(database, `appointments/${newAppointmentId}`), {
            clinicianId, patientId, patientDisplayName: `Name ${patientId}`, startsAt: future(), timezone: 'America/Toronto',
            durationMinutes: 45, type: 'remote-training', status: 'scheduled', notes: 'check-in',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: clinicianId, revision: 1, schemaVersion: 1,
        });
    });
}

/** AppointmentRepository.edit and cancel */
function updateAppointment(database: Firestore, patch: Record<string, unknown>) {
    return runTransaction(database, async (transaction) => {
        const current = await transaction.get(doc(database, `appointments/${seededAppointmentId}`));
        await transaction.get(doc(database, `clients/${current.data()?.patientId ?? ids.patientA}`));
        transaction.update(doc(database, `appointments/${seededAppointmentId}`), { ...patch, updatedAt: serverTimestamp() });
    });
}

describe('appointment transactions', () => {
    it('the canonical clinician can create, edit, and cancel', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(createAppointment(clinicianA, ids.clinicianA, ids.patientA));
        await assertSucceeds(updateAppointment(clinicianA, { durationMinutes: 60, type: 'protocol-review', notes: 'edited', revision: 2 }));
        await assertSucceeds(updateAppointment(clinicianA, {
            status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: ids.clinicianA,
            cancellationRequestId: 'cancel_bbbbbbbbbbbbbbbbbbbbbbbb', revision: 3,
        }));
    });

    it('outsiders cannot create for, or read, another clinician’s appointments', async () => {
        await assertFails(createAppointment(await as(ids.clinicianB), ids.clinicianB, ids.patientA));
        await assertFails(updateAppointment(await as(ids.clinicianB), { notes: 'x', revision: 2 }));
        await assertFails(getDoc(doc(await as(ids.clinicianB), `appointments/${seededAppointmentId}`)));
    });

    it('only a clinician may confirm a free appointment ID, and only a well-formed one', async () => {
        await assertSucceeds(getDoc(doc(await as(ids.clinicianB), `appointments/${newAppointmentId}`)));
        await assertFails(getDoc(doc(await as(ids.patientA), `appointments/${newAppointmentId}`)));
        await assertFails(getDoc(doc(await as(ids.clinicianB), 'appointments/short')));
    });
});

describe('clinic settings writes', () => {
    it('clinicSettingsRepository.saveBrand merges branding onto the clinic', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(clinicianA, `practitioners/${ids.clinicianA}`)));
        await assertSucceeds(getDoc(doc(clinicianA, `clinics/${clinicA}`)));
        await assertSucceeds(setDoc(doc(clinicianA, `clinics/${clinicA}`), {
            id: clinicA, name: 'Clinic A', timezone: 'UTC', practitionerIds: [ids.clinicianA, ids.colleagueA],
            branding: { name: 'Brand', createdAt: Timestamp.fromMillis(Date.now()) }, updatedAt: serverTimestamp(),
        }, { merge: true }));
    });
});
