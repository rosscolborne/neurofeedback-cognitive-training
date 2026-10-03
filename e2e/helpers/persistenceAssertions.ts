import { expect, type Page } from '@playwright/test';
import type { AuthorizedDocument, AuthorizedRead } from './authorizedFirestore';

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

function field(document: AuthorizedDocument | null, name: string): unknown {
    return name.split('.').reduce<unknown>((value, part) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, document?.fields);
}

/** An account reads its own user profile through its own rules grant. */
export async function expectRolePersisted(account: { uid: string }, role: 'patient', accountPage: Page): Promise<void> {
    await expect.poll(async () => {
        const user = await documentAs(accountPage, account.uid, `users/${account.uid}`);
        return field(user, 'role');
    }, persistenceTimeout).toBe(role);
}

/** A patient reads their own clients/{uid} profile through its own rules grant. */
export async function expectProfileReadable(account: { uid: string }, accountPage: Page): Promise<void> {
    await expect.poll(async () => {
        const profile = await documentAs(accountPage, account.uid, `clients/${account.uid}`);
        return field(profile, 'id');
    }, persistenceTimeout).toBe(account.uid);
}
