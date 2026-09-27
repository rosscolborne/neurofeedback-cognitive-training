import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebase';

/** Browser-side Firestore calls run with the signed-in user's ordinary rules. */

async function outcome(probe: () => Promise<unknown>): Promise<string> {
    try {
        await probe();
        return 'allowed';
    } catch (error) {
        return (error as { code?: string }).code ?? 'unknown';
    }
}

/** Direct, read-only probe used by the isolated messaging browser scenario. */
export async function probeMessageThreadRead(patientId: string, clinicianId: string): Promise<string> {
    await auth.authStateReady();
    return outcome(() => getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId)));
}

export async function probeUnrelatedClinicianReads(patientId: string, ownerClinicianId: string): Promise<string[]> {
    await auth.authStateReady();
    return Promise.all([
        () => getDoc(doc(db, 'clients', patientId)),
        () => getDocs(query(collection(db, 'sessions'), where('patientId', '==', patientId))),
        () => getDocs(query(collection(db, 'appointments'), where('patientId', '==', patientId))),
        () => getDocs(collection(db, 'clients', patientId, 'brainMaps')),
        () => getDoc(doc(db, 'messageThreads', patientId, 'relationships', ownerClinicianId)),
        () => getDocs(collection(db, 'messageThreads', patientId, 'relationships', ownerClinicianId, 'messages')),
    ].map(outcome));
}

/**
 * Reads the repository rules grant to the signed-in patient but which rules
 * without the messaging and QEEG paths deny. Read-only.
 */
export async function probePatientBranchRuleReads(clinicianId: string): Promise<Record<string, string>> {
    await auth.authStateReady();
    const patientId = auth.currentUser?.uid;
    if (!patientId) throw new Error('A signed-in patient is required.');
    return {
        ownMessageThread: await outcome(() => getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId))),
        ownMessageReadReceipt: await outcome(() => getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId, 'reads', patientId))),
        ownBrainMaps: await outcome(() => getDocs(collection(db, 'clients', patientId, 'brainMaps'))),
    };
}

/** The repository rules let a clinician read its own practitioner record, present or not. Read-only. */
export async function probeClinicianBranchRuleReads(patientId: string): Promise<Record<string, string>> {
    await auth.authStateReady();
    const clinicianId = auth.currentUser?.uid;
    if (!clinicianId) throw new Error('A signed-in clinician is required.');
    return {
        ownUserRole: await outcome(async () => {
            const user = await getDoc(doc(db, 'users', clinicianId));
            if (user.data()?.role !== 'clinician') throw Object.assign(new Error('role'), { code: 'no-clinician-role' });
        }),
        ownPractitionerRecord: await outcome(() => getDoc(doc(db, 'practitioners', clinicianId))),
        ownMessageReadReceipt: await outcome(() => getDoc(doc(db, 'messageThreads', patientId, 'relationships', clinicianId, 'reads', clinicianId))),
    };
}
