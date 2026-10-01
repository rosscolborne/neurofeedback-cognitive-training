import type { Transaction } from 'firebase-admin/firestore';
import {
  DomainReadError,
  PROCESSING_REASONS,
  readSessionProgressFields,
  rebuildProgress,
  SESSION_PROGRESS_FIELDS,
  type GameProgress,
  type ProgressCompatibility,
  type StoredGameSession,
} from '@nfct/shared';
import { sessionsOf, type ProcessingContext } from './context';
import { ProcessingError } from './errors';

// Aggregate compatibility (NFCT-19). The classification is the shared, pure
// classifyProgress (shared/processing/compatibility.ts); this decides what
// trusted scoring does with each kind:
// - current: apply;
// - older aggregateVersion: rebuild it from the stored trusted results
//   (never rescoring) inside the processing transaction, then apply;
// - newer schemaVersion, aggregateVersion or gameVersion than this build
//   knows (a rollback or a mixed deploy): never write it. The session is
//   retried, and marked failed ('progress-newer-than-code') after the retry
//   window, for newer code to re-drive;
// - unreadable: failed ('progress-unreadable'); the admin rebuild repairs it.

/** The progress to apply a session to, or a ProcessingError when this build must not write it. */
export function applicableProgress(state: ProgressCompatibility, gameId: string): GameProgress | null | 'rebuild' {
  switch (state.kind) {
    case 'current':
      return state.progress;
    case 'older':
      return 'rebuild';
    case 'newer':
      throw new ProcessingError(PROCESSING_REASONS.progressNewerThanCode, `progress/${gameId} was written by newer code`);
    case 'unreadable':
      throw new ProcessingError(PROCESSING_REASONS.progressUnreadable, `progress/${gameId} cannot be read: ${state.detail}`);
  }
}

/**
 * Rebuilds one game's progress inside `transaction` from the user's stored
 * trusted results (rebuildProgress: stored results, never rescoring, replayed
 * in a fixed order the result does not depend on; sessions without a result
 * are skipped). It reads every session
 * of the game through a projection of the fields progress depends on, so no
 * trials are loaded (about 1 KB per session), and the transaction holds them
 * all, so no session can be processed concurrently with the rebuild.
 *
 * Limit: the read grows with the user's history of the game. It runs only
 * when the aggregate version changes (or the admin rebuild script runs); a
 * very long history would need a paged rebuild (follow-up).
 */
export async function rebuildInTransaction(
  context: ProcessingContext,
  transaction: Transaction,
  uid: string,
  gameId: string,
): Promise<GameProgress | null> {
  const current = context.registry.current(gameId);
  if (!current) throw new ProcessingError(PROCESSING_REASONS.internalError, `no module for '${gameId}'`);
  const snapshot = await transaction.get(
    sessionsOf(context.db, uid).where('gameId', '==', gameId).select(...SESSION_PROGRESS_FIELDS),
  );
  const stored: StoredGameSession[] = [];
  for (const document of snapshot.docs) {
    const data = document.data();
    if (data.result === undefined) continue;
    try {
      stored.push({ id: document.id, session: readSessionProgressFields(data) });
    } catch (error) {
      // An invalid session counts nowhere, so its envelope does not matter.
      if (error instanceof DomainReadError && (data.result as { validity?: unknown }).validity === 'invalid') continue;
      throw new ProcessingError(PROCESSING_REASONS.sessionUnreadable, `session ${document.id} cannot be read for a rebuild`);
    }
  }
  return rebuildProgress(current.definition, stored, context.now());
}
