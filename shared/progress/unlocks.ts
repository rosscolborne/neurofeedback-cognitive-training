import { maxLevelOf, type GameModeDefinition } from '../games/definition';
import type { GameProgress } from '../schemas/progress';

/**
 * The highest start level a user may choose in `mode`. This is the one
 * function the start-level picker, the client preview and trusted scoring all
 * call. A missing progress document is passed as null.
 *
 * It derives the level from `bestPeakLevel` and never reads the cached
 * `progress.unlocked`, so a stale or forged cache cannot unlock anything.
 * Mental Math endless (initial 1, 8 levels): min(8, max(1, bestPeakLevel - 1)).
 */
export function unlockedStartLevel(
  mode: GameModeDefinition,
  progress: Pick<GameProgress, 'bestPeakLevel'> | null,
): number {
  const best = progress?.bestPeakLevel[mode.id];
  if (best === undefined) return mode.initiallyUnlockedStartLevel;
  return Math.max(mode.initiallyUnlockedStartLevel, Math.min(maxLevelOf(mode), best - 1));
}
