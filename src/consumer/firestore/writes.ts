import { Timestamp } from 'firebase/firestore';
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

/** Keys a caller may not set, because the repository owns them (the path owner, the schema version, the server clock). */
export function assertNoReservedKeys(what: string, draft: object, reserved: readonly string[]): void {
  const present = reserved.filter((key) => Object.prototype.hasOwnProperty.call(draft, key));
  if (present.length > 0) {
    throw new ConsumerWriteValidationError(what, present.map((key) => ({
      code: 'custom', path: [key], message: 'is set by the repository, not the caller', input: undefined,
    }) as z.core.$ZodIssue));
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
