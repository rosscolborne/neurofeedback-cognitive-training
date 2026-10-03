import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, LockOpen, Trophy } from 'lucide-react';
import { mentalMath } from '@nfct/shared';
import { FactGrid } from '../../../components/ui/FactGrid';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { subscribeWithRetry } from '../../firestore/retryingSubscription';
import { formatPlayTime } from './progressSummary';
import type { RunOutcome } from './runController';
import { eegMessage, saveMessage, type EegInfo, type SaveState } from './runSave';
import {
  runSummary,
  type RecordLine,
  type RecordMetric,
  type RunIdentity,
  type RunSummaryModel,
  type UnlockLine,
  type Verification,
} from './runSummaryModel';
import type { SessionEnvironment } from './sessionDraft';

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

/** The status tag on the score: provisional until trusted scoring has decided. */
function verificationTag(verification: Verification): { readonly text: string; readonly tone: string } {
  switch (verification.kind) {
    case 'provisional':
      return { text: 'Pending', tone: 'status-tag-neutral' };
    case 'verified':
      return { text: 'Final', tone: 'status-tag-active' };
    case 'flagged':
      return { text: 'Flagged', tone: 'status-tag-paused' };
    case 'invalid':
      return { text: 'Not counted', tone: 'status-tag-alert' };
    case 'not-saved':
      return { text: 'Not saved', tone: 'status-tag-alert' };
  }
}

const TIMING_FLAGS = new Set(['trial-overlap', 'run-overrun', 'active-duration-mismatch']);

/** Why trusted scoring flagged a run, in plain words. */
function flagExplanation(reasons: readonly string[]): string {
  if (reasons.includes('start-level-locked')) return 'This start level wasn’t unlocked yet when this run was scored.';
  if (reasons.includes('rt-below-floor')) return 'Too many answers came in faster than allowed.';
  if (reasons.some((reason) => TIMING_FLAGS.has(reason))) return 'The run’s timing didn’t add up.';
  return 'The run didn’t meet the scoring rules.';
}

function verificationCaption(verification: Verification): string {
  switch (verification.kind) {
    case 'provisional':
      // Pending says enough while the result is on its way (the save line covers an upload);
      // only a result that is taking a while gets a line, and it says nothing about why.
      return verification.detail === 'delayed' ? 'Your final score isn’t ready yet. Check back later.' : '';
    case 'verified':
      return '';
    case 'flagged':
      // ADR-001 decision 12: once the start level is unlocked, trusted scoring upgrades the run to valid.
      return verification.upgradable
        ? `${flagExplanation(verification.reasons)} It counts toward your totals now, and toward your records and unlocks once that level is unlocked.`
        : `${flagExplanation(verification.reasons)} It counts toward your totals, but not your records or unlocks.`;
    case 'invalid':
      return 'This run didn’t meet the scoring rules, so it doesn’t count toward your progress.';
    case 'not-saved':
      return 'This run wasn’t saved, so its score doesn’t count.';
  }
  return '';
}

const METRIC_WORDS: Record<RecordMetric, string> = {
  score: 'best score',
  correct: 'most correct answers',
  peakLevel: 'highest level',
};

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function bestSentence(startLevel: number, bestScore: number | null): string {
  return bestScore === null ? `No record yet from level ${startLevel}.` : `Your best from level ${startLevel} is ${numberFormat.format(bestScore)}.`;
}

interface Line {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'achieved' | 'neutral' | 'muted';
  /**
   * A verdict from the provisional preview, not yet decided by trusted scoring:
   * an achievement, or a flagged or invalid prediction. Its text is the same
   * as once confirmed, so the layout never shifts; only its styling (and a
   * screen-reader note) differs.
   */
  readonly pending?: boolean;
}

function recordLine(record: RecordLine, provisional: boolean, unavailable: boolean): Line {
  switch (record.kind) {
    case 'loading':
      return unavailable
        ? { title: 'Records unavailable', detail: 'Your records couldn’t be loaded right now.', tone: 'muted' }
        : { title: 'Records', detail: 'Loading your records…', tone: 'muted' };
    case 'pending':
      return { title: 'Records', detail: 'Loading your records…', tone: 'muted' };
    case 'new-best': {
      // Kept to two lines at phone width, so the card never outgrows its reserved height (NFCT-52).
      const what = record.metrics.length > 0 ? `From level ${record.startLevel}: ${listWords(record.metrics.map((metric) => METRIC_WORDS[metric]))}.` : `From level ${record.startLevel}.`;
      return { title: 'New personal best', detail: what, tone: 'achieved', pending: provisional };
    }
    case 'best-so-far':
      return {
        title: record.bestScore === null ? `No record yet from level ${record.startLevel}` : `Your best from level ${record.startLevel}: ${numberFormat.format(record.bestScore)}`,
        detail: 'Each start level has its own records.',
        tone: 'neutral',
      };
    case 'ineligible':
      switch (record.reason) {
        case 'abandoned':
          return { title: 'Unfinished runs don’t set records', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted' };
        case 'flagged':
          // Flagged only for its locked start level: the upgrade (ADR-001 decision 12) can still make it count.
          return record.upgradable
            ? { title: 'Not a record yet', detail: `This run can still set a record once level ${record.startLevel} is unlocked.`, tone: 'muted', pending: provisional }
            : { title: 'Flagged runs don’t set records', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted', pending: provisional };
        case 'invalid':
          return { title: 'Not counted', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted', pending: provisional };
        case 'not-saved':
          return { title: 'Not saved', detail: bestSentence(record.startLevel, record.bestScore), tone: 'muted' };
      }
  }
  return { title: '', detail: '', tone: 'muted' };
}

function levelsText(levels: readonly number[]): string {
  if (levels.length === 1) return `Level ${levels[0]}`;
  const sorted = [...levels].sort((a, b) => a - b);
  const contiguous = sorted.every((level, index) => index === 0 || level === sorted[index - 1]! + 1);
  return contiguous && sorted.length > 2 ? `Levels ${sorted[0]}–${sorted.at(-1)}` : `Levels ${listWords(sorted.map(String))}`;
}

function unlockLine(unlock: UnlockLine, provisional: boolean, unavailable: boolean): Line {
  switch (unlock.kind) {
    case 'loading':
      return unavailable
        ? { title: 'Start levels', detail: 'Your start levels couldn’t be loaded right now.', tone: 'muted' }
        : { title: 'Start levels', detail: 'Loading your start levels…', tone: 'muted' };
    case 'unlocked': {
      const highest = Math.max(...unlock.levels);
      return { title: `${levelsText(unlock.levels)} unlocked`, detail: `You can now start a run at level ${highest}.`, tone: 'achieved', pending: provisional };
    }
    case 'next':
      return {
        title: `Next unlock: start level ${unlock.nextLevel}`,
        detail: `Reach level ${unlock.reachLevel} in a finished run to unlock it.`,
        tone: 'neutral',
      };
    case 'all':
      return { title: 'Every start level is unlocked', detail: `You can start at any level from 1 to ${unlock.maxLevel}.`, tone: 'neutral' };
  }
}

const Highlight: React.FC<{ readonly icon: React.ReactNode; readonly line: Line; readonly name: string }> = ({ icon, line, name }) => (
  <li className={`mm-highlight mm-highlight-${line.tone}${line.pending ? ' mm-highlight-pending' : ''}`} data-summary={name} data-pending={line.pending ? 'true' : 'false'}>
    <span className="mm-highlight-icon" aria-hidden="true">{icon}</span>
    <span className="mm-highlight-text">
      <strong className="mm-highlight-title">
        {line.title}
        {line.pending && <span className="mm-visually-hidden"> (pending)</span>}
      </strong>
      <span className="mm-highlight-detail">{line.detail}</span>
    </span>
  </li>
);

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
          <p className="mm-score-caption" role="status" data-summary="caption">{verificationCaption(verification)}</p>
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
        <h2 id="mm-totals-title" className="mm-section-title">Mental Math so far</h2>
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
