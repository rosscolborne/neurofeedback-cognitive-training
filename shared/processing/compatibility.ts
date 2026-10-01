import {
  GAME_PROGRESS_SCHEMA_VERSION,
  PROGRESS_AGGREGATE_VERSION,
  readGameProgress,
  type GameProgress,
} from '../schemas/progress';
import { DomainReadError } from '../schemas/read';
import type { GameModuleRegistry } from './registry';

// Aggregate compatibility (NFCT-19): may this build apply a session to the
// stored progress of a game? Pure, so trusted scoring and a client preview
// classify progress the same way.
//
// - 'current': the same aggregateVersion, and a gameVersion no newer than this
//   build's newest registered module: apply (a missing document is current
//   and null).
// - 'older': an older aggregateVersion. Trusted scoring rebuilds it from the
//   stored trusted results (never rescoring), then applies.
// - 'newer': a newer schemaVersion, aggregateVersion or gameVersion than this
//   build knows, written by newer code (a rollback or a mixed deploy). Never
//   written by this build: trusted scoring retries the session, then marks it
//   processing.state = 'failed' ('progress-newer-than-code') for newer code to
//   re-drive; a client preview declines to preview.
// - 'unreadable': not newer, but not readable either. Trusted scoring marks
//   the session failed ('progress-unreadable'); the admin rebuild replaces it.
//
// Versions are compared before the shape is read: newer code may have written
// a shape this build cannot read, and that must never look repairable.

export type ProgressCompatibility =
  | { readonly kind: 'current'; readonly progress: GameProgress | null }
  | { readonly kind: 'older'; readonly progress: GameProgress }
  | { readonly kind: 'newer' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** Classifies the stored progress of `gameId` (`undefined` when there is no document). */
export function classifyProgress(raw: unknown, gameId: string, registry: GameModuleRegistry): ProgressCompatibility {
  if (raw === undefined) return { kind: 'current', progress: null };
  const current = registry.current(gameId);
  if (!current) return { kind: 'unreadable', detail: `no module for '${gameId}'` };
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
