import { maxLevelOf, type GameModeDefinition } from '../games/definition';
import type { GameProgress } from '../schemas/progress';

/**
 * The highest start level a user may choose in `mode`. This is the one
 * function the start-level picker, the client preview and trusted scoring all
 * call. A missing progress document is passed as null.
 *
 * With no valid progress for the mode it returns `initiallyUnlockedStartLevel`.
 * Otherwise the mode's own `unlockPolicy` decides, and the result is clamped to
 * [initiallyUnlockedStartLevel, maxLevel]. It reads `bestPeakLevel`, never the
 * cached `progress.unlocked`, so a stale or forged cache cannot unlock anything.
 */
export function unlockedStartLevel(
  mode: GameModeDefinition,
  progress: Pick<GameProgress, 'bestPeakLevel'> | null,
): number {
  const bestPeakLevel = progress?.bestPeakLevel[mode.id];
  if (bestPeakLevel === undefined) return mode.initiallyUnlockedStartLevel;
  const maxLevel = maxLevelOf(mode);
  const earned = mode.unlockPolicy({ bestPeakLevel, maxLevel });
  return Math.max(mode.initiallyUnlockedStartLevel, Math.min(maxLevel, earned));
}
