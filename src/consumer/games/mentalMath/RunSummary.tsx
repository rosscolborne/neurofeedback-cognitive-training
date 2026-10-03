import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, LockOpen, Trophy } from 'lucide-react';
import { mentalMath } from '@nfct/shared';
import { FactGrid } from '../../../components/ui/FactGrid';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { subscribeWithRetry } from '../../firestore/retryingSubscription';
import { formatPlayTime } from './progressSummary';
import type { RunOutcome } from './runController';
import { eegMessage, saveMessage, type EegInfo, type SaveState } from '../common/runSave';
import {
  runSummary,
  type RecordLine,
  type RecordMetric,
  type RunIdentity,
  type RunSummaryModel,
} from './runSummaryModel';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import { ProvisionalTag } from './ProvisionalTag';
import { Highlight } from '../common/Highlight';
import { recordLine as commonRecordLine, unlockLine, verificationCaption, verificationTag } from '../common/summaryLines';

// The post-session summary (NFCT-22). It shows this device's provisional
// preview at once and replaces it with trusted scoring's result when that
// arrives, in the same layout. The score is marked Pending until trusted
// scoring has decided; the copy never describes how (NFCT-66). The heading
// keeps the id `mm-handoff-title`.

const numberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export interface RunSummaryProps {
  readonly outcome: RunOutcome;
  readonly run: RunIdentity;
  readonly environment: SessionEnvironment;
  readonly save: SaveState;
  readonly eeg: EegInfo | null;
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly onPlayAgain: () => void;
  readonly onViewProgress: () => void;
  readonly onExit: () => void;
}

const TIMING_FLAGS = new Set(['trial-overlap', 'run-overrun', 'active-duration-mismatch']);

/** Why trusted scoring flagged a run, in plain words. */
function flagExplanation(reasons: readonly string[]): string {
  if (reasons.includes('start-level-locked')) return 'This start level wasn’t unlocked yet when this run was scored.';
  if (reasons.includes('rt-below-floor')) return 'Too many answers came in faster than allowed.';
  if (reasons.some((reason) => TIMING_FLAGS.has(reason))) return 'The run’s timing didn’t add up.';
  return 'The run didn’t meet the scoring rules.';
}

const METRIC_WORDS: Readonly<Record<RecordMetric, string>> = {
  score: 'best score',
  correct: 'most correct answers',
  peakLevel: 'highest level',
};

const recordLine = (record: RecordLine, provisional: boolean, unavailable: boolean) => commonRecordLine(record, provisional, unavailable, METRIC_WORDS);

/** Why there are no totals to show yet. */
function totalsNote(unavailable: boolean): string {
  return unavailable ? 'Your totals couldn’t be loaded right now.' : 'Loading your totals…';
}

const SCORING_HELP = `Each correct answer earns its level’s difficulty points: ${mentalMath.basePoints(mentalMath.MIN_LEVEL)} at level ${mentalMath.MIN_LEVEL}, rising to ${mentalMath.basePoints(mentalMath.MAX_LEVEL)} at level ${mentalMath.MAX_LEVEL}. A quick answer adds a speed bonus of up to half those points. Wrong answers and timeouts score nothing.`;

function statFacts(model: RunSummaryModel) {
  const { stats } = model;
  return [
    { label: 'Correct', value: <span data-stat="correct">{`${stats.correct} of ${stats.attempted}`}</span> },
    { label: 'Accuracy', value: stats.accuracy === null ? '—' : percentFormat.format(stats.accuracy) },
    { label: 'Highest level', value: <span data-stat="peak-level">{stats.peakLevel}</span> },
    { label: 'Longest streak', value: stats.longestStreak },
  ];
}

export const RunSummary: React.FC<RunSummaryProps> = ({ outcome, run, environment, save, eeg, progress, onPlayAgain, onViewProgress, onExit }) => {
  const [state, setState] = useState<ProgressWithRecentSessions | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  // Re-subscribes after a failure; signed out, the summary still shows the run, without records.
  useEffect(() => subscribeWithRetry<ProgressWithRecentSessions>(
    (onNext, onError) => progress.subscribeToProgressWithRecentSessions(mentalMath.GAME_ID, {}, onNext, onError),
    (next) => {
      setUnavailable(false);
      setState(next);
    },
    () => setUnavailable(true),
  ), [progress]);

  const model = useMemo(
    () => runSummary({ outcome, environment, run, save: save.status, state }),
    [outcome, environment, run, save.status, state],
  );
  const { verification, breakdown, totals } = model;
  const provisional = verification.kind === 'provisional';
  const tag = verificationTag(verification);
  const record = recordLine(model.record, provisional, unavailable);
  const unlock = unlockLine(model.unlock, provisional, unavailable);

  return (
    <div className="mm-screen mm-summary">
      <section className="mm-panel" aria-labelledby="mm-handoff-title">
        <div>
          <h1 id="mm-handoff-title" ref={headingRef} tabIndex={-1} className="mm-title font-display">
            {outcome.status === 'completed' ? 'Run complete' : 'Run ended early'}
          </h1>
          <p className="mm-muted">Started at level {model.startLevel}</p>
        </div>

        <div className="mm-score" data-verification={verification.kind}>
          <div className="mm-score-top">
            <span className="mm-hud-label" id="mm-score-label">Score</span>
            <span className={`status-tag ${tag.tone}`} data-summary="verification">{tag.text}</span>
          </div>
          <p className="mm-result-value" data-result="score" aria-labelledby="mm-score-label">
            {model.score === null ? <><span aria-hidden="true">—</span><span className="mm-visually-hidden">No score</span></> : numberFormat.format(model.score)}
          </p>
          <p className="mm-score-caption" role="status" data-summary="caption">{verificationCaption(verification, flagExplanation)}</p>
          <dl className="mm-breakdown" aria-label="How this score adds up">
            <div>
              <dt>Difficulty points</dt>
              <dd data-result="difficulty-points">{breakdown ? numberFormat.format(breakdown.difficultyPoints) : '—'}</dd>
            </div>
            <div>
              <dt>Speed bonus</dt>
              <dd data-result="speed-bonus">{breakdown ? `+${numberFormat.format(breakdown.speedBonusPoints)}` : '—'}</dd>
            </div>
          </dl>
          <details className="mm-scoring-help">
            <summary>How scoring works</summary>
            <p>{SCORING_HELP}</p>
          </details>
        </div>

        <ul className="mm-highlights" aria-label="Records and unlocks">
          <Highlight name="record" icon={<Trophy size={18} />} line={record} />
          <Highlight name="unlock" icon={<LockOpen size={18} />} line={unlock} />
        </ul>
      </section>

      <section className="mm-panel mm-panel-compact" aria-labelledby="mm-run-stats-title">
        <h2 id="mm-run-stats-title" className="mm-section-title">This run</h2>
        <FactGrid facts={statFacts(model)} minColumnWidth={136} />
      </section>

      <section className="mm-panel mm-panel-compact" aria-labelledby="mm-totals-title">
        <h2 id="mm-totals-title" className="mm-section-title">
          Mental Math so far{provisional && totals !== null && <> <ProvisionalTag /></>}
        </h2>
        <FactGrid
          minColumnWidth={136}
          facts={[
            { label: 'Runs completed', value: <span data-total="runs-completed">{totals ? numberFormat.format(totals.sessionsCompleted) : '—'}</span> },
            { label: 'Time played', value: <span data-total="time-played">{totals ? formatPlayTime(totals.activeMs) : '—'}</span> },
          ]}
        />
        {totals === null && <p className="mm-help mm-totals-note">{totalsNote(unavailable)}</p>}
        <button type="button" className="btn btn-ghost mm-link mm-link-row" onClick={onViewProgress}>
          Records and history <ChevronRight size={16} aria-hidden="true" />
        </button>
      </section>

      <div className="mm-save-block">
        <p className={`mm-save mm-save-${save.status}`} role="status">{saveMessage(save)}</p>
        {eeg && save.status !== 'saving' && save.status !== 'failed' && <p className="mm-help mm-eeg-status" role="status">{eegMessage(save.eeg, eeg)}</p>}
      </div>

      <div className="mm-actions mm-summary-actions">
        <button type="button" className="btn btn-primary" onClick={onPlayAgain}>Play again</button>
        <button type="button" className="btn btn-secondary" onClick={onExit}>Done</button>
      </div>
    </div>
  );
};
