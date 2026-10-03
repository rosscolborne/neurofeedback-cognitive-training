import {
  ClientProfile,
  IndividualBaselineModel,
  MilestoneBadge,
  SessionRecord,
  SessionCreateResult,
  SessionNotesPatch,
} from '../types';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';
import { DEFAULT_ALLOWED_EXPERIENCES } from './experienceIds';
import { DEFAULT_PROTOCOL } from './protocols';
import {
  buildSelfDirectedTrainingSetup,
  type SelfDirectedTrainingSetup,
} from './patientTrainingAuthority';
import { auth, db } from './firebase';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  applySessionCompletionToClient,
  readClientProfile,
  readSessionRecord,
  removeUndefined,
} from './dataMappers';

export const INITIAL_BADGES: MilestoneBadge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    description: 'Completed your very first neurofeedback training session.',
    category: 'consistency',
    iconName: 'Award',
    unlockedAt: undefined,
  },
  {
    id: 'steady-state',
    title: 'Steady State',
    description: 'Maintained a 7-day training consistency streak.',
    category: 'consistency',
    iconName: 'Waves',
    unlockedAt: undefined,
  },
  {
    id: 'deep-focus',
    title: 'Deep Focus Master',
    description: 'Achieved 80%+ time-in-zone in a Theta/Beta session.',
    category: 'focus',
    iconName: 'Target',
    unlockedAt: undefined,
  },
  {
    id: 'still-waters',
    title: 'Still Waters',
    description: 'Sustained calm Alpha wave dominance for over 15 minutes.',
    category: 'calm',
    iconName: 'Wind',
    unlockedAt: undefined,
  },
];

export const createBlankProfile = (uid: string, email: string, displayName?: string | null): ClientProfile => {
  const defaultTemplate = getClinicalProtocolTemplate(DEFAULT_PROTOCOL);
  if (!defaultTemplate) throw new Error('The default clinical protocol is unavailable');
  const name = displayName?.trim() || '';
  const cleanName = name
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: uid,
    name: cleanName,
    email: email,
    status: 'active',
    assignedProtocol: DEFAULT_PROTOCOL,
    allowedExperiences: [...defaultTemplate.recommendedExperiences],
    completedSessionsCount: 0,
    currentStreak: 0,
    brainMaps: [],
    badges: [],
    tidalGardenState: { stage: 1, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
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

    const payload = removeUndefined(client) as unknown as Record<string, unknown>;
    // saveClient can also create via setDoc(..., { merge: true }). Never create
    // a current profile without an explicit experience assignment field.
    payload.allowedExperiences = Array.isArray(client.allowedExperiences)
      ? client.allowedExperiences : [...DEFAULT_ALLOWED_EXPERIENCES];
    for (const field of ['condition', 'assignedProtocol', 'prescribedSessionsPerWeek', 'customProtocolConfig'] as const) {
      if (client[field] === undefined) payload[field] = deleteField();
    }
    // A merged map keeps omitted nested keys. Clear a previous ratio rule
    // when this assignment no longer includes one.
    if (client.customProtocolConfig && !client.customProtocolConfig.ratioReward) {
      (payload.customProtocolConfig as Record<string, unknown>).ratioReward = deleteField();
    }
    await setDoc(doc(db, 'clients', client.id), payload, { merge: true });
  }

  /**
   * Replace the patient's own training assignment. The transaction re-reads the
   * profile so a deletion started elsewhere is respected, and it writes only the
   * assignment fields so concurrent progress and history stay intact.
   */
  public async saveSelfDirectedTrainingSetup(patientId: string, setup: SelfDirectedTrainingSetup): Promise<ClientProfile> {
    const { assignedProtocol, allowedExperiences } = buildSelfDirectedTrainingSetup(setup.assignedProtocol, setup.allowedExperiences);
    const apply = (current: ClientProfile): ClientProfile => {
      if (current.accountDeletionStartedAt) throw new Error('Training setup is unavailable while account deletion is in progress.');
      return { ...current, assignedProtocol, allowedExperiences: [...allowedExperiences], customProtocolConfig: undefined };
    };
    if (!auth.currentUser || auth.currentUser.uid !== patientId) throw new Error('Sign in as this patient to change your training setup.');
    const clientRef = doc(db, 'clients', patientId);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(clientRef);
      if (!snapshot.exists()) throw new Error('Your patient profile is unavailable. Try again.');
      const updated = apply(readClientProfile(snapshot.data(), snapshot.id));
      transaction.update(clientRef, {
        assignedProtocol,
        allowedExperiences,
        customProtocolConfig: deleteField(),
        updatedAt: serverTimestamp(),
      });
      return updated;
    });
  }

  public async saveIndividualBaselineModel(patientId: string, baselineModel: IndividualBaselineModel): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in to save a patient record');
    await updateDoc(doc(db, 'clients', patientId), { individualBaselineModel: baselineModel });
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

  /** Read an existing patient for calibration without creating or enriching its profile. */
  public async getExistingCurrentClient(user?: { uid: string } | null): Promise<ClientProfile | null> {
    if (!user?.uid) return null;

    const snapshot = await getDoc(doc(db, 'clients', user.uid));
    return snapshot.exists() ? readClientProfile(snapshot.data(), snapshot.id) : null;
  }

  /** The signed-in patient's own sessions, newest first. */
  public async getSessions(patientId: string): Promise<SessionRecord[]> {
    if (!auth.currentUser || auth.currentUser.uid !== patientId) return [];
    try {
      const snapshot = await getDocs(query(collection(db, 'sessions'), where('patientId', '==', patientId)));
      return snapshot.docs
        .map((entry) => readSessionRecord(entry.data(), entry.id))
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      console.warn('Failed to fetch sessions from Firestore:', err);
      throw err;
    }
  }

  public async createSession(session: SessionRecord): Promise<SessionCreateResult> {
    const normalizedSession = readSessionRecord(
      { ...session, schemaVersion: session.schemaVersion ?? 2 },
      session.id
    );
    if (!auth.currentUser) throw new Error('Sign in to save a training session');
    if (auth.currentUser.uid !== session.patientId) throw new Error('Not authorized to create a session for this patient');

    const sessionRef = doc(db, 'sessions', session.id);
    const clientRef = doc(db, 'clients', session.patientId);
    return runTransaction(db, async (transaction) => {
      const currentClient = await transaction.get(clientRef);
      const timestamp = serverTimestamp();

      // A brand-new session cannot be read under the patient-scoped Firestore
      // rules because it has no patientId to authorize yet. Keep a bounded
      // ledger on the already-authorized client profile instead, so retries do
      // not apply its aggregate effects twice.
      if (
        currentClient.exists() &&
        readClientProfile(currentClient.data(), currentClient.id)
          .recentCompletedSessionIds?.includes(normalizedSession.id)
      ) {
        return { created: false, session: normalizedSession };
      }

      transaction.set(
        sessionRef,
        removeUndefined({
          ...normalizedSession,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: normalizedSession.completedAt ?? timestamp,
        })
      );

      if (currentClient.exists()) {
        const nextClient = applySessionCompletionToClient(
          readClientProfile(currentClient.data(), currentClient.id),
          normalizedSession
        );
        transaction.set(
          clientRef,
          removeUndefined({ ...nextClient, updatedAt: timestamp }),
          { merge: true }
        );
      }

      return { created: true, session: normalizedSession };
    });
  }

  public async patchSessionNotes(sessionId: string, patch: SessionNotesPatch): Promise<void> {
    if (!auth.currentUser) throw new Error('Sign in to update session notes');

    const sessionRef = doc(db, 'sessions', sessionId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists()) throw new Error(`Session ${sessionId} does not exist`);

      const session = readSessionRecord(snapshot.data(), snapshot.id);
      if (session.patientId !== auth.currentUser?.uid) throw new Error('Not authorized to update this session');

      transaction.set(
        sessionRef,
        { ...removeUndefined({ patientNotes: patch.patientNotes, moodRating: patch.moodRating }), updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
  }

  /**
   * Compatibility wrapper for current UI callers. A first call creates the
   * immutable measurement and aggregates it once; repeats patch only notes.
   */
  public async saveSession(session: SessionRecord): Promise<void> {
    const result = await this.createSession(session);
    if (!result.created) {
      await this.patchSessionNotes(session.id, {
        patientNotes: session.patientNotes,
        moodRating: session.moodRating,
      });
    }
  }
}

export const storageEngine = new StorageEngine();
