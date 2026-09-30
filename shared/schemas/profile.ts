import { z } from 'zod';
import { boundedTextSchema, compareTimestamps, nonNegativeIntSchema, timestampSchema } from '../primitives';
import { eegDeviceModelSchema } from './eegRecording';
import { readVersioned } from './read';

// users/{uid}: the consumer profile. Email and sign-in provider stay in
// Firebase Auth and are not copied here. There is no role.

export const USER_PROFILE_SCHEMA_VERSION = 1;

const weeklyGoalSchema = z.strictObject({
  kind: z.enum(['sessions', 'minutes', 'activeDays']),
  target: z.int().min(1).max(10_080),
}).refine((goal) => goal.kind !== 'activeDays' || goal.target <= 7, {
  path: ['target'],
  message: 'activeDays cannot exceed 7',
});

const userProfileV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  displayName: boundedTextSchema(40).nullable(),
  avatar: z.strictObject({
    kind: z.literal('preset'),
    presetId: boundedTextSchema(40),
  }).nullable(),
  preferences: z.strictObject({
    /** IANA zone; drives daily buckets. */
    timezone: boundedTextSchema(64),
    soundEnabled: z.boolean(),
    hapticsEnabled: z.boolean(),
    weeklyGoal: weeklyGoalSchema.nullable(),
  }),
  onboarding: z.strictObject({
    version: nonNegativeIntSchema,
    completedAt: timestampSchema.nullable(),
  }),
  eeg: z.strictObject({
    /** Shows EEG features. Play never requires a headset. */
    enabled: z.boolean(),
    /** Required before any EEG recording is written. */
    consent: z.strictObject({
      version: boundedTextSchema(40),
      grantedAt: timestampSchema,
    }).nullable(),
    preferredDevice: z.strictObject({ model: eegDeviceModelSchema }).nullable(),
  }),
}).refine((profile) => compareTimestamps(profile.updatedAt, profile.createdAt) >= 0, {
  path: ['updatedAt'],
  message: 'updatedAt cannot precede createdAt',
});

export const userProfileSchema = userProfileV1Schema;
export type UserProfile = z.infer<typeof userProfileSchema>;

export function readUserProfile(raw: unknown): UserProfile {
  return readVersioned('users', raw, { 1: userProfileV1Schema });
}
