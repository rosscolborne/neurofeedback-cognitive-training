import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebase';

/** Browser-side Firestore calls run with the signed-in user's ordinary rules. */
async function outcome(probe: () => Promise<unknown>): Promise<string> {
    try { await probe(); return 'allowed'; }
    catch (error) { return (error as { code?: string }).code ?? 'unknown'; }
}

function signedInId(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('A signed-in user is required for rule probes.');
    return uid;
}

function currentClinicianId(patient: Record<string, unknown>): string | undefined {
    if (typeof patient.clinicianId === 'string') return patient.clinicianId;
    if (patient.clinicianId == null && typeof patient.linkedClinicianCode === 'string') return patient.linkedClinicianCode;
    return undefined;
}

// Match the bounded, ordered history query in messageRepository.listMessages.
const messageHistory = (patientId: string, clinicianId: string) => getDocs(query(
    collection(db, 'messageThreads', patientId, 'relationships', clinicianId, 'messages'),
    orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(50),
));
const messageThread = (patientId: string, clinicianId: string) =>
    getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId));
const messageReadReceipt = (patientId: string, clinicianId: string, readerId: string) =>
    getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId, 'reads', readerId));
const sessions = (patientId: string) => getDocs(query(collection(db, 'sessions'), where('patientId', '==', patientId)));
const canonicalAppointmentsForPatient = (patientId: string) => getDocs(query(collection(db, 'appointments'), where('patientId', '==', patientId)));
const legacyAppointmentsForPatient = (patientId: string) => getDocs(query(collection(db, 'appointments'), where('clientId', '==', patientId), where('patientId', '==', null)));

/** Direct, read-only probe used by the isolated messaging browser scenario. */
export async function probeMessageThreadRead(patientId: string, clinicianId: string): Promise<string> {
    await auth.authStateReady();
    return outcome(() => getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId)));
}

/** New UID must not inherit reads of the deleted UID's retained history. */
export async function probeDeletedPatientHistory(oldUid: string, clinicianId: string): Promise<string[]> {
    await auth.authStateReady();
    return Promise.all([
        () => getDoc(doc(db, 'clients', oldUid)),
        () => getDoc(doc(db, 'sessions', `lifecycle-${oldUid}`)),
        () => getDoc(doc(db, 'messageThreads', oldUid, 'relationships', clinicianId)),
    ].map(outcome));
}

export type DeployedReadProbe = { reads: Record<string, string>; hasReadableLegacyMessageHistory: boolean };

/** Current patient dashboard, progress, messaging, and calendar reads. */
export async function probePatientBranchRuleReads(clinicianId: string): Promise<DeployedReadProbe> {
    await auth.authStateReady();
    const patientId = signedInId();
    const reads: Record<string, string> = {};
    reads.ownUserRole = await outcome(async () => {
        const user = await getDoc(doc(db, 'users', patientId));
        if (user.data()?.role !== 'patient') throw Object.assign(new Error('role'), { code: 'no-patient-role' });
    });

    let clinicId: string | undefined;
    reads.ownClientProfileAndAssignment = await outcome(async () => {
        const profile = await getDoc(doc(db, 'clients', patientId));
        if (!profile.exists()) throw Object.assign(new Error('profile'), { code: 'missing-patient-fixture' });
        if (currentClinicianId(profile.data()) !== clinicianId) throw Object.assign(new Error('relationship'), { code: 'unlinked-patient-fixture' });
        clinicId = typeof profile.data().clinicId === 'string' ? profile.data().clinicId : undefined;
    });
    if (!clinicId) throw new Error(`The read-only patient fixture must be linked to a clinic; profile probe: ${reads.ownClientProfileAndAssignment}.`);
    const linkedClinicId = clinicId;

    reads.linkedClinicBrand = await outcome(() => getDoc(doc(db, 'clinics', linkedClinicId)));
    reads.ownSessionsAndProgress = await outcome(() => sessions(patientId));
    reads.ownBrainMaps = await outcome(() => getDocs(collection(db, 'clients', patientId, 'brainMaps')));
    reads.ownMessageThread = await outcome(() => messageThread(patientId, clinicianId));
    reads.ownMessageReadReceipt = await outcome(() => messageReadReceipt(patientId, clinicianId, patientId));
    reads.ownMessageHistory = await outcome(() => messageHistory(patientId, clinicianId));
    let hasReadableLegacyMessageHistory = false;
    reads.ownLegacyMessageHistory = await outcome(async () => {
        const legacy = await getDoc(doc(db, 'messages', patientId));
        hasReadableLegacyMessageHistory = legacy.exists() && legacy.data().clinicianId === clinicianId;
    });
    reads.ownAppointments = await outcome(() => canonicalAppointmentsForPatient(patientId));
    reads.ownLegacyAppointments = await outcome(() => legacyAppointmentsForPatient(patientId));
    return { reads, hasReadableLegacyMessageHistory };
}
