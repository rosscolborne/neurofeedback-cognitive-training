import { classifyProgress, PROCESSING_REASONS, type GameProgress } from '@nfct/shared';
import { accountDeleted, progressRef, sessionsOf, type ProcessingContext } from './context';
import { ProcessingError } from './errors';
import { rebuildInTransaction } from './progress';

// The admin rebuild (card NFCT-19, design section F `rebuildUserAggregates`):
// replays one user's processed sessions of a game through the same reducer
// trusted scoring uses, from their stored trusted results, in session ID order
// (deterministic, never a device clock; the result does not depend on it).
// Never rescoring, never revalidating: rescoring stored trials is a
// deliberate, separate job (ADR-001 decision 8). Sessions without a result are
// skipped (re-drive them first). Deterministic, so it can be re-run. Used for
// repair and after an aggregateVersion change; trusted scoring does the same
// rebuild itself when it meets older progress.

export type RebuildReport = {
  readonly gameId: string;
  readonly progress: GameProgress | null;
  /** 'account-deleted': the user's deletion ledger exists, so nothing was written. */
  readonly written: 'set' | 'deleted' | 'unchanged' | 'account-deleted';
};

/**
 * Rebuilds progress/{gameId} for one user in one transaction (so no session is
 * processed half-way through it, and a session processed concurrently is
 * either in the rebuild or applied after it, never lost). Progress written by
 * newer code is refused, never overwritten; unreadable progress is replaced
 * (that is a repair). A user whose deletion ledger exists is left alone.
 */
export async function rebuildUserProgress(context: ProcessingContext, uid: string, gameId: string): Promise<RebuildReport> {
  if (!context.registry.current(gameId)) throw new ProcessingError(PROCESSING_REASONS.unknownGame, `no module for '${gameId}'`);
  return context.db.runTransaction(async (transaction) => {
    if (await accountDeleted(transaction, context.db, uid)) return { gameId, progress: null, written: 'account-deleted' as const };
    const ref = progressRef(context.db, uid, gameId);
    const stored = await transaction.get(ref);
    if (classifyProgress(stored.data(), gameId, context.registry).kind === 'newer') {
      throw new ProcessingError(PROCESSING_REASONS.progressNewerThanCode, `progress/${gameId} was written by newer code`);
    }
    const progress = await rebuildInTransaction(context, transaction, uid, gameId);
    if (progress !== null) {
      transaction.set(ref, progress);
      return { gameId, progress, written: 'set' as const };
    }
    if (stored.exists) {
      transaction.delete(ref);
      return { gameId, progress, written: 'deleted' as const };
    }
    return { gameId, progress, written: 'unchanged' as const };
  });
}

/** The games a user has sessions or progress for, that this build can rebuild. */
export async function rebuildableGames(context: ProcessingContext, uid: string): Promise<string[]> {
  const [sessions, progress] = await Promise.all([
    sessionsOf(context.db, uid).select('gameId').get(),
    context.db.collection('users').doc(uid).collection('progress').listDocuments(),
  ]);
  const games = new Set<string>(progress.map((ref) => ref.id));
  for (const document of sessions.docs) {
    const { gameId } = document.data();
    if (typeof gameId === 'string') games.add(gameId);
  }
  return [...games].filter((gameId) => context.registry.current(gameId) !== undefined).sort();
}
