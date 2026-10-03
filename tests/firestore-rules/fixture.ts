import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    initializeTestEnvironment,
    type RulesTestContext,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

/**
 * The shared emulator environment for the Firestore rules tests: signed-in
 * and anonymous contexts, and trusted seeding with rules disabled. Everything
 * runs against the local emulator under a demo project ID; nothing can reach
 * a real project. Each suite seeds its own world (consumer/consumerFixture.ts).
 */
export const projectId = 'demo-neurasticity-rules';

export function emailOf(uid: string): string {
    return `${uid}@example.test`;
}

export const past = Timestamp.fromMillis(Date.UTC(2026, 0, 15, 12));

let testEnvironment: RulesTestEnvironment | undefined;

export async function environment(): Promise<RulesTestEnvironment> {
    testEnvironment ??= await initializeTestEnvironment({
        projectId,
        firestore: { rules: readFileSync(resolve(process.env.RULES_FILE ?? 'firestore.rules'), 'utf8') },
    });
    return testEnvironment;
}

export async function closeEnvironment(): Promise<void> {
    await testEnvironment?.cleanup();
    testEnvironment = undefined;
}

/** A signed-in user whose ID token carries their email, like Firebase email/password sign-in. */
export async function as(uid: string, token: Record<string, unknown> = {}): Promise<Firestore> {
    const context: RulesTestContext = (await environment()).authenticatedContext(uid, { email: emailOf(uid), ...token });
    return context.firestore() as unknown as Firestore;
}

export async function anonymous(): Promise<Firestore> {
    return (await environment()).unauthenticatedContext().firestore() as unknown as Firestore;
}

/** Writes documents with rules disabled, like trusted setup. */
export async function seedDocuments(documents: Record<string, Record<string, unknown>>): Promise<void> {
    await (await environment()).withSecurityRulesDisabled(async (context) => {
        const database = context.firestore() as unknown as Firestore;
        for (const [path, data] of Object.entries(documents)) await setDoc(doc(database, path), data);
    });
}
