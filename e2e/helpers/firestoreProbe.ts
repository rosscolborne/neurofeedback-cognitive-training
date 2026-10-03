import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { auth, db } from '../../src/services/firebase';

/** Browser-side Firestore calls run with the signed-in user's ordinary rules. */
async function outcome(probe: () => Promise<unknown>): Promise<string> {
    try { await probe(); return 'allowed'; }
    catch (error) { return (error as { code?: string }).code ?? 'unknown'; }
}

/**
 * A new UID must not inherit reads of a deleted UID's data: its profile path,
 * and the game sessions that stay until server-driven deletion (NFCT-23).
 */
export async function probeDeletedPlayerData(oldUid: string): Promise<{ profile: string; gameSessions: string }> {
    await auth.authStateReady();
    return {
        profile: await outcome(() => getDoc(doc(db, 'users', oldUid))),
        gameSessions: await outcome(() => getDocs(collection(db, 'users', oldUid, 'gameSessions'))),
    };
}
