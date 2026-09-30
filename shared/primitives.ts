import { z } from 'zod';

// Shared value types for every consumer document. See
// docs/nfct/adr-001-consumer-domain-model.md.

/**
 * Writes of the current schema are strict and reject unknown fields. Reads are
 * tolerant: they drop fields added by a newer compatible writer (adding an
 * optional field does not bump schemaVersion) and keep what they understand.
 */
export type SchemaMode = 'write' | 'read';

export function objectSchema<const S extends z.core.$ZodShape>(mode: SchemaMode, shape: S): z.ZodObject<S> {
  return (mode === 'write' ? z.strictObject(shape) : z.object(shape)) as z.ZodObject<S>;
}

/**
 * The structural shape shared by the web SDK's and the Admin SDK's Firestore
 * `Timestamp`, so this package never imports either SDK.
 */
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toMillis(): number;
}

function isFirestoreTimestamp(value: unknown): value is FirestoreTimestamp {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<FirestoreTimestamp>;
  return Number.isInteger(candidate.seconds)
    && Number.isInteger(candidate.nanoseconds)
    && (candidate.nanoseconds as number) >= 0
    && (candidate.nanoseconds as number) < 1_000_000_000
    && typeof candidate.toMillis === 'function';
}

export const timestampSchema = z.custom<FirestoreTimestamp>(isFirestoreTimestamp, {
  message: 'Expected a Firestore Timestamp',
});

/** Orders two timestamps without the precision loss of `toMillis()`. */
export function compareTimestamps(a: FirestoreTimestamp, b: FirestoreTimestamp): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}

/** A Firebase Auth uid: 1-128 characters, never a path separator. */
export const uidSchema = z.string().min(1).max(128).regex(/^[^/]+$/);

/** A client-generated document ID (game sessions, EEG recordings). */
export const documentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Stable kebab-case identifier for games and modes: never renamed or reused. */
export const slugIdSchema = z.string().max(40).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

/** 'YYYY-MM-DD' in the user's zone when the session started. */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Expected a real calendar date');

/** Non-empty text with no leading or trailing whitespace (mirrors the rules' `boundedText`). */
export function boundedTextSchema(max: number) {
  return z.string().min(1).max(max).regex(/^\S(?:.*\S)?$/);
}

export const nonNegativeIntSchema = z.int().min(0);
export const positiveIntSchema = z.int().min(1);
export const fractionSchema = z.number().min(0).max(1);
