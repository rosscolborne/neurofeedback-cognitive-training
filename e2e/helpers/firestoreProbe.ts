import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebase';

/** Browser-side Firestore calls run with the signed-in user's ordinary rules. */
async function outcome(probe: () => Promise<unknown>): Promise<string> {
    try { await probe(); return 'allowed'; }
    catch (error) { return (error as { code?: string }).code ?? 'unknown'; }
}

/** New UID must not inherit reads of the deleted UID's retained profile. */
export async function probeDeletedPatientProfile(oldUid: string): Promise<string> {
    await auth.authStateReady();
    return outcome(() => getDoc(doc(db, 'clients', oldUid)));
}
