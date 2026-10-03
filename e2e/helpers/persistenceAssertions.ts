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

/** A player reads their own consumer profile (users/{uid}) through their own rules grant. */
export async function expectProfileReadable(account: { uid: string }, displayName: string, accountPage: Page): Promise<void> {
    await expect.poll(async () => {
        const profile = await documentAs(accountPage, account.uid, `users/${account.uid}`);
        return { schemaVersion: field(profile, 'schemaVersion'), displayName: field(profile, 'displayName') };
    }, persistenceTimeout).toEqual({ schemaVersion: 1, displayName });
}
