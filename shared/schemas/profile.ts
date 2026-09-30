import { z } from 'zod';
import {
  boundedTextSchema,
  compareTimestamps,
  nonNegativeIntSchema,
  objectSchema,
  timestampSchema,
  type SchemaMode,
} from '../primitives';
import { eegDeviceModelSchema } from './eegRecording';
import { readVersioned } from './read';

// users/{uid}: the consumer profile. Email and sign-in provider stay in
// Firebase Auth and are not copied here. There is no role.

export const USER_PROFILE_SCHEMA_VERSION = 1;

function userProfileSchemaFor(mode: SchemaMode) {
  const weeklyGoalSchema = objectSchema(mode, {
    kind: z.enum(['sessions', 'minutes', 'activeDays']),
    target: z.int().min(1).max(10_080),
  }).refine((goal) => goal.kind !== 'activeDays' || goal.target <= 7, {
    path: ['target'],
    message: 'activeDays cannot exceed 7',
  });

  return objectSchema(mode, {
    schemaVersion: z.literal(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    displayName: boundedTextSchema(40).nullable(),
    avatar: objectSchema(mode, {
      kind: z.literal('preset'),
      presetId: boundedTextSchema(40),
    }).nullable(),
    preferences: objectSchema(mode, {
      /** IANA zone; drives daily buckets. */
      timezone: boundedTextSchema(64),
      soundEnabled: z.boolean(),
      hapticsEnabled: z.boolean(),
      weeklyGoal: weeklyGoalSchema.nullable(),
    }),
    onboarding: objectSchema(mode, {
      version: nonNegativeIntSchema,
      completedAt: timestampSchema.nullable(),
    }),
    eeg: objectSchema(mode, {
      /** Shows EEG features. Play never requires a headset. */
      enabled: z.boolean(),
      /** Required before any EEG recording is written. */
      consent: objectSchema(mode, {
        version: boundedTextSchema(40),
        grantedAt: timestampSchema,
      }).nullable(),
      preferredDevice: objectSchema(mode, { model: eegDeviceModelSchema }).nullable(),
    }),
  }).refine((profile) => compareTimestamps(profile.updatedAt, profile.createdAt) >= 0, {
    path: ['updatedAt'],
    message: 'updatedAt cannot precede createdAt',
  });
}

/** Current schema, strict: what a client may write. */
export const userProfileWriteSchema = userProfileSchemaFor('write');
/** Tolerant of fields added by newer compatible writers. */
export const userProfileReadSchema = userProfileSchemaFor('read');
export type UserProfile = z.infer<typeof userProfileWriteSchema>;

export function readUserProfile(raw: unknown): UserProfile {
  return readVersioned('users', raw, { 1: userProfileReadSchema });
}
