import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronRight } from 'lucide-react';
import { mentalMath } from '@nfct/shared';
import { progressRepository } from '../../repositories';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { progressCardSummary } from './progressSummary';
import { ProvisionalTag } from './ProvisionalTag';
import { currentProgress } from './startLevel';
import './mentalMath.css';

// Mental Math's entry on the Progress tab (NFCT-22): a one-line summary of the
// game's progress that opens its records and history. Stage 1 per-game
// progress only; the Progress tab redesign is NFCT-13.

const numberFormat = new Intl.NumberFormat();

/** The card's Records button, which gets focus back when the game's progress closes. */
export const MENTAL_MATH_PROGRESS_CARD_BUTTON_ID = 'mm-progress-card-open';

export const MentalMathProgressCard: React.FC<{
  readonly onOpen: () => void;
  readonly progress?: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
}> = ({ onOpen, progress = progressRepository }) => {
  const [state, setState] = useState<ProgressWithRecentSessions | null | 'unavailable'>(null);

  useEffect(() => {
    const fail = () => setState('unavailable');
    let stop: () => void = () => {};
    try {
      stop = progress.subscribeToProgressWithRecentSessions(mentalMath.GAME_ID, {}, setState, fail);
    } catch {
      fail();
    }
    return () => stop();
  }, [progress]);

  const overview = useMemo(
    () => (state === null || state === 'unavailable' ? null : progressCardSummary(currentProgress(state))),
    [state],
  );
  const summary = state === 'unavailable' ? 'Your game progress couldn’t be loaded right now.'
    : overview === null ? 'Loading your game progress…'
      : `${overview.sessionsCompleted === 1 ? '1 run' : `${numberFormat.format(overview.sessionsCompleted)} runs`} completed · ${overview.unlocked} of ${overview.maxLevel} start levels unlocked`;

  return (
    <section className="mm-progress-card" aria-labelledby="mm-progress-card-title">
      <span className="mm-progress-card-icon" aria-hidden="true"><Calculator size={20} /></span>
      <div className="mm-progress-card-text">
        <h2 id="mm-progress-card-title" className="mm-progress-card-title">Mental Math</h2>
        <p className="mm-help" data-progress-card="summary">
          {summary}
          {overview?.provisional && <> <ProvisionalTag /></>}
        </p>
      </div>
      <button id={MENTAL_MATH_PROGRESS_CARD_BUTTON_ID} type="button" className="btn btn-ghost mm-link" onClick={onOpen} aria-label="Mental Math records and history">
        Records <ChevronRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
};
