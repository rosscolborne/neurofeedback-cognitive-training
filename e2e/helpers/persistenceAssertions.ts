import { expect, type Page } from '@playwright/test';
import type { AuthorizedDocument, AuthorizedRead } from './authorizedFirestore';

/** A run of the local persistence spec: records it seeded carry its marker. */
export type PersistenceRun = {
    runMarker: string;
    runStartMs: number;
    scope: { patientId: string };
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
    collection: 'sessions',
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

/** An account reads its own user profile through its own rules grant. */
export async function expectRolePersisted(account: { uid: string; email: string }, role: 'patient', accountPage: Page): Promise<void> {
    await expect.poll(async () => {
        const user = await documentAs(accountPage, account.uid, `users/${account.uid}`);
        return { email: String(field(user, 'email') ?? '').toLowerCase(), role: field(user, 'role') };
    }, persistenceTimeout).toEqual({ email: account.email.toLowerCase(), role });
}
