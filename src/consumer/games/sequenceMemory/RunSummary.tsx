import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LockOpen, Trophy } from 'lucide-react';
import { sequenceMemory } from '@nfct/shared';
import { FactGrid } from '../../../components/ui/FactGrid';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { subscribeWithRetry } from '../../firestore/retryingSubscription';
import { Highlight } from '../common/Highlight';
import { saveMessage, type SaveState } from '../common/runSave';
import type { RunIdentity } from '../common/runSummaryModel';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import { recordLine, unlockLine, verificationCaption, verificationTag } from '../common/summaryLines';
import { formatPlayTime } from '../mentalMath/progressSummary';
import { ProvisionalTag } from '../mentalMath/ProvisionalTag';
import type { RunOutcome } from './runController';
import { runSummary, type RecordMetric, type RunSummaryModel } from './runSummaryModel';

// Sequence Memory's post-session summary (NFCT-93), in Mental Math's layout.
// It shows this device's provisional preview at once and replaces it with
// trusted scoring's result when that arrives. The score is marked Pending
// until trusted scoring has decided; the copy never describes how (NFCT-66).

const numberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export interface RunSummaryProps {
  readonly outcome: RunOutcome;
  readonly run: RunIdentity;
  readonly environment: SessionEnvironment;
  readonly save: SaveState;
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly onPlayAgain: () => void;
  readonly onExit: () => void;
}

const TIMING_FLAGS = new Set(['trial-overlap', 'trial-count-mismatch', 'active-duration-mismatch']);

/** Why trusted scoring flagged a run, in plain words. */
function flagExplanation(reasons: readonly string[]): string {
  if (reasons.includes('start-level-locked')) return 'This start level wasn’t unlocked yet when this run was scored.';
  if (reasons.includes('tap-below-floor')) return 'Too many taps came in faster than allowed.';
  if (reasons.some((reason) => TIMING_FLAGS.has(reason))) return 'The run’s timing didn’t add up.';
  return 'The run didn’t meet the scoring rules.';
}

const METRIC_WORDS: Readonly<Record<RecordMetric, string>> = {
  score: 'best score',
  longestSpan: 'longest sequence',
  peakLevel: 'highest level',
};

const { MIN_LEVEL, MAX_LEVEL } = sequenceMemory;
const SCORING_HELP = `Each sequence you tap back correctly earns its level’s points: ${sequenceMemory.pointsFor(MIN_LEVEL)} at level ${MIN_LEVEL}, rising to ${sequenceMemory.pointsFor(MAX_LEVEL)} at level ${MAX_LEVEL}. Speed doesn’t change the points. Misses and timeouts score nothing.`;

function statFacts(model: RunSummaryModel) {
  const { stats } = model;
  return [
    { label: 'Correct', value: <span data-stat="correct">{`${stats.correct} of ${stats.attempted}`}</span> },
    { label: 'Accuracy', value: stats.accuracy === null ? '—' : percentFormat.format(stats.accuracy) },
    { label: 'Highest level', value: <span data-stat="peak-level">{stats.peakLevel}</span> },
    { label: 'Longest sequence', value: <span data-stat="longest-span">{stats.longestSpan === 0 ? '—' : `${stats.longestSpan} tiles`}</span> },
  ];
}

export const RunSummary: React.FC<RunSummaryProps> = ({ outcome, run, environment, save, progress, onPlayAgain, onExit }) => {
  const [state, setState] = useState<ProgressWithRecentSessions | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  // Re-subscribes after a failure; signed out, the summary still shows the run, without records.
  useEffect(() => subscribeWithRetry<ProgressWithRecentSessions>(
    (onNext, onError) => progress.subscribeToProgressWithRecentSessions(sequenceMemory.GAME_ID, {}, onNext, onError),
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
  const { verification, totals } = model;
  const provisional = verification.kind === 'provisional';
  const tag = verificationTag(verification);
  const record = recordLine(model.record, provisional, unavailable, METRIC_WORDS);
  const unlock = unlockLine(model.unlock, provisional, unavailable);

  return (
    <div className="mm-screen mm-summary">
      <section className="mm-panel" aria-labelledby="sm-handoff-title">
        <div>
          <h1 id="sm-handoff-title" ref={headingRef} tabIndex={-1} className="mm-title font-display">
            {outcome.status === 'completed' ? 'Run complete' : 'Run ended early'}
          </h1>
          <p className="mm-muted">Started at level {model.startLevel}</p>
        </div>

        <div className="mm-score" data-verification={verification.kind}>
          <div className="mm-score-top">
            <span className="mm-hud-label" id="sm-score-label">Score</span>
            <span className={`status-tag ${tag.tone}`} data-summary="verification">{tag.text}</span>
          </div>
          <p className="mm-result-value" data-result="score" aria-labelledby="sm-score-label">
            {model.score === null ? <><span aria-hidden="true">—</span><span className="mm-visually-hidden">No score</span></> : numberFormat.format(model.score)}
          </p>
          <p className="mm-score-caption" role="status" data-summary="caption">{verificationCaption(verification, flagExplanation)}</p>
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

      <section className="mm-panel mm-panel-compact" aria-labelledby="sm-run-stats-title">
        <h2 id="sm-run-stats-title" className="mm-section-title">This run</h2>
        <FactGrid facts={statFacts(model)} minColumnWidth={136} />
      </section>

      <section className="mm-panel mm-panel-compact" aria-labelledby="sm-totals-title">
        <h2 id="sm-totals-title" className="mm-section-title">
          Sequence Memory so far{provisional && totals !== null && <> <ProvisionalTag /></>}
        </h2>
        <FactGrid
          minColumnWidth={136}
          facts={[
            { label: 'Runs completed', value: <span data-total="runs-completed">{totals ? numberFormat.format(totals.sessionsCompleted) : '—'}</span> },
            { label: 'Time played', value: <span data-total="time-played">{totals ? formatPlayTime(totals.activeMs) : '—'}</span> },
          ]}
        />
        {totals === null && <p className="mm-help mm-totals-note">{unavailable ? 'Your totals couldn’t be loaded right now.' : 'Loading your totals…'}</p>}
      </section>

      <div className="mm-save-block">
        <p className={`mm-save mm-save-${save.status}`} role="status">{saveMessage(save)}</p>
      </div>

      <div className="mm-actions mm-summary-actions">
        <button type="button" className="btn btn-primary" onClick={onPlayAgain}>Play again</button>
        <button type="button" className="btn btn-secondary" onClick={onExit}>Done</button>
      </div>
    </div>
  );
};
