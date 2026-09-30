import type { Transaction } from 'firebase-admin/firestore';
import {
  DomainReadError,
  GAME_PROGRESS_SCHEMA_VERSION,
  PROCESSING_REASONS,
  PROGRESS_AGGREGATE_VERSION,
  readGameProgress,
  readSessionProgressFields,
  rebuildProgress,
  SESSION_PROGRESS_FIELDS,
  type GameModuleRegistry,
  type GameProgress,
  type StoredGameSession,
} from '@nfct/shared';
import { sessionsOf, type ProcessingContext } from './context';
import { ProcessingError } from './errors';

// Aggregate compatibility (NFCT-19). Trusted scoring applies a session only to
// progress this build's reducer maintains:
// - same aggregateVersion, gameVersion no newer than this build's newest
//   module: apply;
// - older aggregateVersion: rebuild it from the stored trusted results
//   (never rescoring), then apply;
// - newer schemaVersion, aggregateVersion or gameVersion than this build
//   knows (a rollback or a mixed deploy): never write it. The session is
//   retried, and marked failed ('progress-newer-than-code') after the retry
//   window, for newer code to re-drive.

export type ProgressState =
  | { readonly kind: 'current'; readonly progress: GameProgress | null }
  | { readonly kind: 'older'; readonly progress: GameProgress }
  | { readonly kind: 'newer' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** Classifies the stored progress of `gameId` (undefined when there is no document). */
export function classifyProgress(raw: unknown, gameId: string, registry: GameModuleRegistry): ProgressState {
  if (raw === undefined) return { kind: 'current', progress: null };
  const current = registry.current(gameId);
  if (!current) return { kind: 'unreadable', detail: `no module for '${gameId}'` };
  // Versions are compared before the shape is read: newer code may have
  // written a shape this build cannot read, and it must still never be
  // treated as repairable.
  const versions = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const newer = (value: unknown, known: number) => typeof value === 'number' && value > known;
  if (newer(versions.schemaVersion, GAME_PROGRESS_SCHEMA_VERSION)
    || newer(versions.aggregateVersion, PROGRESS_AGGREGATE_VERSION)
    || newer(versions.gameVersion, current.gameVersion)) {
    return { kind: 'newer' };
  }
  let progress: GameProgress;
  try {
    progress = readGameProgress(raw);
  } catch (error) {
    if (error instanceof DomainReadError) return { kind: 'unreadable', detail: error.message };
    throw error;
  }
  if (progress.gameId !== gameId) return { kind: 'unreadable', detail: `progress is not for '${gameId}'` };
  if (progress.aggregateVersion < PROGRESS_AGGREGATE_VERSION) return { kind: 'older', progress };
  return { kind: 'current', progress };
}

/** The progress to apply a session to, or a ProcessingError when this build must not write it. */
export function applicableProgress(state: ProgressState, gameId: string): GameProgress | null | 'rebuild' {
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
 * trusted results (rebuildProgress: play order, stored results, never
 * rescoring; sessions without a result are skipped). It reads every session
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
