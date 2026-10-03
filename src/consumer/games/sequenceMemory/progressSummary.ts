import { maxLevelOf, unlockedStartLevel, type GameProgress } from '@nfct/shared';
import { previewMode, type CurrentProgress } from '../common/startLevel';
import { SEQUENCE_MEMORY } from './runSummaryModel';

// Sequence Memory's one-line progress on the Progress tab (NFCT-93), as a pure view model.

export interface SequenceMemoryCardSummary {
  readonly sessionsCompleted: number;
  readonly unlocked: number;
  readonly maxLevel: number;
  /** The numbers count a run trusted scoring has not checked yet. */
  readonly provisional: boolean;
}

export function sequenceMemoryCardSummary(current: CurrentProgress): SequenceMemoryCardSummary {
  const mode = previewMode(SEQUENCE_MEMORY);
  const of = (progress: GameProgress | null) => ({ completed: progress?.sessionsCompleted ?? 0, unlocked: unlockedStartLevel(mode, progress) });
  const shown = of(current.progress);
  const checked = of(current.checked);
  return {
    sessionsCompleted: shown.completed,
    unlocked: shown.unlocked,
    maxLevel: maxLevelOf(mode),
    provisional: shown.completed !== checked.completed || shown.unlocked !== checked.unlocked,
  };
}
