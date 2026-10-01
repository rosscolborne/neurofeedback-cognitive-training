import { FieldValue, serverTimestamp, Timestamp, type SnapshotOptions } from 'firebase/firestore';
import { z } from 'zod';

// Server-clock fields. The rules require createdAt, updatedAt and a newly
// granted consent's grantedAt to equal request.time, so the client writes the
// SDK's serverTimestamp() sentinel for them. shared/ never imports the SDK, so
// this module is where the sentinel meets the shared schemas.

export function isServerTimestamp(value: unknown): value is FieldValue {
  return value instanceof FieldValue && value.isEqual(serverTimestamp());
}

/** Accepts only the SDK's serverTimestamp() sentinel. */
export const serverTimestampSchema = z.custom<FieldValue>(isServerTimestamp, 'Expected serverTimestamp()');

/**
 * Snapshot options for consumer reads. A document written on this device and
 * not yet acknowledged (for example a session played offline) still holds
 * serverTimestamp() sentinels locally. By default they read as null, which the
 * strict timestamp read schemas reject; 'estimate' reads them as the local
 * write time instead, so a just-played session is readable at once.
 * `hasPendingWrites` on the read tells the caller the value is an estimate.
 */
export const CONSUMER_SNAPSHOT_OPTIONS: SnapshotOptions = { serverTimestamps: 'estimate' };

interface SnapshotLike {
  data(options?: SnapshotOptions): Record<string, unknown> | undefined;
  readonly metadata: { readonly hasPendingWrites: boolean };
}

function compareSdkTimestamps(a: Timestamp, b: Timestamp): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}

/**
 * For each pending server timestamp, the later of its local estimate and its
 * previous server value. Only pending server timestamps differ between the two
 * reads, so every other value is the estimate read's.
 */
function laterOf(estimate: unknown, previous: unknown): unknown {
  if (estimate instanceof Timestamp && previous instanceof Timestamp) {
    return compareSdkTimestamps(estimate, previous) >= 0 ? estimate : previous;
  }
  if (isPlainObject(estimate) && isPlainObject(previous)) {
    return Object.fromEntries(Object.entries(estimate).map(([key, value]) => [key, laterOf(value, previous[key])]));
  }
  return estimate;
}

/**
 * A document's data for the shared read mappers. A document with no pending
 * writes reads as stored. For one with pending writes, each serverTimestamp()
 * field reads as the later of the local estimate and the field's previous
 * server value. The local estimate alone can precede values the server has
 * already stamped (the device clock may be behind, and the SDK's estimate can
 * be coarser than the server's), which would make, for example, a profile
 * updated offline fail the reader's `updatedAt >= createdAt` check and read as
 * unreadable. The server always stamps a time at or after its earlier stamps.
 */
export function snapshotData(snapshot: SnapshotLike): Record<string, unknown> | undefined {
  const estimate = snapshot.data(CONSUMER_SNAPSHOT_OPTIONS);
  if (estimate === undefined || !snapshot.metadata.hasPendingWrites) return estimate;
  return laterOf(estimate, snapshot.data({ serverTimestamps: 'previous' })) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function looksLikeTimestamp(value: unknown): value is { seconds: number; nanoseconds: number; toMillis(): number } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { seconds?: unknown; nanoseconds?: unknown; toMillis?: unknown };
  return Number.isInteger(candidate.seconds) && Number.isInteger(candidate.nanoseconds)
    && typeof candidate.toMillis === 'function';
}

/**
 * Replaces every serverTimestamp() sentinel in a write with `at`, so a shared
 * `*WriteSchema` can validate the document the server will store. The write
 * itself keeps the sentinels.
 */
export function withServerClockAt(value: unknown, at: Timestamp): unknown {
  if (isServerTimestamp(value)) return at;
  if (Array.isArray(value)) return value.map((item) => withServerClockAt(item, at));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withServerClockAt(item, at)]));
  }
  return value;
}

/**
 * The shared schemas accept any structural Firestore timestamp, but the web SDK
 * stores only its own `Timestamp` class as a timestamp: any other object would
 * be written as a map, which the rules refuse. This converts every structural
 * timestamp in a validated write into an SDK `Timestamp` of the same instant.
 */
export function toSdkTimestamps<T>(value: T): T {
  if (value instanceof Timestamp || value instanceof FieldValue) return value;
  if (looksLikeTimestamp(value)) return new Timestamp(value.seconds, value.nanoseconds) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => toSdkTimestamps(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSdkTimestamps(item)])) as T;
  }
  return value;
}
