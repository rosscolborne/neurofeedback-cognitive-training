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
const canonicalAppointmentsForClinician = (clinicianId: string, patientId: string) => getDocs(query(collection(db, 'appointments'), where('clinicianId', '==', clinicianId), where('patientId', '==', patientId)));
const legacyAppointmentsForClinician = (clinicianId: string, patientId: string) => getDocs(query(collection(db, 'appointments'), where('clinicianId', '==', clinicianId), where('clientId', '==', patientId), where('patientId', '==', null)));

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

export async function probeUnrelatedClinicianReads(patientId: string, ownerClinicianId: string): Promise<string[]> {
    await auth.authStateReady();
    return Promise.all([
        () => getDoc(doc(db, 'clients', patientId)),
        () => sessions(patientId),
        () => canonicalAppointmentsForPatient(patientId),
        () => getDocs(collection(db, 'clients', patientId, 'brainMaps')),
        () => getDoc(doc(db, 'messageThreads', patientId, 'relationships', ownerClinicianId)),
        () => getDocs(collection(db, 'messageThreads', patientId, 'relationships', ownerClinicianId, 'messages')),
    ].map(outcome));
}

export type DeployedReadProbe = { reads: Record<string, string>; hasReadableLegacyMessageHistory: boolean; hasExistingInvitation: boolean };

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
    return { reads, hasReadableLegacyMessageHistory, hasExistingInvitation: false };
}

/** Current clinician roster, settings, patient detail, reports, messaging, and calendar reads. */
export async function probeClinicianBranchRuleReads(patientId: string, hasReadableLegacyMessageHistory: boolean): Promise<DeployedReadProbe> {
    await auth.authStateReady();
    const clinicianId = signedInId();
    const reads: Record<string, string> = {};
    reads.ownUserRole = await outcome(async () => {
        const user = await getDoc(doc(db, 'users', clinicianId));
        if (user.data()?.role !== 'clinician') throw Object.assign(new Error('role'), { code: 'no-clinician-role' });
    });
    let clinicId = clinicianId;
    reads.ownPractitionerRecord = await outcome(async () => {
        const practitioner = await getDoc(doc(db, 'practitioners', clinicianId));
        if (!practitioner.exists()) throw Object.assign(new Error('practitioner'), { code: 'missing-practitioner-fixture' });
        if (typeof practitioner.data().clinicId === 'string') clinicId = practitioner.data().clinicId;
    });
    reads.ownClinicSettings = await outcome(() => getDoc(doc(db, 'clinics', clinicId)));

    const rosterIds = new Set<string>();
    reads.canonicalRoster = await outcome(async () => {
        const roster = await getDocs(query(collection(db, 'clients'), where('clinicianId', '==', clinicianId)));
        roster.docs.forEach((entry) => rosterIds.add(entry.id));
    });
    reads.legacyRoster = await outcome(async () => {
        const roster = await getDocs(query(collection(db, 'clients'), where('linkedClinicianCode', '==', clinicianId), where('clinicianId', '==', null)));
        roster.docs.forEach((entry) => rosterIds.add(entry.id));
    });
    let existingInvitationId: string | undefined;
    reads.patientInvitations = await outcome(async () => {
        const invitations = await getDocs(query(collection(db, 'patientInvitations'), where('clinicianId', '==', clinicianId)));
        existingInvitationId = invitations.docs[0]?.id;
    });
    if (existingInvitationId) {
        const invitationId = existingInvitationId;
        reads.existingInvitation = await outcome(() => getDoc(doc(db, 'patientInvitations', invitationId)));
    }
    reads.linkedPatientProfileAndAssignment = await outcome(async () => {
        const profile = await getDoc(doc(db, 'clients', patientId));
        if (!profile.exists() || currentClinicianId(profile.data()) !== clinicianId || !rosterIds.has(patientId)) {
            throw Object.assign(new Error('relationship'), { code: 'unlinked-patient-fixture' });
        }
    });
    if (reads.linkedPatientProfileAndAssignment !== 'allowed') {
        throw new Error(`The read-only clinician fixture must include the linked patient in its roster; profile probe: ${reads.linkedPatientProfileAndAssignment}.`);
    }

    // Reports and the calendar enumerate every current roster member.
    const ids = [...rosterIds];
    reads.rosterPatientProfiles = await outcome(() => Promise.all(ids.map((id) => getDoc(doc(db, 'clients', id)))));
    reads.rosterSessionsAndReports = await outcome(() => Promise.all(ids.map(sessions)));
    reads.rosterAppointments = await outcome(() => Promise.all(ids.map((id) => canonicalAppointmentsForClinician(clinicianId, id))));
    reads.rosterLegacyAppointments = await outcome(() => Promise.all(ids.map((id) => legacyAppointmentsForClinician(clinicianId, id))));
    reads.rosterMessageThreads = await outcome(() => Promise.all(ids.map((id) => messageThread(id, clinicianId))));
    reads.rosterMessageReadReceipts = await outcome(() => Promise.all(ids.map((id) => messageReadReceipt(id, clinicianId, clinicianId))));
    reads.linkedPatientBrainMaps = await outcome(() => getDocs(collection(db, 'clients', patientId, 'brainMaps')));
    reads.linkedPatientMessageThread = await outcome(() => messageThread(patientId, clinicianId));
    reads.ownMessageReadReceipt = await outcome(() => messageReadReceipt(patientId, clinicianId, clinicianId));
    reads.linkedPatientMessageHistory = await outcome(() => messageHistory(patientId, clinicianId));
    if (hasReadableLegacyMessageHistory) reads.linkedPatientLegacyMessageHistory = await outcome(() => getDoc(doc(db, 'messages', patientId)));
    return { reads, hasReadableLegacyMessageHistory, hasExistingInvitation: Boolean(existingInvitationId) };
}
