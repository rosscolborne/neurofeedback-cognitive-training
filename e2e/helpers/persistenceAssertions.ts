import { expect, type Page } from '@playwright/test';
import type { AuthorizedDocument, AuthorizedRead } from './authorizedFirestore';

/** A run of the local persistence spec: records it seeded carry its marker. */
export type PersistenceRun = {
    runMarker: string;
    runStartMs: number;
    clinicId: string;
    scope: { patientId: string; clinicianId: string };
};

/** Markers are long random tokens; short strings could match ordinary text. */
function containsRunMarker(value: unknown, runMarker: string): boolean {
    return runMarker.length >= 16 && typeof value === 'string' && value.includes(runMarker);
}

/** Persistence reads use the signed-in page's Firebase ID token and Firestore rules. */
const persistenceTimeout = { timeout: 15_000 };

async function readAs(page: Page, uid: string, read: AuthorizedRead, projectId = process.env.E2E_FIREBASE_PROJECT_ID): Promise<AuthorizedDocument | AuthorizedDocument[] | null> {
    return page.evaluate(async ({ uid, read, projectId }) => {
        const { authorizedFirestoreRead } = await import('/e2e/helpers/authorizedFirestore.ts');
        return authorizedFirestoreRead(uid, read, projectId);
    }, { uid, read, projectId });
}

async function documentAs(page: Page, uid: string, path: string, projectId?: string): Promise<AuthorizedDocument | null> {
    return readAs(page, uid, { kind: 'document', path }, projectId) as Promise<AuthorizedDocument | null>;
}

async function collectionAs(page: Page, uid: string, path: string, where?: { field: string; equals: string }): Promise<AuthorizedDocument[]> {
    return readAs(page, uid, { kind: 'collection', path, where }) as Promise<AuthorizedDocument[]>;
}

function field(document: AuthorizedDocument | null, name: string): unknown {
    return name.split('.').reduce<unknown>((value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, document?.fields);
}

async function runDocuments(
    page: Page,
    run: PersistenceRun,
    collection: 'sessions' | 'appointments',
    markerField: string,
): Promise<AuthorizedDocument[]> {
    const documents = await collectionAs(page, run.scope.patientId, collection, {
        field: 'patientId', equals: run.scope.patientId,
    });
    return documents.filter((document) =>
        document.createTimeMs >= run.runStartMs && containsRunMarker(field(document, markerField), run.runMarker));
}

/** The Demo session and completion ledger are readable by the owning patient. */
export async function expectDemoSessionPersisted(run: PersistenceRun, patientPage: Page): Promise<string> {
    let sessionId = '';
    await expect.poll(async () => {
        const sessions = await runDocuments(patientPage, run, 'sessions', 'patientNotes');
        sessionId = sessions.length === 1 ? sessions[0].id : '';
        return sessions.map((document) => ({
            isDemo: field(document, 'isDemo'),
            patientId: field(document, 'patientId'),
        }));
    }, persistenceTimeout).toEqual([{ isDemo: true, patientId: run.scope.patientId }]);

    await expect.poll(async () => {
        const patient = await documentAs(patientPage, run.scope.patientId, `clients/${run.scope.patientId}`);
        const ledger = field(patient, 'recentCompletedSessionIds');
        return Array.isArray(ledger) && ledger.includes(sessionId);
    }, persistenceTimeout).toBe(true);
    return sessionId;
}

export async function expectAppointmentPersisted(
    run: PersistenceRun,
    patientPage: Page,
    expected: { notes: string; status: 'scheduled' | 'cancelled'; durationMinutes: number; type: string },
): Promise<void> {
    await expect.poll(async () => {
        const documents = await runDocuments(patientPage, run, 'appointments', 'notes');
        return documents.map((document) => ({
            notes: field(document, 'notes'),
            status: field(document, 'status'),
            durationMinutes: field(document, 'durationMinutes'),
            type: field(document, 'type'),
            clinicianId: field(document, 'clinicianId'),
            createdBy: field(document, 'createdBy'),
        }));
    }, persistenceTimeout).toEqual([{ ...expected, clinicianId: run.scope.clinicianId, createdBy: run.scope.clinicianId }]);
}

export async function expectMessagesPersisted(
    run: PersistenceRun,
    patientPage: Page,
    expected: { text: string; senderRole: 'patient' | 'clinician' }[],
): Promise<void> {
    const path = `messageThreads/${run.scope.patientId}/relationships/${run.scope.clinicianId}/messages`;
    const expectedRecords = expected.map((message) => ({
        ...message,
        senderId: message.senderRole === 'patient' ? run.scope.patientId : run.scope.clinicianId,
    })).sort((left, right) => left.text.localeCompare(right.text));
    await expect.poll(async () => {
        const documents = await collectionAs(patientPage, run.scope.patientId, path);
        return documents
            .filter((document) => document.createTimeMs >= run.runStartMs && containsRunMarker(field(document, 'text'), run.runMarker))
            .map((document) => ({
                text: field(document, 'text'),
                senderRole: field(document, 'senderRole'),
                senderId: field(document, 'senderId'),
            }))
            .sort((left, right) => String(left.text).localeCompare(String(right.text)));
    }, persistenceTimeout).toEqual(expectedRecords);
}

/** The patient can read their accepted invitation and the relationship on their profile. */
export async function expectInvitationAcceptedPersisted(run: PersistenceRun, patientPage: Page, invitationCode: string): Promise<void> {
    await expect.poll(async () => {
        const [invitation, patient] = await Promise.all([
            documentAs(patientPage, run.scope.patientId, `patientInvitations/${invitationCode}`),
            documentAs(patientPage, run.scope.patientId, `clients/${run.scope.patientId}`),
        ]);
        return {
            invitationMarked: containsRunMarker(field(invitation, 'patientName'), run.runMarker),
            invitationStatus: field(invitation, 'status'),
            invitationPatientId: field(invitation, 'patientId'),
            patientClinicianId: field(patient, 'clinicianId'),
            patientAcceptedInvitationId: field(patient, 'acceptedInvitationId'),
        };
    }, persistenceTimeout).toEqual({
        invitationMarked: true,
        invitationStatus: 'accepted',
        invitationPatientId: run.scope.patientId,
        patientClinicianId: run.scope.clinicianId,
        patientAcceptedInvitationId: invitationCode,
    });
}

export async function expectClinicBrandPersisted(run: PersistenceRun, patientPage: Page, brandName: string): Promise<void> {
    await expect.poll(async () => {
        const clinic = await documentAs(patientPage, run.scope.patientId, `clinics/${run.clinicId}`);
        return field(clinic, 'branding.name');
    }, persistenceTimeout).toBe(brandName);
}

/** An account reads its own user profile through its own rules grant. */
export async function expectRolePersisted(account: { uid: string; email: string }, role: 'patient', accountPage: Page): Promise<void> {
    await expect.poll(async () => {
        const user = await documentAs(accountPage, account.uid, `users/${account.uid}`);
        return { email: String(field(user, 'email') ?? '').toLowerCase(), role: field(user, 'role') };
    }, persistenceTimeout).toEqual({ email: account.email.toLowerCase(), role });
}

/** Used by the local messaging scenario to inspect saved data as the patient, without Admin. */
export async function readPersistedMessagesAs(patientPage: Page, patientId: string, clinicianId: string) {
    const thread = `messageThreads/${patientId}/relationships/${clinicianId}`;
    const [summary, messages, patientRead] = await Promise.all([
        documentAs(patientPage, patientId, thread),
        collectionAs(patientPage, patientId, `${thread}/messages`),
        documentAs(patientPage, patientId, `${thread}/reads/${patientId}`),
    ]);
    return {
        summary: summary?.fields,
        messages: messages.map((message) => message.fields),
        patientRead: patientRead?.fields,
    };
}
