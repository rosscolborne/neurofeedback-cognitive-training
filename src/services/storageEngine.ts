import {
  ClientProfile,
  ClinicProfile,
  ClinicBrandConfig,
  MilestoneBadge,
  SessionRecord,
  SessionCreateResult,
  SessionNotesPatch,
} from '../types';
import { BRAND_PRESETS, mapClinicBrand } from './brandEngine';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';
import { DEFAULT_ALLOWED_EXPERIENCES } from './experienceIds';
import { DEFAULT_PROTOCOL } from './protocols';
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
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  applySessionCompletionToClient,
  getPatientClinicianId,
  isPatientInvitationExpired,
  readClientProfile,
  readPatientInvitation,
  readSessionRecord,
  removeUndefined,
  timestampToMillis,
} from './dataMappers';

// Invitation addresses are stored case-normalized. Firestore rules lowercase
// the Firebase Auth token email before comparing it with the stored address.
// Invitations do not require an existing patient document: the account/profile
// may be created later, and acceptance links that authenticated profile.
const normalizeEmail = (email: string) => email.trim().toLowerCase();

const INVITATION_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const getInvitationClaimRef = (clinicianId: string, normalizedEmail: string) =>
  doc(db, 'patientInvitationClaims', clinicianId, 'emails', normalizedEmail);
/** Code-free marker that this clinician has a pending invitation for the email; it lives and ends with the claim. */
const getInvitationNoticeRef = (clinicianId: string, normalizedEmail: string) =>
  doc(db, 'patientInvitationNotices', normalizedEmail, 'clinicians', clinicianId);

const CANONICAL_APPOINTMENT_KEYS = new Set([
  'clinicianId', 'patientId', 'patientDisplayName', 'clinicianDisplayName', 'startsAt', 'timezone',
  'durationMinutes', 'type', 'status', 'notes', 'createdAt', 'updatedAt', 'createdBy', 'revision', 'schemaVersion',
]);
const REQUIRED_CANONICAL_APPOINTMENT_KEYS = [
  'clinicianId', 'patientId', 'patientDisplayName', 'startsAt', 'timezone',
  'durationMinutes', 'type', 'status', 'createdAt', 'updatedAt',
  'createdBy', 'revision', 'schemaVersion',
];
const CANONICAL_APPOINTMENT_TYPES = new Set([
  'remote-training', 'in-clinic-evaluation', 'qeeg-mapping', 'protocol-review', 'consultation',
]);

const isBoundedText = (value: unknown, maxLength: number, allowEmpty: boolean) =>
  typeof value === 'string' && value.length <= maxLength && (value === '' ? allowEmpty : value.trim() === value);

/**
 * Mirrors the Firestore cancellation rule, so an unlink only cancels future
 * appointments the rules will accept. A legacy or malformed record is left as
 * is rather than blocking the whole unlink.
 */
function isCancellableFutureAppointment(data: Record<string, unknown>, now: number): data is Record<string, unknown> & { revision: number } {
  const startsAt = data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null;
  return data.status === 'scheduled'
    && startsAt !== null && startsAt > now
    && Number.isInteger(data.revision)
    && data.schemaVersion === 1
    && data.createdAt instanceof Timestamp
    && REQUIRED_CANONICAL_APPOINTMENT_KEYS.every((key) => key in data)
    && Object.keys(data).every((key) => CANONICAL_APPOINTMENT_KEYS.has(key))
    && typeof data.clinicianId === 'string'
    && typeof data.patientId === 'string' && data.patientId.length > 0 && data.patientId.length <= 128
    && typeof data.createdBy === 'string'
    && Number.isInteger(data.durationMinutes) && (data.durationMinutes as number) >= 15 && (data.durationMinutes as number) <= 240
    && CANONICAL_APPOINTMENT_TYPES.has(data.type as string)
    && isBoundedText(data.patientDisplayName, 160, false)
    && isBoundedText(data.timezone, 100, false)
    && (!('clinicianDisplayName' in data) || isBoundedText(data.clinicianDisplayName, 160, false))
    && (!('notes' in data) || isBoundedText(data.notes, 2000, true));
}

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
  public async getClinicBrandConfig(clinicId: string): Promise<ClinicBrandConfig> {
    const clinic = await this.getClinic(clinicId);
    // Never fall back to the historical global browser key here: it is not
    // account/tenant scoped and can leak the previous account's branding.
    return mapClinicBrand(clinic?.branding, clinicId) ?? BRAND_PRESETS[0];
  }

  public async getClinic(clinicId: string): Promise<ClinicProfile | null> {
    if (!auth.currentUser) return null;
    const snapshot = await getDoc(doc(db, 'clinics', clinicId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<ClinicProfile>;
    return {
      ...data,
      id: data.id || snapshot.id,
      name: data.name ?? '',
      timezone: data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      practitionerIds: Array.isArray(data.practitionerIds) ? data.practitionerIds : [],
    };
  }

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
    // can then reload this route and resume without resurrecting the link.
    ensureIdentity();
    await setDoc(doc(db, 'users', uid), {
      role: 'patient', email: null, displayName: null, accountDeletionStartedAt: serverTimestamp(),
    }, { merge: true });

    // Cancel every future canonical appointment for this UID, including ones
    // created by a former clinician. Pending email invitations remain usable by
    // a new UID, so they and their claims are intentionally untouched.
    ensureIdentity();
    const appointments = await getDocs(query(collection(db, 'appointments'), where('patientId', '==', uid)));
    ensureIdentity();
    const now = Date.now();
    for (const entry of appointments.docs) {
      const data = entry.data() as Record<string, unknown>;
      const startsAt = data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null;
      if (data.status === 'scheduled' && startsAt !== null && startsAt > now && !isCancellableFutureAppointment(data, now)) {
        throw new Error('A future appointment could not be cancelled automatically. Your clinic connection is removed; contact support to finish account deletion.');
      }
      if (!isCancellableFutureAppointment(data, now)) continue;
      ensureIdentity();
      await updateDoc(entry.ref, {
        status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: uid,
        cancellationRequestId: `cancel_${crypto.randomUUID().replace(/-/g, '')}`,
        updatedAt: serverTimestamp(), revision: data.revision + 1,
      });
    }
  }

  /**
   * The patient ends their own clinician relationship. Like unlinkPatient, only the
   * relationship fields change, so the last assignment stays as the self-directed
   * starting point, and that clinician's future scheduled appointments are cancelled
   * with it. Past appointments, sessions and messages are left untouched.
   */
  public async disconnectFromClinician(patientId: string): Promise<ClientProfile> {
    if (!auth.currentUser || auth.currentUser.uid !== patientId) throw new Error('Sign in as this patient to disconnect from your clinician.');
    const clientRef = doc(db, 'clients', patientId);
    const appointments = await getDocs(query(collection(db, 'appointments'), where('patientId', '==', patientId)));
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(clientRef);
      if (!snapshot.exists()) throw new Error('Your patient profile is unavailable. Try again.');
      const current = readClientProfile(snapshot.data(), snapshot.id);
      if (current.accountDeletionStartedAt) throw new Error('Your account is being deleted.');
      const clinicianId = getPatientClinicianId(current);
      if (!clinicianId) return current;
      const now = Date.now();
      const cancellations = [];
      for (const entry of appointments.docs) {
        if (entry.data().clinicianId !== clinicianId) continue;
        const latest = await transaction.get(entry.ref);
        const data = latest.data() as Record<string, unknown> | undefined;
        if (data && isCancellableFutureAppointment(data, now)) cancellations.push({ ref: entry.ref, revision: data.revision });
      }
      for (const { ref, revision } of cancellations) {
        transaction.update(ref, {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelledBy: patientId,
          cancellationRequestId: `cancel_${crypto.randomUUID().replace(/-/g, '')}`,
          updatedAt: serverTimestamp(),
          revision: revision + 1,
        });
      }
      transaction.update(clientRef, {
        clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp(),
      });
      return { ...current, clinicianId: undefined, linkedClinicianCode: undefined, clinicId: undefined, acceptedInvitationId: undefined };
    });
  }

  /**
   * Whether any clinician has an unexpired pending invitation for the signed-in email.
   * Only code-free notices are read, so this cannot reveal a code or accept anything.
   */
  public async hasPendingInvitationNotice(): Promise<boolean> {
    const email = normalizeEmail(auth.currentUser?.email || '');
    if (!email || email.includes('/')) return false;
    const notices = await getDocs(collection(db, 'patientInvitationNotices', email, 'clinicians'));
    const now = Date.now();
    return notices.docs.some((entry) => (timestampToMillis(entry.data().expiresAt) ?? 0) > now);
  }

  public async acceptPatientInvitation(invitationCode: string, fallbackClient: ClientProfile): Promise<ClientProfile> {
    const patient = auth.currentUser;
    if (!patient?.email) throw new Error('Sign in with the invited email address');
    const patientEmail = patient.email;

    const code = invitationCode.trim().toUpperCase();
    if (!INVITATION_CODE_PATTERN.test(code)) {
      throw new Error('Enter the 12-character invitation code in XXXX-XXXX-XXXX format');
    }
    const invitationRef = doc(db, 'patientInvitations', code);
    const clientRef = doc(db, 'clients', patient.uid);

    try {
      return await runTransaction(db, async (transaction) => {
        const invitationSnapshot = await transaction.get(invitationRef);
        if (!invitationSnapshot.exists()) throw new Error('Invitation code not found. Check the code and try again');

        const invitation = readPatientInvitation(invitationSnapshot.data(), invitationSnapshot.id);
        if (invitation.clinicianId === patient.uid) {
          throw new Error('A clinician cannot accept their own patient invitation');
        }
        if (normalizeEmail(invitation.patientEmail) !== normalizeEmail(patientEmail)) {
          throw new Error('This invitation was sent to a different email address');
        }
        if (invitation.clinicId && invitation.clinicId.includes('/')) {
          throw new Error('This invitation contains an invalid clinic assignment');
        }
        const clientSnapshot = await transaction.get(clientRef);
        const current = clientSnapshot.exists()
          ? readClientProfile(clientSnapshot.data(), clientSnapshot.id)
          : { ...fallbackClient, id: patient.uid, patientId: patient.uid, email: patientEmail };
        const currentClinicianId = getPatientClinicianId(current);

        if (invitation.status === 'accepted') {
          if (
            invitation.patientId === patient.uid &&
            currentClinicianId === invitation.clinicianId &&
            (!invitation.clinicId || current.clinicId === invitation.clinicId) &&
            current.acceptedInvitationId === invitation.id
          ) {
            return current;
          }
          throw new Error('This invitation has already been used');
        }
        if (invitation.status === 'cancelled') throw new Error('This invitation was cancelled by the clinician');
        // Invitations must carry an expiry; legacy ones without it are refused by
        // the rules, so report them as expired instead of a permission error.
        if (invitation.status === 'expired' || isPatientInvitationExpired(invitation) || timestampToMillis(invitation.expiresAt) === null) {
          throw new Error('This invitation has expired. Ask your clinician for a new code');
        }
        if (invitation.status !== 'pending') throw new Error('This invitation is no longer available');
        if (currentClinicianId === invitation.clinicianId) {
          throw new Error('You are already connected to this clinician. This invitation is not needed');
        }
        if (currentClinicianId && currentClinicianId !== invitation.clinicianId) {
          throw new Error('Disconnect from your current clinician before accepting another invitation');
        }
        const assignedTemplate = getClinicalProtocolTemplate(invitation.assignedProtocol);
        if (!assignedTemplate) {
          throw new Error('This invitation has no supported protocol. Ask your clinician for a new invitation');
        }
        const linkedClient: ClientProfile = {
          ...current,
          id: patient.uid,
          patientId: patient.uid,
          email: patientEmail,
          name: current.name || invitation.patientName,
          clinicianId: invitation.clinicianId,
          clinicId: invitation.clinicId ?? current.clinicId,
          acceptedInvitationId: invitation.id,
          condition: invitation.condition,
          assignedProtocol: invitation.assignedProtocol,
          customProtocolConfig: undefined,
          allowedExperiences: [...assignedTemplate.recommendedExperiences],
          prescribedSessionsPerWeek: invitation.prescribedSessionsPerWeek,
          notes: invitation.notes ?? current.notes,
        };
        const timestamp = serverTimestamp();

        transaction.set(clientRef, {
          ...removeUndefined({ ...linkedClient, updatedAt: timestamp }),
          ...(clientSnapshot.exists() ? { customProtocolConfig: deleteField() } : {}),
        }, { merge: true });
        transaction.set(
          invitationRef,
          {
            status: 'accepted',
            patientId: patient.uid,
            acceptedAt: timestamp,
            updatedAt: timestamp,
          },
          { merge: true }
        );
        if (invitation.uniquenessClaimId) {
          transaction.delete(getInvitationClaimRef(invitation.clinicianId, invitation.uniquenessClaimId));
          transaction.delete(getInvitationNoticeRef(invitation.clinicianId, invitation.uniquenessClaimId));
        }
        return linkedClient;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'permission-denied') {
        throw new Error('Invitation not found for this signed-in email. Check the code and account, then try again');
      }
      throw error;
    }
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
