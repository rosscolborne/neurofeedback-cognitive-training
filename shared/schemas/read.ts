import { z } from 'zod';

/** A stored document that no supported schema version can read. */
export class DomainReadError extends Error {
  readonly collection: string;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(collection: string, message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(`Cannot read ${collection} document: ${message}`);
    this.name = 'DomainReadError';
    this.collection = collection;
    this.issues = issues;
  }
}

/**
 * Validates raw document data against the reader for its `schemaVersion`.
 * Each reader upcasts its version to the current shape, so callers only ever
 * see the current type.
 */
export function readVersioned<T>(
  collection: string,
  raw: unknown,
  readers: Readonly<Record<number, z.ZodType<T>>>,
): T {
  const version = typeof raw === 'object' && raw !== null
    ? (raw as { schemaVersion?: unknown }).schemaVersion
    : undefined;
  const reader = typeof version === 'number' ? readers[version] : undefined;
  if (!reader) throw new DomainReadError(collection, `unsupported schemaVersion ${String(version)}`);
  const result = reader.safeParse(raw);
  if (!result.success) throw new DomainReadError(collection, z.prettifyError(result.error), result.error.issues);
  return result.data;
}
