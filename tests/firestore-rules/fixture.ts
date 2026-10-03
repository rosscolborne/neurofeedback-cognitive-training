import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    initializeTestEnvironment,
    type RulesTestContext,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

/**
 * Seeded world for Firestore rules tests. Everything runs against the local
 * emulator under a demo project ID; nothing can reach a real project.
 *
 * The clinician product is retired. The clinicians, clinics, relationship
 * fields and clinical records below are residual data from it, kept so tests
 * can prove that leftovers grant nothing to their former participants.
 *
 *   clinic A: clinician-a (patient-a's canonical clinician) + colleague clinician-a2
 *   clinic B: clinician-b (patient-b's canonical clinician)
 *   clinic X: clinician-x (no patients)
 *   patient-u: unlinked patient; user-r: signed in, no role
 *   patient-legacy: linked to clinician-a only through linkedClinicianCode
 *   patient-split: clinicianId clinician-b but stale linkedClinicianCode clinician-a
 */
export const projectId = 'demo-neurasticity-rules';

export const ids = {
    patientA: 'patient-a',
    patientB: 'patient-b',
    unlinked: 'patient-u',
    legacyPatient: 'patient-legacy',
    splitPatient: 'patient-split',
    clinicianA: 'clinician-a',
    colleagueA: 'clinician-a2',
    clinicianB: 'clinician-b',
    clinicianX: 'clinician-x',
    newClinician: 'clinician-new',
    roleless: 'user-r',
} as const;

export const clinicA = ids.clinicianA;
export const clinicB = ids.clinicianB;
export const clinicX = ids.clinicianX;

export function emailOf(uid: string): string {
    return `${uid}@example.test`;
}

export const past = Timestamp.fromMillis(Date.UTC(2026, 0, 15, 12));
export const future = () => Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

export const seededAppointmentId = 'appt_aaaaaaaaaaaaaaaaaaaaaaaa';
export const seededMessageId = 'msg-seeded-1';

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

function patient(uid: string, extra: Record<string, unknown> = {}) {
    return { id: uid, email: emailOf(uid), name: `Name ${uid}`, assignedProtocol: 'theta-beta-ratio', ...extra };
}

export async function resetWorld(): Promise<void> {
    const env = await environment();
    await env.clearFirestore();
    await seedDocuments({
        [`users/${ids.clinicianA}`]: { role: 'clinician', email: emailOf(ids.clinicianA) },
        [`users/${ids.colleagueA}`]: { role: 'clinician', email: emailOf(ids.colleagueA) },
        [`users/${ids.clinicianB}`]: { role: 'clinician', email: emailOf(ids.clinicianB) },
        [`users/${ids.clinicianX}`]: { role: 'clinician', email: emailOf(ids.clinicianX) },
        [`users/${ids.newClinician}`]: { role: 'clinician', email: emailOf(ids.newClinician) },
        [`users/${ids.patientA}`]: { role: 'patient', email: emailOf(ids.patientA) },
        [`users/${ids.patientB}`]: { role: 'patient', email: emailOf(ids.patientB) },
        [`users/${ids.unlinked}`]: { role: 'patient', email: emailOf(ids.unlinked) },
        [`users/${ids.roleless}`]: { role: null, email: emailOf(ids.roleless) },

        [`clinics/${clinicA}`]: { id: clinicA, name: 'Clinic A', practitionerIds: [ids.clinicianA, ids.colleagueA], branding: { name: 'Clinic A' } },
        [`clinics/${clinicB}`]: { id: clinicB, name: 'Clinic B', practitionerIds: [ids.clinicianB], branding: { name: 'Clinic B' } },
        [`clinics/${clinicX}`]: { id: clinicX, name: 'Clinic X', practitionerIds: [ids.clinicianX] },
        [`practitioners/${ids.clinicianA}`]: { id: ids.clinicianA, userId: ids.clinicianA, clinicId: clinicA, displayName: 'Dr A' },
        [`practitioners/${ids.colleagueA}`]: { id: ids.colleagueA, userId: ids.colleagueA, clinicId: clinicA, displayName: 'Dr A2' },
        [`practitioners/${ids.clinicianB}`]: { id: ids.clinicianB, userId: ids.clinicianB, clinicId: clinicB, displayName: 'Dr B' },
        [`practitioners/${ids.clinicianX}`]: { id: ids.clinicianX, userId: ids.clinicianX, clinicId: clinicX, displayName: 'Dr X' },

        [`clients/${ids.patientA}`]: patient(ids.patientA, { clinicianId: ids.clinicianA, clinicId: clinicA, acceptedInvitationId: 'INVA-AAAA-AAAA' }),
        [`clients/${ids.patientB}`]: patient(ids.patientB, { clinicianId: ids.clinicianB, clinicId: clinicB, acceptedInvitationId: 'INVB-BBBB-BBBB' }),
        [`clients/${ids.unlinked}`]: patient(ids.unlinked),
        [`clients/${ids.legacyPatient}`]: patient(ids.legacyPatient, { linkedClinicianCode: ids.clinicianA }),
        [`clients/${ids.splitPatient}`]: patient(ids.splitPatient, { clinicianId: ids.clinicianB, linkedClinicianCode: ids.clinicianA }),

        [`clients/${ids.patientA}/brainMaps/bm-a`]: { id: 'bm-a', createdBy: ids.clinicianA, schemaVersion: 1 },
        'sessions/session-a': { id: 'session-a', patientId: ids.patientA, clinicId: clinicA, clinicianId: ids.clinicianA, isDemo: true, timeInZonePercent: 50 },
        'sessions/session-b': { id: 'session-b', patientId: ids.patientB, clinicId: clinicB, clinicianId: ids.clinicianB, isDemo: true, timeInZonePercent: 60 },
        'sessions/session-split': { id: 'session-split', patientId: ids.splitPatient, clinicId: clinicB, isDemo: true },

        [`messageThreads/${ids.patientA}/relationships/${ids.clinicianA}`]: {
            patientId: ids.patientA, clinicianId: ids.clinicianA, participantIds: [ids.patientA, ids.clinicianA],
            lastMessageId: seededMessageId, lastMessageText: 'hello', lastSenderId: ids.clinicianA,
            lastMessageAt: past, createdAt: past, updatedAt: past, schemaVersion: 1,
        },
        [`messageThreads/${ids.patientA}/relationships/${ids.clinicianA}/messages/${seededMessageId}`]: {
            id: seededMessageId, patientId: ids.patientA, clinicianId: ids.clinicianA, senderId: ids.clinicianA,
            senderRole: 'clinician', text: 'hello', createdAt: past, schemaVersion: 1,
        },
        [`messageThreads/${ids.unlinked}/relationships/${ids.clinicianA}`]: {
            patientId: ids.unlinked, clinicianId: ids.clinicianA, participantIds: [ids.unlinked, ids.clinicianA],
            lastMessageId: 'old', lastMessageText: 'from before unlinking', lastSenderId: ids.clinicianA,
            lastMessageAt: past, createdAt: past, updatedAt: past, schemaVersion: 1,
        },
        [`messages/${ids.patientA}`]: { patientId: ids.patientA, clinicianId: ids.clinicianA, messages: [] },

        [`appointments/${seededAppointmentId}`]: {
            clinicianId: ids.clinicianA, patientId: ids.patientA, patientDisplayName: `Name ${ids.patientA}`,
            startsAt: future(), timezone: 'America/Toronto', durationMinutes: 45, type: 'remote-training',
            status: 'scheduled', notes: 'seeded', createdAt: past, updatedAt: past, createdBy: ids.clinicianA,
            revision: 1, schemaVersion: 1,
        },
        'appointments/legacy-appointment-for-a': { clientId: ids.patientA, patientId: null, clinicianId: ids.clinicianA, title: 'legacy' },

        'patientInvitations/INVA-AAAA-AAAA': {
            id: 'INVA-AAAA-AAAA', clinicianId: ids.clinicianA, clinicId: clinicA, patientEmail: emailOf(ids.patientA),
            patientName: 'A', status: 'accepted', patientId: ids.patientA, uniquenessClaimId: emailOf(ids.patientA),
            expiresAt: past, createdAt: past, updatedAt: past,
        },
        [`deviceAssignments/${ids.patientA}`]: { patientId: ids.patientA, assignedByUserId: ids.patientA, assignedAt: past, deviceId: 'muse-1' },
        'protocolCatalog/protocol-a': { id: 'protocol-a', clinicId: clinicA, name: 'Custom A' },
        'brands/brand-a': { name: 'Legacy brand A' },
    });
}
