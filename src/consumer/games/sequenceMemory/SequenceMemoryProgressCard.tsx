import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Grid3x3 } from 'lucide-react';
import { sequenceMemory } from '@nfct/shared';
import { progressRepository } from '../../repositories';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { subscribeWithRetry } from '../../firestore/retryingSubscription';
import { ProvisionalTag } from '../mentalMath/ProvisionalTag';
import { sequenceMemoryCardSummary } from './progressSummary';
import { currentProgress } from './runSummaryModel';
import '../mentalMath/mentalMath.css';

// Sequence Memory's entry on the Progress tab (NFCT-93): a one-line summary
// of the game's progress that opens its start screen. The game has no
// records-and-history view yet.

const numberFormat = new Intl.NumberFormat();

/** The card's Play button, which gets focus back when the game closes. */
export const SEQUENCE_MEMORY_PROGRESS_CARD_BUTTON_ID = 'sm-progress-card-open';

export const SequenceMemoryProgressCard: React.FC<{
  readonly onOpen: () => void;
  readonly progress?: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
}> = ({ onOpen, progress = progressRepository }) => {
  const [state, setState] = useState<ProgressWithRecentSessions | null | 'unavailable'>(null);

  useEffect(() => subscribeWithRetry<ProgressWithRecentSessions>(
    (onNext, onError) => progress.subscribeToProgressWithRecentSessions(sequenceMemory.GAME_ID, {}, onNext, onError),
    setState,
    () => setState('unavailable'),
  ), [progress]);

  const overview = useMemo(
    () => (state === null || state === 'unavailable' ? null : sequenceMemoryCardSummary(currentProgress(state))),
    [state],
  );
  const summary = state === 'unavailable' ? 'Your game progress couldn’t be loaded right now.'
    : overview === null ? 'Loading your game progress…'
      : `${overview.sessionsCompleted === 1 ? '1 run' : `${numberFormat.format(overview.sessionsCompleted)} runs`} completed · ${overview.unlocked} of ${overview.maxLevel} start levels unlocked`;

  return (
    <section className="mm-progress-card" aria-labelledby="sm-progress-card-title">
      <span className="mm-progress-card-icon" aria-hidden="true"><Grid3x3 size={20} /></span>
      <div className="mm-progress-card-text">
        <h2 id="sm-progress-card-title" className="mm-progress-card-title">Sequence Memory</h2>
        <p className="mm-help" data-progress-card="summary">
          {summary}
          {overview?.provisional && <> <ProvisionalTag /></>}
        </p>
      </div>
      <button id={SEQUENCE_MEMORY_PROGRESS_CARD_BUTTON_ID} type="button" className="btn btn-ghost mm-link" onClick={onOpen} aria-label="Play Sequence Memory">
        Play <ChevronRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
};
