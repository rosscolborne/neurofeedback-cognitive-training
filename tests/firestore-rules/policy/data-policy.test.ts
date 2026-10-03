// Security review probe. Data-integrity and data-governance behavior that is
// intentional or a product decision rather than a clear bug.
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
    collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';
import { as, clinicA, clinicB, closeEnvironment, emailOf, future, ids, past, resetWorld, seedDocuments } from '../fixture';

beforeEach(resetWorld);
afterAll(closeEnvironment);

describe('REVIEW: patient-writable clinical fields', () => {
    // POLICY (Medium, pre-existing on main). The patient owns clients/{uid} and may change
    // every non-relationship field, including the clinician-prescribed care plan and the
    // legacy embedded QEEG array. Also the aggregates that createSession writes.
    it('POLICY: a linked patient can rewrite their prescribed protocol, weekly target, condition and legacy QEEG', async () => {
        await assertSucceeds(updateDoc(doc(await as(ids.patientA), `clients/${ids.patientA}`), {
            assignedProtocol: 'alpha-enhancement', prescribedSessionsPerWeek: 0, condition: 'none', notes: 'patient edited',
            brainMaps: [{ id: 'forged', zScores: { frontalTheta: 99 } }],
        }));
    });

    // FINE (inherent to client-recorded sessions). A patient can create a session for
    // themselves with any measurements and any clinicianId label.
    it('FINE/INHERENT: a patient can create a session with arbitrary measurements and clinicianId label', async () => {
        await assertSucceeds(setDoc(doc(await as(ids.patientA), 'sessions/self-reported'), {
            patientId: ids.patientA, clinicId: clinicA, clinicianId: ids.clinicianB, timeInZonePercent: 100, isDemo: false,
        }));
    });
});

describe('REVIEW: record access across relationship changes', () => {
    // POLICY. Authorization follows the CURRENT relationship. A newly linked clinician
    // reads every historical session and QEEG record, including ones produced under a
    // previous clinician/clinic; the former clinician loses all access at unlink.
    it('POLICY: a new clinician inherits the full history recorded under a previous clinician', async () => {
        await seedDocuments({
            'sessions/old-under-b': { id: 'old-under-b', patientId: ids.unlinked, clinicId: clinicB, clinicianId: ids.clinicianB, clinicianNotes: 'private note by B' },
            [`clients/${ids.unlinked}/brainMaps/by-b`]: { id: 'by-b', createdBy: ids.clinicianB, schemaVersion: 1 },
            [`clients/${ids.unlinked}`]: { id: ids.unlinked, name: 'U', clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'X' },
        });
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(getDoc(doc(clinicianA, 'sessions/old-under-b')));
        await assertSucceeds(getDoc(doc(clinicianA, `clients/${ids.unlinked}/brainMaps/by-b`)));
    });

    it('POLICY: after unlinking, the former clinician loses access to sessions and QEEG they recorded', async () => {
        const clinicianA = await as(ids.clinicianA);
        await assertSucceeds(updateDoc(doc(clinicianA, `clients/${ids.patientA}`), {
            clinicianId: null, clinicId: null, linkedClinicianCode: null, acceptedInvitationId: null,
        }));
        await assertFails(getDoc(doc(clinicianA, 'sessions/session-a')));
        await assertFails(getDoc(doc(clinicianA, `clients/${ids.patientA}/brainMaps/bm-a`)));
    });

    // POLICY inconsistency. Clinic colleagues read the patient profile and sessions
    // but not canonical QEEG records.
    it('POLICY: clinic colleagues can read sessions but not brainMaps of a clinic patient', async () => {
        const colleague = await as(ids.colleagueA);
        await assertSucceeds(getDoc(doc(colleague, 'sessions/session-a')));
        await assertFails(getDoc(doc(colleague, `clients/${ids.patientA}/brainMaps/bm-a`)));
    });
});

describe('REVIEW: invitation lifecycle edges', () => {
    // Fixed after review: invitations without a timestamp expiresAt (the shape main's
    // rules allowed) can no longer be accepted; the clinician can still cancel them.
    it('a legacy invitation with no expiry, clinic, or claim is no longer acceptable', async () => {
        await seedDocuments({
            'patientInvitations/LEGA-CYXX-XXXX': {
                id: 'LEGA-CYXX-XXXX', clinicianId: ids.clinicianA, patientEmail: emailOf(ids.unlinked), patientName: 'U', status: 'pending',
            },
        });
        const invited = await as(ids.unlinked);
        const batch = writeBatch(invited);
        batch.update(doc(invited, 'patientInvitations/LEGA-CYXX-XXXX'), { status: 'accepted', patientId: ids.unlinked, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        batch.set(doc(invited, `clients/${ids.unlinked}`), { clinicianId: ids.clinicianA, acceptedInvitationId: 'LEGA-CYXX-XXXX' }, { merge: true });
        await assertFails(batch.commit());
    });

    // LOW (UX). After an expired claim is replaced by a new invitation, the old expired
    // invitation can never be cancelled because its claim path is now held by the new one.
    it('LOW: the superseded expired invitation is stuck in "pending" (cannot be cancelled)', async () => {
        const email = emailOf(ids.unlinked);
        const claimPath = `patientInvitationClaims/${ids.clinicianA}/emails/${email}`;
        const expired = Timestamp.fromMillis(Date.now() - 60_000);
        const base = { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, patientName: 'U', status: 'pending', uniquenessClaimId: email, createdAt: past, updatedAt: past };
        await seedDocuments({
            'patientInvitations/OLDX-OLDX-OLDX': { ...base, id: 'OLDX-OLDX-OLDX', expiresAt: expired },
            [claimPath]: { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'OLDX-OLDX-OLDX', status: 'pending', expiresAt: expired },
        });
        const clinicianA = await as(ids.clinicianA);
        const expiresAt = future();
        const replace = writeBatch(clinicianA);
        replace.set(doc(clinicianA, 'patientInvitations/NEWX-NEWX-NEWX'), { ...base, id: 'NEWX-NEWX-NEWX', expiresAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        replace.set(doc(clinicianA, claimPath), { clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: email, invitationId: 'NEWX-NEWX-NEWX', status: 'pending', expiresAt });
        await assertSucceeds(replace.commit());
        await assertFails(updateDoc(doc(clinicianA, 'patientInvitations/OLDX-OLDX-OLDX'), { status: 'cancelled', updatedAt: serverTimestamp() }));
    });
});

describe('REVIEW: residual documents written under main’s permissive rules', () => {
    // MIGRATION RISK. Under main, any signed-in user could create appointments naming any
    // clientId. The branch treats such a row (once backfilled with patientId: null) as a
    // trusted legacy appointment and shows it to the named patient.
    it('MIGRATION: a legacy appointment written by an unrelated clinician is visible to the named patient', async () => {
        await seedDocuments({
            'appointments/forged-under-main': { clientId: ids.patientA, patientId: null, clinicianId: ids.clinicianB, title: 'Call this number to reschedule' },
        });
        await assertSucceeds(getDocs(query(collection(await as(ids.patientA), 'appointments'),
            where('clientId', '==', ids.patientA), where('patientId', '==', null))));
        await assertSucceeds(getDoc(doc(await as(ids.patientA), 'appointments/forged-under-main')));
    });
});
