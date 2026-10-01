import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase/firestore';
import { DomainReadError } from '@nfct/shared';
import { snapshotData } from './serverClock';

// Tolerant reads (ADR-001 decision 8). Every document goes through its shared
// read* mapper. A document the mapper cannot read (DomainReadError, for
// example a newer schemaVersion, or a value the rules accept but the reader
// does not) is reported as unreadable, never thrown: one bad document must
// not break a screen. Any other error is a bug and still throws.

/** Where a read came from. */
export interface SnapshotState {
  /** Served from the local cache (offline, or before the server answered). */
  readonly fromCache: boolean;
  /**
   * The document has local writes the server has not acknowledged yet, so its
   * server-clock fields hold local estimates.
   */
  readonly hasPendingWrites: boolean;
}

export interface UnreadableDocument {
  readonly id: string;
  readonly error: DomainReadError;
}

export type DocumentRead<T> =
  | ({ readonly status: 'missing'; readonly id: string } & SnapshotState)
  | ({ readonly status: 'readable'; readonly id: string; readonly data: T } & SnapshotState)
  | ({ readonly status: 'unreadable'; readonly id: string; readonly error: DomainReadError } & SnapshotState);

export type Mapper<T> = (raw: Record<string, unknown>, id: string) => T;

function tryRead<T>(raw: Record<string, unknown>, id: string, map: Mapper<T>): { data: T } | { error: DomainReadError } {
  try {
    return { data: map(raw, id) };
  } catch (error) {
    if (error instanceof DomainReadError) return { error };
    throw error;
  }
}

function warnUnreadable(collectionName: string, unreadable: readonly UnreadableDocument[]): void {
  if (unreadable.length === 0) return;
  // IDs and reasons only, for support; never document contents.
  console.warn(`Skipped ${unreadable.length} unreadable ${collectionName} document(s)`,
    unreadable.map(({ id, error }) => ({ id, reason: error.message })));
}

export function readDocument<T>(collectionName: string, snapshot: DocumentSnapshot, map: Mapper<T>): DocumentRead<T> {
  const state: SnapshotState = {
    fromCache: snapshot.metadata.fromCache,
    hasPendingWrites: snapshot.metadata.hasPendingWrites,
  };
  const raw = snapshotData(snapshot);
  if (raw === undefined) return { status: 'missing', id: snapshot.id, ...state };
  const read = tryRead(raw, snapshot.id, map);
  if ('error' in read) {
    warnUnreadable(collectionName, [{ id: snapshot.id, error: read.error }]);
    return { status: 'unreadable', id: snapshot.id, error: read.error, ...state };
  }
  return { status: 'readable', id: snapshot.id, data: read.data, ...state };
}

export interface DocumentsRead<T> {
  readonly readable: T[];
  readonly unreadable: UnreadableDocument[];
}

/** Maps query results in order, skipping (and reporting) unreadable documents. */
export function readDocuments<T>(
  collectionName: string,
  snapshots: readonly QueryDocumentSnapshot[],
  map: (raw: Record<string, unknown>, snapshot: QueryDocumentSnapshot) => T,
): DocumentsRead<T> {
  const readable: T[] = [];
  const unreadable: UnreadableDocument[] = [];
  for (const snapshot of snapshots) {
    const read = tryRead(snapshotData(snapshot) ?? {}, snapshot.id, (raw) => map(raw, snapshot));
    if ('error' in read) unreadable.push({ id: snapshot.id, error: read.error });
    else readable.push(read.data);
  }
  warnUnreadable(collectionName, unreadable);
  return { readable, unreadable };
}
