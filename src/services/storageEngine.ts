import { ClientProfile } from '../types';
import { auth, db } from './firebase';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { readClientProfile, removeUndefined } from './dataMappers';

export const createBlankProfile = (uid: string, email: string, displayName?: string | null): ClientProfile => {
  const name = displayName?.trim() || '';
  const cleanName = name
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: uid,
    name: cleanName,
    email: email,
    status: 'active',
    brainMaps: [],
    isDemo: false,
  };
};

class StorageEngine {
  public async getClient(id: string): Promise<ClientProfile | null> {
    if (!auth.currentUser) return null;
    const snap = await getDoc(doc(db, 'clients', id));
    if (snap.exists()) {
      if (snap.data().accountDeletionStartedAt && auth.currentUser.uid !== id) return null;
      return readClientProfile(snap.data(), snap.id);
    }
    return null;
  }

  /** Resumable bounded cleanup. Auth deletion is deliberately the caller's last step. */
  public async preparePatientAccountDeletion(expectedUid: string, onDeactivated?: (client: ClientProfile) => void): Promise<void> {
    const uid = expectedUid;
    const ensureIdentity = () => {
      if (auth.currentUser?.uid !== uid) throw new Error('Your signed-in account changed. Restart account deletion.');
    };
    ensureIdentity();
    const clientRef = doc(db, 'clients', uid);
    const clientSnapshot = await getDoc(clientRef);
    ensureIdentity();
    if (!clientSnapshot.exists()) throw new Error('Your patient profile is unavailable. Please contact support.');
    const client = readClientProfile(clientSnapshot.data(), uid);
    if (!client.accountDeletionStartedAt) {
      ensureIdentity();
      // Profiles linked under the retired clinician product still carry
      // relationship fields; deletion clears them (Phase 2 retires the fields).
      await updateDoc(clientRef, {
        accountDeletionStartedAt: serverTimestamp(),
        clinicianId: null,
        linkedClinicianCode: null,
        clinicId: null,
        acceptedInvitationId: null,
        updatedAt: serverTimestamp(),
      });
    }
    ensureIdentity();
    onDeactivated?.({ ...client, accountDeletionStartedAt: client.accountDeletionStartedAt ?? new Date(),
      clinicianId: undefined, linkedClinicianCode: undefined, clinicId: undefined, acceptedInvitationId: undefined });

    // Keep the patient role until Auth deletion succeeds. A failed Auth delete
    // can then reload this route and resume.
    ensureIdentity();
    await setDoc(doc(db, 'users', uid), {
      role: 'patient', email: null, displayName: null, accountDeletionStartedAt: serverTimestamp(),
    }, { merge: true });
  }

  public async saveClient(client: ClientProfile): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in to save a patient record');

    const payload = removeUndefined(client);
    await setDoc(doc(db, 'clients', client.id), payload, { merge: true });
  }

  public async getCurrentClient(user?: { uid: string; email?: string | null; displayName?: string | null } | null): Promise<ClientProfile | null> {
    if (user?.uid) {
      const clientRef = doc(db, 'clients', user.uid);
      const snap = await getDoc(clientRef);
      if (snap.exists()) {
        const existing = readClientProfile(snap.data(), snap.id);
        if (!existing.accountDeletionStartedAt && !existing.name && user.displayName) {
          const name = user.displayName
            .trim()
            .replace(/[._]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
          // An existing profile may be deleted after the read. Do not let a
          // display-name repair recreate a partial clients/{uid} document.
          await updateDoc(clientRef, { name });
          existing.name = name;
        }
        return existing;
      }

      // A blank profile is safe only after Firestore authoritatively confirms
      // that no profile exists. Read or write failures must remain visible.
      const fresh = createBlankProfile(user.uid, user.email || 'user@waveable.app', user.displayName);
      fresh.patientId = user.uid;
      await setDoc(clientRef, fresh);
      return fresh;
    }

    return null;
  }
}

export const storageEngine = new StorageEngine();
