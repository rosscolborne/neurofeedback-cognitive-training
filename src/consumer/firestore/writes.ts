import { FirestoreError, getDocFromCache, Timestamp, type DocumentReference } from 'firebase/firestore';
import type { z } from 'zod';
import { withServerClockAt } from './serverClock';

/**
 * A write the SDK has applied to the local cache and queued for the server.
 * The repositories return one as soon as the write is queued, so the app keeps
 * working offline instead of waiting for the network.
 */
export interface PendingWrite {
  /**
   * Resolves when the server accepts the write and rejects if it refuses it
   * (for example `permission-denied`). Offline it stays pending while the SDK
   * retries; with the persistent cache the queued write also survives an app
   * restart. Never retry a refused write: the SDK already retries transient
   * failures, so a refusal is permanent.
   */
  readonly acknowledged: Promise<void>;
}

export function pendingWrite(commit: Promise<void>): PendingWrite {
  // The caller may never await it; a refusal must not become an unhandled rejection.
  commit.catch(() => undefined);
  return { acknowledged: commit };
}

/**
 * Resolves once a write the caller has just issued for `reference` has been
 * applied to the local cache: with the persistent cache, stored in IndexedDB,
 * so it survives a reload or a closed tab. `setDoc` only hands the write to
 * the SDK's queue; this cache read joins the same queue behind it, so it
 * settles after the write is stored. It never waits on the network. Only the
 * ordering matters: if the read itself fails (for example the instance was
 * terminated by a sign-out), the write's own promise reports what happened.
 */
export async function localWriteApplied(reference: DocumentReference): Promise<void> {
  try {
    await getDocFromCache(reference);
  } catch {
    // See above: the read is a barrier, not a check.
  }
}

/** A write the repository refused before sending it: it would break the shared schema or the rules. */
export class ConsumerWriteValidationError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(what: string, issues: readonly z.core.$ZodIssue[]) {
    const detail = issues.slice(0, 5)
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(document)'}: ${issue.message}`)
      .join('; ');
    super(`Refusing to write an invalid ${what}: ${detail}`);
    this.name = 'ConsumerWriteValidationError';
    this.issues = issues;
  }
}

function customIssue(path: readonly PropertyKey[], message: string): z.core.$ZodIssue {
  return { code: 'custom', path: [...path], message, input: undefined } as z.core.$ZodIssue;
}

/** Keys a caller may not set, because the repository owns them (the path owner, the schema version, the server clock). */
export function assertNoReservedKeys(what: string, draft: object, reserved: readonly string[]): void {
  const present = reserved.filter((key) => Object.prototype.hasOwnProperty.call(draft, key));
  if (present.length > 0) {
    throw new ConsumerWriteValidationError(what, present.map((key) => customIssue([key], 'is set by the repository, not the caller')));
  }
}

/**
 * Validates a write that holds serverTimestamp() sentinels against a shared
 * strict write schema, as the document the server will store (each sentinel
 * read as one server instant). Throws instead of writing an invalid document.
 */
export function assertValidWithServerClock(what: string, schema: z.ZodType, write: unknown): void {
  const result = schema.safeParse(withServerClockAt(write, Timestamp.now()));
  if (!result.success) throw new ConsumerWriteValidationError(what, result.error.issues);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** The paths of every property or array element explicitly set to `undefined`. */
export function undefinedPaths(value: unknown, path: readonly (string | number)[] = []): (string | number)[][] {
  if (value === undefined) return [[...path]];
  if (Array.isArray(value)) return value.flatMap((item, index) => undefinedPaths(item, [...path, index]));
  if (isPlainObject(value)) return Object.entries(value).flatMap(([key, item]) => undefinedPaths(item, [...path, key]));
  return [];
}

/**
 * The shared schemas accept an optional field set to `undefined`, but the web
 * SDK refuses to write one (it throws `invalid-argument` when the write is
 * built). This refuses such a write as a validation error instead. The app's
 * Firestore keeps the SDK default rather than `ignoreUndefinedProperties`,
 * which would change every inherited write too.
 */
export function assertNoUndefined(what: string, write: unknown): void {
  const paths = undefinedPaths(write);
  if (paths.length > 0) {
    throw new ConsumerWriteValidationError(what, paths.map((path) => customIssue(path, 'is undefined; omit the field instead')));
  }
}

/** Runs a synchronous SDK write step, reporting data the SDK refuses as a validation error. */
export function withSdkValidation<T>(what: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    if (error instanceof FirestoreError && error.code === 'invalid-argument') {
      throw new ConsumerWriteValidationError(what, [customIssue([], error.message)]);
    }
    throw error;
  }
}
