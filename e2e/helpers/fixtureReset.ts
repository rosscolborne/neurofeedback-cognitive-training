import { randomUUID } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { assertFixtureDocument, assertFixtureReference, FIXTURE_MARKER, fixtureIdentities, type FixtureRole } from './fixtureModel';

const resetLockPath = 'e2eHarnessLocks/fixture-reset';
const otherLocks = ['e2eHarnessLocks/mock-data-removal', 'e2eHarnessLocks/account-isolation'];
const roles = ['patient', 'clinician', 'outsider'] as const;
type Passwords = Record<FixtureRole, string>;

export async function inspectResetLock(database: Firestore): Promise<{ runId: string; ageMinutes: number } | null> {
    const lock = await database.doc(resetLockPath).get();
    if (!lock.exists) return null;
    const started = lock.get('startedAt');
    return {
        runId: String(lock.get('runId')),
        ageMinutes: started instanceof Timestamp ? Math.floor((Date.now() - started.toMillis()) / 60_000) : -1,
    };
}

/** Operator-only recovery after confirming that the original reset process died. */
export async function releaseStaleResetLock(database: Firestore, reviewedRunId: string): Promise<void> {
    await database.runTransaction(async (transaction) => {
        const references = [resetLockPath, ...otherLocks].map((path) => database.doc(path));
        const [reset, ...runs] = await transaction.getAll(...references);
        if (!reset.exists || reset.get('runId') !== reviewedRunId) throw new Error('Fixture reset lock changed after inspection.');
        if (runs.some((run) => run.exists)) throw new Error('A stateful run/cleanup lease is held; reset lock cannot be released.');
        const started = reset.get('startedAt');
        if (!(started instanceof Timestamp) || Date.now() - started.toMillis() < 10 * 60_000) {
            throw new Error('Fixture reset lock is younger than ten minutes; wait and confirm the process has stopped.');
        }
        transaction.delete(references[0]);
    });
}

async function acquireResetLock(database: Firestore, runId: string): Promise<void> {
    await database.runTransaction(async (transaction) => {
        const references = [resetLockPath, ...otherLocks].map((path) => database.doc(path));
        const [reset, ...runs] = await transaction.getAll(...references);
        if (runs.some((run) => run.exists)) throw new Error('A stateful E2E run or cleanup lease is held. Finish/recover it before fixture reset.');
        if (reset.exists) throw new Error('A fixture reset lock is held. Inspect/release a crashed lock before retrying.');
        transaction.create(references[0], { runId, startedAt: FieldValue.serverTimestamp() });
    });
}

async function releaseResetLock(database: Firestore, runId: string): Promise<void> {
    const reference = database.doc(resetLockPath);
    await database.runTransaction(async (transaction) => {
        const current = await transaction.get(reference);
        if (current.exists && current.get('runId') === runId) transaction.delete(reference);
    });
}

async function verifyAuthOwnership(authentication: Auth): Promise<void> {
    for (const role of roles) {
        const identity = fixtureIdentities[role];
        try {
            const byId = await authentication.getUser(identity.uid);
            if (byId.email?.toLowerCase() !== identity.email) throw new Error(`Fixture UID ${identity.uid} has an unexpected email.`);
        } catch (error) {
            if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
        }
        try {
            const byEmail = await authentication.getUserByEmail(identity.email);
            if (byEmail.uid !== identity.uid) throw new Error(`Fixture email ${identity.email} belongs to another UID.`);
        } catch (error) {
            if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
        }
    }
}

async function resetDocumentPaths(database: Firestore): Promise<DocumentReference[]> {
    const { patient, clinician, outsider } = fixtureIdentities;
    const roots = [
        ...roles.map((role) => `users/${fixtureIdentities[role].uid}`),
        `clients/${patient.uid}`, `clients/${outsider.uid}`,
        `practitioners/${clinician.uid}`, `clinics/${clinician.uid}`,
        `deviceAssignments/${patient.uid}`, `deviceAssignments/${outsider.uid}`,
        `messageThreads/${patient.uid}`, `messageThreads/${outsider.uid}`,
        `messages/${patient.uid}`, `messages/${outsider.uid}`,
        `patientInvitationClaims/${clinician.uid}`,
    ];
    const fixed = await database.getAll(...roots.map((path) => database.doc(path)));
    for (const document of fixed) {
        if (document.exists) assertFixtureReference(document.ref.path, document.data()!);
        if (document.exists && /^(users|clients|practitioners|clinics)\//.test(document.ref.path)) {
            assertFixtureDocument(document.ref.path, document.data());
        }
        if (document.exists && document.ref.path.startsWith('users/')) {
            const identity = roles.map((role) => fixtureIdentities[role]).find((entry) => document.id === entry.uid);
            if (document.get('email')?.toLowerCase() !== identity?.email) throw new Error(`Refusing to reset ${document.ref.path}: email differs from the pinned fixture.`);
        }
        if (document.exists && document.ref.path.startsWith('clients/')) {
            const identity = [patient, outsider].find((entry) => document.id === entry.uid);
            if (document.get('email')?.toLowerCase() !== identity?.email) throw new Error(`Refusing to reset ${document.ref.path}: email differs from the pinned fixture.`);
        }
        if (document.exists && document.ref.path === `practitioners/${clinician.uid}` && document.get('userId') !== clinician.uid) {
            throw new Error('Refusing to reset the clinician practitioner record: userId differs.');
        }
        if (document.exists && document.ref.path === `clinics/${clinician.uid}` &&
            (!Array.isArray(document.get('practitionerIds')) || document.get('practitionerIds').length !== 1 || document.get('practitionerIds')[0] !== clinician.uid)) {
            throw new Error('Refusing to reset the E2E clinic: it has another practitioner.');
        }
        const allowedChildren = document.ref.path.startsWith('clients/') ? ['brainMaps']
            : document.ref.path.startsWith('messageThreads/') ? ['relationships']
                : document.ref.path.startsWith('patientInvitationClaims/') ? ['emails'] : [];
        for (const collection of await document.ref.listCollections()) {
            if (!allowedChildren.includes(collection.id)) throw new Error(`Refusing to reset unexpected nested collection ${collection.path}.`);
        }
    }

    for (const identity of [patient, outsider]) {
        const brainMaps = await database.collection(`clients/${identity.uid}/brainMaps`).get();
        for (const brainMap of brainMaps.docs) assertFixtureReference(brainMap.ref.path, brainMap.data());
        const relationships = await database.collection(`messageThreads/${identity.uid}/relationships`).listDocuments();
        for (const reference of relationships) {
            if (reference.id !== clinician.uid) throw new Error(`Refusing to reset ${reference.path}: another clinician has a thread.`);
            const relationship = await reference.get();
            if (relationship.exists) assertFixtureReference(reference.path, relationship.data()!);
            for (const collection of await reference.listCollections()) {
                if (collection.id !== 'messages') throw new Error(`Refusing to reset unexpected nested collection ${collection.path}.`);
            }
            const messages = await reference.collection('messages').get();
            for (const message of messages.docs) {
                assertFixtureReference(message.ref.path, message.data());
                if (![identity.uid, clinician.uid].includes(message.get('senderId'))) {
                    throw new Error(`Refusing to reset ${message.ref.path}: sender is not in the fixture pair.`);
                }
            }
        }
    }

    const paths = new Set(roots);
    const queries = [
        database.collection('sessions').where('patientId', 'in', [patient.uid, outsider.uid]),
        database.collection('sessions').where('clientId', 'in', [patient.uid, outsider.uid]),
        database.collection('sessions').where('clinicianId', '==', clinician.uid),
        database.collection('sessions').where('clinicId', '==', clinician.uid),
        database.collection('appointments').where('patientId', 'in', [patient.uid, outsider.uid]),
        database.collection('appointments').where('clientId', 'in', [patient.uid, outsider.uid]),
        database.collection('appointments').where('clinicianId', '==', clinician.uid),
        database.collection('appointments').where('clinicId', '==', clinician.uid),
        database.collection('patientInvitations').where('clinicianId', '==', clinician.uid),
        database.collection('patientInvitations').where('patientEmail', 'in', [patient.email, outsider.email]),
        database.collection('patientInvitations').where('patientId', 'in', [patient.uid, outsider.uid]),
        database.collection('patientInvitations').where('clinicId', '==', clinician.uid),
        database.collection('clients').where('clinicianId', '==', clinician.uid),
        database.collection('clients').where('linkedClinicianCode', '==', clinician.uid),
        database.collection('clients').where('clinicId', '==', clinician.uid),
        database.collection('practitioners').where('clinicId', '==', clinician.uid),
        database.collection('clinics').where('practitionerIds', 'array-contains', clinician.uid),
        database.collection('messages').where('clinicianId', '==', clinician.uid),
        database.collection('messages').where('clientId', 'in', [patient.uid, outsider.uid]),
        database.collection('messages').where('patientId', 'in', [patient.uid, outsider.uid]),
        database.collection('deviceAssignments').where('assignedByUserId', '==', clinician.uid),
        database.collection('protocolCatalog').where('clinicId', '==', clinician.uid),
    ];
    const allowedProfilePaths = new Set([`clients/${patient.uid}`, `clients/${outsider.uid}`]);
    for (const query of queries) {
        const result = await query.get();
        for (const document of result.docs) {
            const path = document.ref.path;
            const data = document.data();
            assertFixtureReference(path, data);
            if ((path.startsWith('sessions/') || path.startsWith('appointments/')) && !data.patientId && !data.clientId) {
                throw new Error(`Refusing to reset ${path}: patient ownership is missing.`);
            }
            if (path.startsWith('patientInvitations/') && !data.patientEmail && !data.patientId) {
                throw new Error(`Refusing to reset ${path}: patient ownership is missing.`);
            }
            if (path.startsWith('deviceAssignments/') && ![`deviceAssignments/${patient.uid}`, `deviceAssignments/${outsider.uid}`].includes(path)) {
                throw new Error(`Refusing to reset ${path}: assignment belongs to an unrelated account.`);
            }
            if (path.startsWith('clients/') && !allowedProfilePaths.has(path)) {
                throw new Error(`Refusing to reset ${path}: unrelated client uses the E2E clinician or clinic.`);
            }
            if (path.startsWith('practitioners/') && path !== `practitioners/${clinician.uid}`) {
                throw new Error(`Refusing to reset ${path}: unrelated practitioner uses the E2E clinic.`);
            }
            if (path.startsWith('clinics/') && path !== `clinics/${clinician.uid}`) {
                throw new Error(`Refusing to reset ${path}: E2E clinician belongs to another clinic.`);
            }
            paths.add(path);
        }
    }
    // Unfiltered collection-group reads need no extra index. Inspect only
    // relationships claiming the fixed clinician; never mutate another pair.
    const allRelationships = await database.collectionGroup('relationships').get();
    for (const document of allRelationships.docs) {
        if (document.id !== clinician.uid && document.get('clinicianId') !== clinician.uid) continue;
        if (!document.ref.path.startsWith(`messageThreads/${patient.uid}/`) &&
            !document.ref.path.startsWith(`messageThreads/${outsider.uid}/`)) {
            throw new Error(`Refusing to reset ${document.ref.path}: an unrelated patient has an E2E clinician thread.`);
        }
        assertFixtureReference(document.ref.path, document.data());
        paths.add(document.ref.path);
    }
    const claims = await database.collection(`patientInvitationClaims/${clinician.uid}/emails`).get();
    for (const claim of claims.docs) {
        if (!(new Set<string>([patient.email, outsider.email])).has(claim.id)) {
            throw new Error(`Refusing to reset ${claim.ref.path}: claim belongs to an unrelated email.`);
        }
        const data = claim.data();
        assertFixtureReference(claim.ref.path, data);
        if (data.clinicianId !== clinician.uid || data.clinicId !== clinician.uid || data.patientEmail !== claim.id ||
            typeof data.invitationId !== 'string' || !data.invitationId) {
            throw new Error(`Refusing to reset ${claim.ref.path}: claim ownership is incomplete or mismatched.`);
        }
        const invitation = await database.doc(`patientInvitations/${data.invitationId}`).get();
        if (invitation.exists) {
            assertFixtureReference(invitation.ref.path, invitation.data()!);
            if (invitation.get('clinicianId') !== clinician.uid || invitation.get('clinicId') !== clinician.uid ||
                invitation.get('patientEmail') !== claim.id) {
                throw new Error(`Refusing to reset ${claim.ref.path}: linked invitation belongs to another account.`);
            }
            paths.add(invitation.ref.path);
        }
    }
    // Parent roots recursively include messages and brain maps. Never also delete a child.
    return [...paths].filter((path) => ![...paths].some((parent) => path !== parent && path.startsWith(`${parent}/`)))
        .map((path) => database.doc(path));
}

/** Reset only the fixed E2E namespace; rerunning after a partial failure is safe. */
export async function resetE2EFixtures(authentication: Auth, database: Firestore, passwords: Passwords): Promise<void> {
    const runId = randomUUID();
    await acquireResetLock(database, runId);
    try {
        await verifyAuthOwnership(authentication);
        const paths = await resetDocumentPaths(database);
        const registry = await database.collection('e2eHarnessDisposableAccounts').limit(1).get();
        if (!registry.empty) throw new Error('Disposable E2E account registry is not empty. Recover that run before resetting fixtures.');
        // Confirm Auth create/update capability before deleting any Firestore
        // fixture data. A later Firestore failure is recoverable by rerun.
        for (const role of roles) {
            const identity = fixtureIdentities[role];
            try {
                await authentication.updateUser(identity.uid, {
                    password: passwords[role], displayName: identity.name, emailVerified: true, disabled: false,
                });
            } catch (error) {
                if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
                await authentication.createUser({
                    uid: identity.uid, email: identity.email, password: passwords[role],
                    displayName: identity.name, emailVerified: true,
                });
            }
        }
        for (const reference of paths) await database.recursiveDelete(reference);

        const { patient, clinician, outsider } = fixtureIdentities;
        const batch = database.batch();
        for (const role of roles) {
            const identity = fixtureIdentities[role];
            batch.set(database.doc(`users/${identity.uid}`), {
                role: role === 'clinician' ? 'clinician' : 'patient', email: identity.email, e2eFixture: FIXTURE_MARKER,
            });
        }
        batch.set(database.doc(`clinics/${clinician.uid}`), {
            id: clinician.uid, name: 'E2E Clinic', timezone: 'America/Toronto',
            practitionerIds: [clinician.uid], e2eFixture: FIXTURE_MARKER,
        });
        batch.set(database.doc(`practitioners/${clinician.uid}`), {
            id: clinician.uid, userId: clinician.uid, clinicId: clinician.uid,
            displayName: clinician.name, credentials: [], e2eFixture: FIXTURE_MARKER,
        });
        for (const identity of [patient, outsider]) {
            batch.set(database.doc(`clients/${identity.uid}`), {
                id: identity.uid, name: identity.name, email: identity.email, status: 'active',
                brainMaps: [], badges: [], allowedExperiences: ['skyline-drift'],
                completedSessionsCount: 0, currentStreak: 0, isDemo: false,
                ...(identity.uid === patient.uid ? {
                    clinicianId: clinician.uid, clinicId: clinician.uid, condition: 'ADHD (Inattentive)',
                    assignedProtocol: 'theta-beta-ratio', prescribedSessionsPerWeek: 3,
                } : {}),
                e2eFixture: FIXTURE_MARKER,
            });
        }
        await batch.commit();
    } finally {
        await releaseResetLock(database, runId);
    }
}
