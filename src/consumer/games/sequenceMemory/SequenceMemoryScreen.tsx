import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Check, Lock, Pause, X } from 'lucide-react';
import { sequenceMemory, type GameProgress } from '@nfct/shared';
import type { GameClock } from '../../clock/gameClock';
import type { GameSessionRepository, SavedGameSession, StartedGameSession } from '../../repositories/gameSessionRepository';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { subscribeWithRetry } from '../../firestore/retryingSubscription';
import type { RunIdentity } from '../common/runSummaryModel';
import type { SaveState } from '../common/runSave';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import type { StartLevelChoices } from '../common/startLevel';
import { documentVisibility, type VisibilitySource } from '../common/visibility';
import { ProvisionalTag } from '../mentalMath/ProvisionalTag';
import { SequenceMemoryRunController, type RunOutcome, type RunSnapshot } from './runController';
import { RunSummary } from './RunSummary';
import { bestsFor, currentProgress, startLevelChoices } from './runSummaryModel';
import { buildSessionDraft } from './sessionDraft';
import '../mentalMath/mentalMath.css';
import './sequenceMemory.css';

// Sequence Memory, playable end to end (NFCT-93): the start-level picker, the
// run and the post-session summary. It shares Mental Math's screen layout and
// the games' common save, preview and summary helpers. The session is written
// once, when the run ends, and never before: a run closed early by the OS or
// by leaving the screen leaves nothing behind. This game captures no EEG.

export interface SequenceMemoryScreenProps {
  readonly gameSessions: Pick<GameSessionRepository, 'startGameSession' | 'getGameSession'>;
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly clock: GameClock;
  readonly environment: SessionEnvironment;
  readonly visibility?: VisibilitySource;
  readonly onExit: () => void;
}

type Stage =
  /** `restore`: the start level to select again. */
  | { readonly kind: 'picker'; readonly restore?: number }
  | { readonly kind: 'playing'; readonly controller: SequenceMemoryRunController }
  | { readonly kind: 'handoff'; readonly outcome: RunOutcome; readonly run: RunIdentity; readonly save: SaveState }
  | { readonly kind: 'start-failed'; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const SequenceMemoryScreen: React.FC<SequenceMemoryScreenProps> = ({
  gameSessions,
  progress,
  clock,
  environment,
  visibility = documentVisibility,
  onExit,
}) => {
  const [stage, setStage] = useState<Stage>({ kind: 'picker' });
  const active = useRef<SequenceMemoryRunController | null>(null);

  /** Tears down a run that has not ended: no save, no partial state. */
  const discardActiveRun = useCallback(() => {
    active.current?.dispose();
    active.current = null;
  }, []);

  // Leaving the screen mid-run keeps nothing.
  useEffect(() => discardActiveRun, [discardActiveRun]);

  // Each screen starts at its top: the summary scrolls on a phone, and the next screen must not open part-way down.
  useLayoutEffect(() => {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [stage.kind]);

  // A run whose screen is gone is torn down, so it can never keep playing unseen.
  useEffect(() => {
    if (active.current && (stage.kind !== 'playing' || stage.controller !== active.current)) discardActiveRun();
  }, [stage, discardActiveRun]);

  const saveRun = useCallback((game: StartedGameSession, controller: SequenceMemoryRunController, outcome: RunOutcome) => {
    // Every update names its own run: a late result for this run never replaces a newer run's screen.
    const setSave = (save: SaveState) => setStage((current) => (
      current.kind === 'handoff' && current.outcome === outcome ? { ...current, save } : current
    ));
    const run: RunIdentity = { sessionId: game.sessionId, userId: game.userId, seed: game.seed };
    setStage((current) => (
      current.kind === 'playing' && current.controller === controller ? { kind: 'handoff', outcome, run, save: { status: 'saving' } } : current
    ));
    void (async () => {
      let saved: SavedGameSession;
      try {
        saved = await game.save({ definition: sequenceMemory.definition, session: buildSessionDraft(outcome, environment) });
      } catch (error) {
        setSave({ status: 'failed', message: errorMessage(error) });
        return;
      }
      setSave({ status: 'queued', eeg: { status: 'none' } });
      try {
        await saved.acknowledged;
        setSave({ status: 'confirmed', eeg: { status: 'none' } });
      } catch (error) {
        // The refusal can be ambiguous (the write landed, its acknowledgement
        // was lost): check before telling the player the save failed.
        const read = await gameSessions.getGameSession(saved.sessionId).catch(() => null);
        setSave(read?.status === 'readable' && !read.data.hasPendingWrites
          ? { status: 'confirmed', eeg: { status: 'none' } }
          : { status: 'failed', message: errorMessage(error) });
      }
    })();
  }, [environment, gameSessions]);

  const startRun = useCallback((startLevel: number) => {
    let game: StartedGameSession;
    try {
      game = gameSessions.startGameSession();
    } catch (error) {
      setStage({ kind: 'start-failed', message: errorMessage(error) });
      return;
    }
    const controller: SequenceMemoryRunController = new SequenceMemoryRunController({
      seed: game.seed,
      startLevel,
      clock,
      onEnd: (outcome) => {
        if (active.current === controller) active.current = null;
        saveRun(game, controller, outcome);
      },
    });
    discardActiveRun();
    active.current = controller;
    setStage({ kind: 'playing', controller });
    controller.start();
  }, [clock, discardActiveRun, gameSessions, saveRun]);

  switch (stage.kind) {
    case 'picker':
      return <StartLevelPicker progress={progress} restore={stage.restore} onStart={startRun} onExit={onExit} />;
    case 'playing':
      return <RunView controller={stage.controller} visibility={visibility} />;
    case 'handoff':
      return (
        <RunSummary
          outcome={stage.outcome}
          run={stage.run}
          environment={environment}
          save={stage.save}
          progress={progress}
          onPlayAgain={() => setStage({ kind: 'picker', restore: stage.outcome.run.startLevel })}
          onExit={onExit}
        />
      );
    case 'start-failed':
      return (
        <div className="mm-screen">
          <div className="mm-panel" role="alert">
            <h1 className="mm-title">Sequence Memory couldn't start</h1>
            <p className="mm-muted">{stage.message}</p>
            <div className="mm-actions">
              <button type="button" className="btn btn-primary" onClick={() => setStage({ kind: 'picker' })}>Try again</button>
              <button type="button" className="btn btn-secondary" onClick={onExit}>Back</button>
            </div>
          </div>
        </div>
      );
  }
};

// ---- Start-level picker ----

type PickerData =
  | { readonly status: 'loading' }
  /** `progress` is the cached progress with this device's pending runs applied, as the unlocks use it. */
  | { readonly status: 'ready'; readonly choices: StartLevelChoices; readonly progress: GameProgress | null; readonly unchecked: ReadonlySet<string> }
  | { readonly status: 'unavailable'; readonly choices: StartLevelChoices };

const numberFormat = new Intl.NumberFormat();

/** The selected start level's best score, provisional when a run trusted scoring has not checked yet holds it. */
function bestLine(data: PickerData, level: number | null): { readonly text: string; readonly provisional: boolean } {
  if (data.status !== 'ready' || level === null) return { text: ' ', provisional: false };
  const best = bestsFor(data.progress, level).score;
  return best === undefined
    ? { text: `No finished runs from level ${level} yet.`, provisional: false }
    : { text: `Your best from level ${level}: ${numberFormat.format(best.value)}`, provisional: data.unchecked.has(best.sessionId) };
}

/** Logs why progress could not be loaded (the read, the Firestore code and a redacted message), never document contents. */
function logProgressReadFailure(error: unknown): void {
  const { read, code, message } = (error ?? {}) as { read?: unknown; code?: unknown; message?: unknown };
  console.warn('Sequence Memory progress could not be loaded', {
    read: typeof read === 'string' ? read : 'unknown',
    code: typeof code === 'string' ? code : 'unknown',
    message: (typeof message === 'string' ? message : String(error)).replace(/\busers\/[^/\s]+/g, 'users/{uid}'),
  });
}

const StartLevelPicker: React.FC<{
  readonly progress: SequenceMemoryScreenProps['progress'];
  /** A start level to select again (Play again); otherwise the default. */
  readonly restore?: number;
  readonly onStart: (startLevel: number) => void;
  readonly onExit: () => void;
}> = ({ progress, restore, onStart, onExit }) => {
  const [data, setData] = useState<PickerData>({ status: 'loading' });
  const [selected, setSelected] = useState<number | null>(restore ?? null);
  // A restored level counts as the player's own choice: it stays selected while it is unlocked.
  const touched = useRef(restore !== undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  useEffect(() => {
    const apply = (next: PickerData) => {
      setData(next);
      if (next.status === 'loading') return;
      setSelected((current) => (!touched.current || current === null || current > next.choices.unlocked ? next.choices.defaultLevel : current));
    };
    // Re-subscribes after a failure, so a transient one does not keep the picker at level 1.
    return subscribeWithRetry<ProgressWithRecentSessions>(
      (onNext, onError) => progress.subscribeToProgressWithRecentSessions(sequenceMemory.GAME_ID, {}, onNext, onError),
      (state) => {
        const current = currentProgress(state);
        apply({ status: 'ready', choices: startLevelChoices(state), progress: current.progress, unchecked: current.unchecked });
      },
      (error) => {
        logProgressReadFailure(error);
        apply({ status: 'unavailable', choices: startLevelChoices(null) });
      },
    );
  }, [progress]);

  const choices = data.status === 'loading' ? null : data.choices;
  const best = bestLine(data, selected);
  const levels = Array.from({ length: choices?.maxLevel ?? sequenceMemory.MAX_LEVEL }, (_, index) => index + 1);

  return (
    <div className="mm-screen">
      <div className="mm-topbar">
        <button type="button" className="btn btn-ghost mm-back" onClick={onExit}>
          <ArrowLeft size={18} aria-hidden="true" /> Back
        </button>
      </div>
      <div className="mm-panel">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="mm-title font-display">Sequence Memory</h1>
          <p className="mm-muted">
            Tiles light up one at a time. When they stop, tap them back in the same order. A run is {sequenceMemory.TRIALS_PER_RUN} sequences:
            they get longer after two right in a row, and shorter after a miss.
          </p>
        </div>

        <fieldset className="mm-levels" disabled={choices === null} aria-describedby="sm-levels-help">
          <legend className="mm-label">Start level</legend>
          <div className="mm-level-grid">
            {levels.map((level) => {
              const locked = choices !== null && level > choices.unlocked;
              return (
                <label key={level} className={`mm-level${locked ? ' mm-level-locked' : ''}${selected === level ? ' mm-level-selected' : ''}`}>
                  <input
                    type="radio"
                    name="sm-start-level"
                    value={level}
                    className="mm-visually-hidden"
                    checked={selected === level}
                    disabled={choices === null || locked}
                    onChange={() => { touched.current = true; setSelected(level); }}
                  />
                  <span className="mm-visually-hidden">Level </span>
                  <span className="mm-level-number">{level}</span>
                  {locked && <><Lock size={12} aria-hidden="true" /><span className="mm-visually-hidden"> (locked)</span></>}
                </label>
              );
            })}
          </div>
          <p id="sm-levels-help" className="mm-help" aria-live="polite">
            {data.status === 'loading' && 'Loading your levels…'}
            {data.status === 'ready' && (data.choices.unlocked < data.choices.maxLevel
              ? 'Reach higher levels during a run to unlock higher start levels.'
              : 'Every start level is unlocked.')}
            {data.status === 'unavailable' && 'Your progress couldn’t be loaded, so only level 1 is available right now.'}
          </p>
          <p className="mm-level-best" data-picker="best">
            {best.text}
            {best.provisional && <> <ProvisionalTag /></>}
          </p>
        </fieldset>

        <button
          type="button"
          className="btn btn-primary mm-start"
          disabled={choices === null || selected === null}
          onClick={() => { if (selected !== null) onStart(selected); }}
        >
          {selected === null ? 'Start' : `Start at level ${selected}`}
        </button>
      </div>
    </div>
  );
};

// ---- The run ----

/** What the status line says: whose turn it is, how far the response has got, or how the trial went. */
function statusText(snapshot: RunSnapshot): string {
  const { phase, trial, tapped, feedback } = snapshot;
  if (phase === 'feedback' && feedback) return feedback.correct ? 'Correct' : feedback.timedOut ? 'Time’s up' : 'Not quite';
  if (phase === 'presenting') return 'Watch the sequence';
  if (phase === 'responding' && trial) return tapped.length === 0 ? `Your turn: tap ${trial.span} tiles in order` : `${tapped.length} of ${trial.span}`;
  return ' ';
}

const RunView: React.FC<{
  readonly controller: SequenceMemoryRunController;
  readonly visibility: VisibilitySource;
}> = ({ controller, visibility }) => {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);

  // Backgrounding freezes the run and discards the trial on screen; it never ends the run.
  useEffect(() => {
    const onChange = () => { if (visibility.isHidden()) controller.pause('background'); };
    onChange();
    return visibility.subscribe(onChange);
  }, [controller, visibility]);

  const paused = snapshot.phase === 'paused';
  useEffect(() => {
    if (paused) resumeRef.current?.focus();
    else pauseRef.current?.focus();
  }, [paused]);

  const shownTrial = Math.min(snapshot.trialsRecorded + (snapshot.phase === 'feedback' ? 0 : 1), snapshot.trialsTotal);
  return (
    <div className="mm-screen mm-run sm-run">
      <header className="mm-hud">
        <dl className="mm-hud-stats" aria-label="Run status">
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Sequence</dt>
            <dd className="mm-hud-value" data-hud="trial">{shownTrial}<span className="sm-hud-of">/{snapshot.trialsTotal}</span></dd>
          </div>
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Level</dt>
            <dd className="mm-hud-value" data-hud="level">{snapshot.level}</dd>
          </div>
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Score</dt>
            <dd className="mm-hud-value" data-hud="score">{numberFormat.format(snapshot.score)}</dd>
          </div>
        </dl>
        <button ref={pauseRef} type="button" className="mm-pause" onClick={() => controller.pause('player')} disabled={paused || snapshot.phase === 'ended'}>
          <Pause size={18} aria-hidden="true" /> <span className="mm-pause-label">Pause</span>
        </button>
      </header>

      {paused ? <PausePanel snapshot={snapshot} resumeRef={resumeRef} onResume={() => controller.resume()} onQuit={() => controller.quit()} /> : (
        <Board snapshot={snapshot} onTap={(trialId, tile) => controller.tap(trialId, tile)} />
      )}
    </div>
  );
};

const Board: React.FC<{
  readonly snapshot: RunSnapshot;
  readonly onTap: (trialId: string, tile: number) => void;
}> = ({ snapshot, onTap }) => {
  const { phase, trial, feedback, litTile, litStep, tapped } = snapshot;
  const gridSize = trial?.gridSize ?? feedback?.gridSize ?? 3;
  const responding = phase === 'responding' && trial !== null;
  const tone = feedback === null ? '' : feedback.correct ? ' sm-board-correct' : ' sm-board-wrong';
  const remaining = snapshot.responseRemainingMs;
  const limit = snapshot.responseLimitMs;
  const timerShare = responding && remaining !== null && limit ? remaining / limit : phase === 'presenting' ? 1 : 0;
  const lastTapped = tapped.length > 0 ? tapped[tapped.length - 1]! : null;
  const tiles = Array.from({ length: gridSize * gridSize }, (_, index) => index);

  return (
    <section className={`sm-play${tone}`} aria-label="Sequence board" data-phase={phase}>
      <p className="sm-status" role="status" data-sm="status">
        {feedback && (feedback.correct ? <Check size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />)}
        {statusText(snapshot)}
      </p>
      <div className="sm-timer" aria-hidden="true">
        <span className="sm-timer-fill" style={{ transform: `scaleX(${timerShare})` }} data-sm="timer" />
      </div>
      <div
        className="sm-board"
        role="group"
        aria-label={responding ? 'Tiles: tap them in the order they lit up' : 'Tiles'}
        style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
        data-grid-size={gridSize}
      >
        {tiles.map((tile) => {
          const lit = litTile === tile;
          return (
            <button
              key={`${trial?.id ?? 'board'}:${tile}`}
              type="button"
              className={`sm-tile${lit ? ' sm-tile-lit' : ''}${responding && lastTapped === tile ? ' sm-tile-tapped' : ''}`}
              data-tile={tile}
              data-lit={lit ? 'true' : 'false'}
              data-lit-step={lit && litStep !== null ? litStep : undefined}
              aria-label={`Row ${Math.floor(tile / gridSize) + 1}, column ${(tile % gridSize) + 1}${lit ? ', lit' : ''}`}
              aria-disabled={responding ? undefined : 'true'}
              // Pointer events only: the tap counts when the finger or button goes down, and the click that follows is ignored.
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (responding) onTap(trial.id, tile);
              }}
              // A click with no pointer (Enter or Space on a focused tile) is a keyboard tap.
              onClick={(event) => {
                if (event.detail === 0 && responding) onTap(trial.id, tile);
              }}
            >
              {/* The lit tile carries a mark, not only a colour. */}
              <span className="sm-tile-mark" aria-hidden="true" key={lit ? `lit-${litStep}` : 'dark'} />
            </button>
          );
        })}
      </div>
    </section>
  );
};

const PausePanel: React.FC<{
  readonly snapshot: RunSnapshot;
  readonly resumeRef: React.RefObject<HTMLButtonElement | null>;
  readonly onResume: () => void;
  readonly onQuit: () => void;
}> = ({ snapshot, resumeRef, onResume, onQuit }) => (
  <section className="mm-card mm-paused" aria-labelledby="sm-paused-title">
    <h2 id="sm-paused-title" className="mm-paused-title">Paused</h2>
    <p className="mm-muted">
      {snapshot.pauseReason === 'background' ? 'The run paused while the app was in the background. ' : ''}
      {snapshot.trialsRecorded} of {snapshot.trialsTotal} sequences done. You'll get a new sequence when you resume.
    </p>
    <div className="mm-actions">
      <button ref={resumeRef} type="button" className="btn btn-primary" onClick={onResume}>Resume</button>
      <button type="button" className="btn btn-secondary" onClick={onQuit}>Quit run</button>
    </div>
    <p className="mm-help">Quitting ends the run now and saves it as unfinished.</p>
  </section>
);
