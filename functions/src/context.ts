import { Timestamp, type CollectionReference, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { GAME_MODULE_REGISTRY, type GameModuleRegistry } from '@nfct/shared';
import { PROCESSING_LIMITS, type ProcessingLimits } from './policy';

// What the processing core needs from its environment. The trigger passes the
// deployed defaults; tests and the admin scripts pass an emulator Firestore,
// a fixed clock or a registry with extra modules.

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ProcessingContext {
  readonly db: Firestore;
  readonly registry: GameModuleRegistry;
  /** Server clock. Every trusted timestamp (processedAt, updatedAt) comes from here. */
  readonly now: () => Timestamp;
  readonly log: Logger;
  readonly limits: ProcessingLimits;
}

export function processingContext(
  db: Firestore,
  overrides: Partial<Omit<ProcessingContext, 'db' | 'limits'>> & { readonly limits?: Partial<ProcessingLimits> } = {},
): ProcessingContext {
  return {
    db,
    registry: overrides.registry ?? GAME_MODULE_REGISTRY,
    now: overrides.now ?? (() => Timestamp.now()),
    log: overrides.log ?? consoleLogger,
    limits: { ...PROCESSING_LIMITS, ...overrides.limits },
  };
}

export const consoleLogger: Logger = {
  info: (message, fields) => console.info(message, fields ?? {}),
  warn: (message, fields) => console.warn(message, fields ?? {}),
  error: (message, fields) => console.error(message, fields ?? {}),
};

// Paths. Trusted scoring reads and writes only the user's own sessions and
// progress, reads the user's deletion ledger, and never reads eegRecordings.

export function sessionsOf(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('gameSessions');
}

export function sessionRef(db: Firestore, uid: string, sessionId: string): DocumentReference {
  return sessionsOf(db, uid).doc(sessionId);
}

export function progressRef(db: Firestore, uid: string, gameId: string): DocumentReference {
  return db.collection('users').doc(uid).collection('progress').doc(gameId);
}

/** The account-deletion ledger (ADR-001 decision 7): top level, written before any user data is deleted. */
export function deletionLedgerRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('accountDeletions').doc(uid);
}

/**
 * Whether the user's account is being (or was) deleted. Every transaction that
 * writes a session, progress or processing metadata reads this first and
 * writes nothing when the ledger exists, so trusted scoring never recreates
 * data a deletion is removing. The read is part of the transaction, so a
 * ledger written before the transaction commits either aborts it or is seen
 * by it: as long as the deletion writes the ledger before it deletes the
 * user's data (decision 7), no processing commit can land after the delete
 * has listed the documents it removes.
 */
export async function accountDeleted(transaction: Transaction, db: Firestore, uid: string): Promise<boolean> {
  return (await transaction.get(deletionLedgerRef(db, uid))).exists;
}
