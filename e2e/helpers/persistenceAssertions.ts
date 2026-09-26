import { expect } from '@playwright/test';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { containsRunMarker } from './cleanupPlan';
import { adminFirestoreForRun, type DisposableE2EAccount, type DisposableE2ERun, type E2EPairRun } from './dataLifecycle';

/**
 * Admin-side reads that confirm what the UI claims was saved actually reached
 * Firestore. They only read; every match is restricted to the run's marker and
 * to documents created after the run started.
 */

const persistenceTimeout = { timeout: 15_000 };

function createdDuringRun(run: E2EPairRun, document: QueryDocumentSnapshot<DocumentData>): boolean {
    return document.createTime.toMillis() >= run.runStartMs;
}

async function runDocuments(run: E2EPairRun, collection: 'sessions' | 'appointments', markerField: string) {
    const database = await adminFirestoreForRun(run);
    const snapshot = await database.collection(collection).where('patientId', '==', run.scope.patientId).get();
    return snapshot.docs.filter((document) =>
        createdDuringRun(run, document) && containsRunMarker(document.get(markerField), run.runMarker));
}

/** The Demo session saved through the UI exists once, is labelled synthetic, and carries the run note. */
export async function expectDemoSessionPersisted(run: E2EPairRun): Promise<string> {
    let sessionId = '';
    await expect.poll(async () => {
        const sessions = await runDocuments(run, 'sessions', 'patientNotes');
        sessionId = sessions.length === 1 ? sessions[0].id : '';
        return sessions.map((document) => ({
            isDemo: document.get('isDemo'),
            patientId: document.get('patientId'),
        }));
    }, persistenceTimeout).toEqual([{ isDemo: true, patientId: run.scope.patientId }]);

    const database = await adminFirestoreForRun(run);
    const patient = await database.doc(`clients/${run.scope.patientId}`).get();
    const ledger = patient.get('recentCompletedSessionIds');
    expect(Array.isArray(ledger) && ledger.includes(sessionId), 'patient completion ledger records the Demo session').toBe(true);
    return sessionId;
}

export async function expectAppointmentPersisted(
    run: E2EPairRun,
    expected: { notes: string; status: 'scheduled' | 'cancelled'; durationMinutes: number; type: string },
): Promise<void> {
    await expect.poll(async () => {
        const appointments = await runDocuments(run, 'appointments', 'notes');
        return appointments.map((document) => ({
            notes: document.get('notes'),
            status: document.get('status'),
            durationMinutes: document.get('durationMinutes'),
            type: document.get('type'),
            clinicianId: document.get('clinicianId'),
            createdBy: document.get('createdBy'),
        }));
    }, persistenceTimeout).toEqual([{
        ...expected,
        clinicianId: run.scope.clinicianId,
        createdBy: run.scope.clinicianId,
    }]);
}

export async function expectMessagesPersisted(
    run: E2EPairRun,
    expected: { text: string; senderRole: 'patient' | 'clinician' }[],
): Promise<void> {
    const database = await adminFirestoreForRun(run);
    const messages = database
        .doc(`messageThreads/${run.scope.patientId}/relationships/${run.scope.clinicianId}`)
        .collection('messages');
    await expect.poll(async () => {
        const snapshot = await messages.get();
        return snapshot.docs
            .filter((document) => createdDuringRun(run, document) && containsRunMarker(document.get('text'), run.runMarker))
            .map((document) => ({
                text: document.get('text'),
                senderRole: document.get('senderRole'),
                senderId: document.get('senderId'),
            }))
            .sort((left, right) => left.text.localeCompare(right.text));
    }, persistenceTimeout).toEqual(expected
        .map((message) => ({
            ...message,
            senderId: message.senderRole === 'patient' ? run.scope.patientId : run.scope.clinicianId,
        }))
        .sort((left, right) => left.text.localeCompare(right.text)));
}

/** The run's invitation was accepted by the approved patient, who is now canonically linked. */
export async function expectInvitationAcceptedPersisted(run: E2EPairRun, invitationCode: string): Promise<void> {
    const database = await adminFirestoreForRun(run);
    await expect.poll(async () => {
        const [invitation, patient, claim] = await Promise.all([
            database.doc(`patientInvitations/${invitationCode}`).get(),
            database.doc(`clients/${run.scope.patientId}`).get(),
            database.doc(`patientInvitationClaims/${run.scope.clinicianId}/emails/${run.scope.patientEmail}`).get(),
        ]);
        return {
            invitationMarked: containsRunMarker(invitation.get('patientName'), run.runMarker),
            invitationStatus: invitation.get('status'),
            invitationPatientId: invitation.get('patientId'),
            patientClinicianId: patient.get('clinicianId'),
            patientAcceptedInvitationId: patient.get('acceptedInvitationId'),
            claimExists: claim.exists,
        };
    }, persistenceTimeout).toEqual({
        invitationMarked: true,
        invitationStatus: 'accepted',
        invitationPatientId: run.scope.patientId,
        patientClinicianId: run.scope.clinicianId,
        patientAcceptedInvitationId: invitationCode,
        claimExists: false,
    });
}

export async function expectClinicBrandPersisted(run: E2EPairRun, brandName: string): Promise<void> {
    const database = await adminFirestoreForRun(run);
    await expect.poll(async () => {
        const clinic = await database.doc(`clinics/${run.clinicId}`).get();
        return clinic.get('branding.name');
    }, persistenceTimeout).toBe(brandName);
}

/** A disposable signup persisted its own user profile with the chosen role. */
export async function expectDisposableRolePersisted(
    run: DisposableE2ERun,
    account: DisposableE2EAccount,
    role: 'patient' | 'clinician',
): Promise<void> {
    const database = await adminFirestoreForRun(run);
    await expect.poll(async () => {
        const user = await database.doc(`users/${account.uid}`).get();
        return { email: user.get('email')?.toLowerCase(), role: user.get('role') };
    }, persistenceTimeout).toEqual({ email: account.email.toLowerCase(), role });
}
