import { getDoc, serverTimestamp, setDoc, updateDoc, type FieldValue } from 'firebase/firestore';
import { z } from 'zod';
import {
  readUserProfile,
  USER_PROFILE_SCHEMA_VERSION,
  userProfileWriteSchema,
  type UserProfile,
} from '@nfct/shared';
import { profileRef, signedInUid, type ConsumerFirestoreContext } from '../firestore/context';
import { readDocument, type DocumentRead } from '../firestore/reads';
import { assertValidWithServerClock, ConsumerWriteValidationError, pendingWrite, type PendingWrite } from '../firestore/writes';

// users/{uid}: the consumer profile. Created once at sign-up with server-clock
// timestamps, then changed only by field-level updates: each update names the
// exact field paths it changes plus a server-clock `updatedAt`, never a
// read-modify-write of the whole document. That matches the rules, which allow
// updates to displayName, avatar, preferences, onboarding, eeg and updatedAt
// only, and keep createdAt immutable.

const profileShape = userProfileWriteSchema.shape;

/** What sign-up supplies. The server clock sets createdAt and updatedAt; onboarding starts incomplete and EEG consent unrecorded. */
export type UserProfileDraft = Pick<UserProfile, 'displayName' | 'avatar' | 'preferences'> & {
  readonly onboarding: Pick<UserProfile['onboarding'], 'version'>;
  readonly eeg: Pick<UserProfile['eeg'], 'enabled' | 'preferredDevice'>;
};

// Derived from the shared write schema, so every value keeps its shared bounds.
const profilePatchSchema = z.strictObject({
  displayName: profileShape.displayName.optional(),
  avatar: profileShape.avatar.optional(),
  preferences: profileShape.preferences.partial().optional(),
  eeg: profileShape.eeg.pick({ enabled: true, preferredDevice: true }).partial().optional(),
});

/**
 * A field-level change. Only the fields present are written. Onboarding
 * completion and EEG consent have their own methods, because the server clock
 * stamps them.
 */
export type UserProfilePatch = z.input<typeof profilePatchSchema>;

const consentVersionSchema = profileShape.eeg.shape.consent.unwrap().shape.version;
const onboardingVersionSchema = profileShape.onboarding.shape.version;

export interface ProfileRepository {
  /** The signed-in user's profile: missing, readable, or unreadable (a legacy or newer-schema document). */
  getProfile(): Promise<DocumentRead<UserProfile>>;
  /** Creates the profile at sign-up. Awaiting `acknowledged` surfaces a refusal, such as a profile that already exists. */
  createProfile(draft: UserProfileDraft): PendingWrite;
  updateProfile(patch: UserProfilePatch): PendingWrite;
  completeOnboarding(version: number): PendingWrite;
  /** Records EEG consent for an approved consent-copy version, stamped by the server clock. */
  grantEegConsent(version: string): PendingWrite;
  /** Stops new EEG recordings. Deleting existing recordings is a separate, explicit step (eegRecordingRepository). */
  withdrawEegConsent(): PendingWrite;
}

function flattenPatch(patch: z.output<typeof profilePatchSchema>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.displayName !== undefined) fields.displayName = patch.displayName;
  if (patch.avatar !== undefined) fields.avatar = patch.avatar;
  for (const [key, value] of Object.entries(patch.preferences ?? {})) {
    if (value !== undefined) fields[`preferences.${key}`] = value;
  }
  for (const [key, value] of Object.entries(patch.eeg ?? {})) {
    if (value !== undefined) fields[`eeg.${key}`] = value;
  }
  return fields;
}

function parseOrThrow<T>(what: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ConsumerWriteValidationError(what, result.error.issues);
  return result.data;
}

export function createProfileRepository(context: ConsumerFirestoreContext): ProfileRepository {
  const { firestore } = context;

  function update(fields: Record<string, unknown>): PendingWrite {
    const ref = profileRef(firestore, signedInUid(context));
    const updatedAt: FieldValue = serverTimestamp();
    return pendingWrite(updateDoc(ref, { ...fields, updatedAt }));
  }

  return {
    async getProfile() {
      const snapshot = await getDoc(profileRef(firestore, signedInUid(context)));
      return readDocument('users', snapshot, (raw) => readUserProfile(raw));
    },

    createProfile(draft) {
      const ref = profileRef(firestore, signedInUid(context));
      const now = serverTimestamp();
      const profile = {
        schemaVersion: USER_PROFILE_SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,
        displayName: draft.displayName,
        avatar: draft.avatar,
        preferences: draft.preferences,
        onboarding: { version: draft.onboarding.version, completedAt: null },
        eeg: { enabled: draft.eeg.enabled, consent: null, preferredDevice: draft.eeg.preferredDevice },
      };
      assertValidWithServerClock('profile', userProfileWriteSchema, profile);
      return pendingWrite(setDoc(ref, profile));
    },

    updateProfile(patch) {
      const fields = flattenPatch(parseOrThrow('profile update', profilePatchSchema, patch));
      if (Object.keys(fields).length === 0) {
        throw new ConsumerWriteValidationError('profile update', [
          { code: 'custom', path: [], message: 'changes nothing', input: patch } as z.core.$ZodIssue,
        ]);
      }
      return update(fields);
    },

    completeOnboarding(version) {
      return update({
        'onboarding.version': parseOrThrow('onboarding version', onboardingVersionSchema, version),
        'onboarding.completedAt': serverTimestamp(),
      });
    },

    grantEegConsent(version) {
      const consentVersion = parseOrThrow('EEG consent version', consentVersionSchema, version);
      return update({ 'eeg.consent': { version: consentVersion, grantedAt: serverTimestamp() } });
    },

    withdrawEegConsent() {
      return update({ 'eeg.consent': null });
    },
  };
}
