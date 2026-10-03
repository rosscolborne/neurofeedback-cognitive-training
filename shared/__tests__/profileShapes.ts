// The shapes a player's profile document (users/{uid}) has had, and what this
// app does with each. Every new-account test writes the current shape, so an
// existing account in an older or newer shape is tested only through these:
// - the emulator browser fixtures seed accounts from them
//   (seedAccountWithProfileShape in e2e/helpers/localEmulator.ts);
// - the read-only nfct-dev audit (functions/scripts/profileShapeAudit.ts) is
//   tested against them, so its verdict on a shape is the app's.
// When the audit finds real documents that no shape here covers, add one.
// No Firebase SDK here: callers pass the timestamp to store (a server
// timestamp, an Admin SDK Timestamp or TestTimestamp).

export type ProfileShapeName = 'current' | 'legacy-signup' | 'future-version';

export type ProfileShapeInput = {
  readonly displayName: string;
  readonly email: string;
  /** The value stored as createdAt and updatedAt where the shape uses Firestore timestamps. */
  readonly now: unknown;
};

export type ProfileShape = {
  /**
   * `readable`: the account opens. `unreadable`: the app says this version
   * cannot open the account, offers only sign-out, and never overwrites the
   * document.
   */
  readonly appReads: 'readable' | 'unreadable';
  readonly description: string;
  readonly build: (input: ProfileShapeInput) => Record<string, unknown>;
};

function currentProfile({ displayName, now }: ProfileShapeInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    displayName,
    avatar: null,
    preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: true, weeklyGoal: null },
    onboarding: { version: 1, completedAt: null },
    eeg: { enabled: false, consent: null, preferredDevice: null },
  };
}

export const PROFILE_SHAPES: Readonly<Record<ProfileShapeName, ProfileShape>> = {
  current: {
    appReads: 'readable',
    description: 'the consumer profile (schemaVersion 1), as this app creates it',
    build: currentProfile,
  },
  'legacy-signup': {
    appReads: 'unreadable',
    description: 'the inherited sign-up document from before Phase 2: no schemaVersion, a role and the email, ISO-string dates; every nfct-dev account had it when Phase 2 merged',
    build: ({ displayName, email }) => {
      const createdAt = new Date().toISOString();
      return { email, displayName, createdAt, role: 'patient', updatedAt: createdAt };
    },
  },
  'future-version': {
    appReads: 'unreadable',
    description: 'a profile written by a newer app version (schemaVersion 2), which this version must neither read nor overwrite',
    build: (input) => ({ ...currentProfile(input), schemaVersion: 2 }),
  },
};

export const PROFILE_SHAPE_NAMES = Object.keys(PROFILE_SHAPES) as ProfileShapeName[];
