import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Lock, Pause } from 'lucide-react';
import { mentalMath } from '@nfct/shared';
import type { GameClock } from '../../clock/gameClock';
import type { EegCapture, EegCaptureProvider } from '../../eeg/eegCapture';
import type { EegRecordingOutcome, GameSessionRepository, SavedGameSession, StartedGameSession } from '../../repositories/gameSessionRepository';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { Keypad } from './Keypad';
import { MentalMathRunController, type RunOutcome, type RunSnapshot } from './runController';
import { buildSessionDraft, type SessionEnvironment } from './sessionDraft';
import { startLevelChoices, type StartLevelChoices } from './startLevel';
import { documentVisibility, type VisibilitySource } from './visibility';
import './mentalMath.css';

// Mental Math, playable end to end: the start-level picker, the run, and the
// minimal post-run handoff (the summary and progress screens are NFCT-22's).
// The session is written once, when the run ends, and never before: a run
// closed early by the OS or by leaving the screen leaves nothing behind.

export interface MentalMathScreenProps {
  readonly gameSessions: Pick<GameSessionRepository, 'startGameSession' | 'getGameSession'>;
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly clock: GameClock;
  readonly environment: SessionEnvironment;
  readonly visibility?: VisibilitySource;
  /** An optional EEG provider the player may switch on; EEG is never required. */
  readonly eegProvider?: EegCaptureProvider | null;
  readonly onExit: () => void;
}

type SaveState =
  | { readonly status: 'saving' }
  | { readonly status: 'queued'; readonly eeg: EegRecordingOutcome }
  | { readonly status: 'confirmed'; readonly eeg: EegRecordingOutcome }
  | { readonly status: 'failed'; readonly message: string };

type Stage =
  | { readonly kind: 'picker' }
  | { readonly kind: 'playing'; readonly controller: MentalMathRunController; readonly eegLabel: string | null }
  | { readonly kind: 'handoff'; readonly outcome: RunOutcome; readonly save: SaveState; readonly eegLabel: string | null }
  | { readonly kind: 'start-failed'; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const MentalMathScreen: React.FC<MentalMathScreenProps> = ({
  gameSessions,
  progress,
  clock,
  environment,
  visibility = documentVisibility,
  eegProvider = null,
  onExit,
}) => {
  const [stage, setStage] = useState<Stage>({ kind: 'picker' });
  const mounted = useRef(true);
  const active = useRef<{ controller: MentalMathRunController; game: StartedGameSession; capture: EegCapture | null } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving mid-run keeps nothing: no save, no partial state.
      const current = active.current;
      active.current = null;
      current?.controller.dispose();
      current?.capture?.cancel();
    };
  }, []);

  const saveRun = useCallback((game: StartedGameSession, capture: EegCapture | null, outcome: RunOutcome, eegLabel: string | null) => {
    const setSave = (save: SaveState) => {
      if (mounted.current) setStage({ kind: 'handoff', outcome, save, eegLabel });
    };
    setSave({ status: 'saving' });
    const eegRecording = capture?.finish() ?? null;
    let saved: SavedGameSession;
    void (async () => {
      try {
        saved = await game.save({ definition: mentalMath.definition, session: buildSessionDraft(outcome, environment), eegRecording });
      } catch (error) {
        setSave({ status: 'failed', message: errorMessage(error) });
        return;
      }
      setSave({ status: 'queued', eeg: saved.eegRecording });
      try {
        await saved.acknowledged;
        setSave({ status: 'confirmed', eeg: saved.eegRecording });
      } catch (error) {
        // The refusal can be ambiguous (the write landed, its acknowledgement
        // was lost): check before telling the player the save failed.
        const read = await gameSessions.getGameSession(saved.sessionId).catch(() => null);
        if (read?.status === 'readable' && !read.data.hasPendingWrites) setSave({ status: 'confirmed', eeg: saved.eegRecording });
        else setSave({ status: 'failed', message: errorMessage(error) });
      }
    })();
  }, [environment, gameSessions]);

  const startRun = useCallback((startLevel: number, withEeg: boolean) => {
    let game: StartedGameSession;
    try {
      game = gameSessions.startGameSession();
    } catch (error) {
      setStage({ kind: 'start-failed', message: errorMessage(error) });
      return;
    }
    const provider = withEeg ? eegProvider : null;
    const eegLabel = provider?.label ?? null;
    let capture: EegCapture | null = null;
    const controller = new MentalMathRunController({
      seed: game.seed,
      startLevel,
      clock,
      onEnd: (outcome) => {
        active.current = null;
        saveRun(game, capture, outcome, eegLabel);
      },
    });
    try {
      capture = provider?.start() ?? null;
    } catch {
      // EEG is optional: a provider that fails to start never blocks the game.
      capture = null;
    }
    active.current = { controller, game, capture };
    setStage({ kind: 'playing', controller, eegLabel: capture ? eegLabel : null });
    controller.start();
  }, [clock, eegProvider, gameSessions, saveRun]);

  switch (stage.kind) {
    case 'picker':
      return <StartLevelPicker progress={progress} eegProvider={eegProvider} onStart={startRun} onExit={onExit} />;
    case 'playing':
      return <RunView controller={stage.controller} eegLabel={stage.eegLabel} visibility={visibility} />;
    case 'handoff':
      return <RunHandoff outcome={stage.outcome} save={stage.save} eegLabel={stage.eegLabel} onPlayAgain={() => setStage({ kind: 'picker' })} onExit={onExit} />;
    case 'start-failed':
      return (
        <div className="mm-screen">
          <div className="mm-panel" role="alert">
            <h1 className="mm-title">Mental Math couldn't start</h1>
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
  | { readonly status: 'ready'; readonly choices: StartLevelChoices }
  | { readonly status: 'unavailable'; readonly choices: StartLevelChoices };

const StartLevelPicker: React.FC<{
  readonly progress: MentalMathScreenProps['progress'];
  readonly eegProvider: EegCaptureProvider | null;
  readonly onStart: (startLevel: number, withEeg: boolean) => void;
  readonly onExit: () => void;
}> = ({ progress, eegProvider, onStart, onExit }) => {
  const [data, setData] = useState<PickerData>({ status: 'loading' });
  const [selected, setSelected] = useState<number | null>(null);
  const [withEeg, setWithEeg] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let stop: () => void = () => {};
    const apply = (next: PickerData) => {
      setData(next);
      if (next.status === 'loading') return;
      setSelected((current) => (!touched.current || current === null || current > next.choices.unlocked ? next.choices.defaultLevel : current));
    };
    try {
      stop = progress.subscribeToProgressWithRecentSessions(mentalMath.GAME_ID, {}, (state: ProgressWithRecentSessions) => {
        apply({ status: 'ready', choices: startLevelChoices(state) });
      }, () => apply({ status: 'unavailable', choices: startLevelChoices(null) }));
    } catch {
      apply({ status: 'unavailable', choices: startLevelChoices(null) });
    }
    return () => stop();
  }, [progress]);

  const choices = data.status === 'loading' ? null : data.choices;
  const levels = Array.from({ length: choices?.maxLevel ?? mentalMath.MAX_LEVEL }, (_, index) => index + 1);

  return (
    <div className="mm-screen">
      <div className="mm-topbar">
        <button type="button" className="btn btn-ghost mm-back" onClick={onExit}>
          <ArrowLeft size={18} aria-hidden="true" /> Back
        </button>
      </div>
      <div className="mm-panel">
        <div>
          <h1 className="mm-title font-display">Mental Math</h1>
          <p className="mm-muted">A 90-second run of arithmetic. Questions get harder as you answer correctly and easier after a miss.</p>
        </div>

        <fieldset className="mm-levels" disabled={choices === null} aria-describedby="mm-levels-help">
          <legend className="mm-label">Start level</legend>
          <div className="mm-level-grid">
            {levels.map((level) => {
              const locked = choices !== null && level > choices.unlocked;
              return (
                <label key={level} className={`mm-level${locked ? ' mm-level-locked' : ''}${selected === level ? ' mm-level-selected' : ''}`}>
                  <input
                    type="radio"
                    name="mm-start-level"
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
          <p id="mm-levels-help" className="mm-help" aria-live="polite">
            {data.status === 'loading' && 'Loading your levels…'}
            {data.status === 'ready' && (data.choices.unlocked < data.choices.maxLevel
              ? 'Reach higher levels during a run to unlock higher start levels.'
              : 'Every start level is unlocked.')}
            {data.status === 'unavailable' && 'Your progress couldn’t be loaded, so only level 1 is available right now.'}
          </p>
        </fieldset>

        {eegProvider && (
          <label className="mm-eeg-option">
            <input type="checkbox" checked={withEeg} onChange={(event) => setWithEeg(event.target.checked)} />
            <span>
              <span className="mm-eeg-option-title">Use {eegProvider.label}</span>
              <span className="mm-help">Optional. {eegProvider.source === 'simulated' ? 'Simulated signals, not a measurement. ' : ''}EEG never affects your score or progress.</span>
            </span>
          </label>
        )}

        <button
          type="button"
          className="btn btn-primary mm-start"
          disabled={choices === null || selected === null}
          onClick={() => { if (selected !== null) onStart(selected, withEeg && eegProvider !== null); }}
        >
          {selected === null ? 'Start' : `Start at level ${selected}`}
        </button>
      </div>
    </div>
  );
};

// ---- The run ----

function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const numberFormat = new Intl.NumberFormat();

const RunView: React.FC<{
  readonly controller: MentalMathRunController;
  readonly eegLabel: string | null;
  readonly visibility: VisibilitySource;
}> = ({ controller, eegLabel, visibility }) => {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);

  // Backgrounding freezes the clock and discards the question; it never ends the run.
  useEffect(() => {
    const onChange = () => { if (visibility.isHidden()) controller.pause('background'); };
    onChange();
    return visibility.subscribe(onChange);
  }, [controller, visibility]);

  // A hardware keyboard works too; nothing auto-submits.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const current = controller.getSnapshot();
      if (/^[0-9]$/.test(event.key)) controller.pressDigit(Number(event.key));
      else if (event.key === 'Backspace') controller.deleteDigit();
      else if (event.key === 'Enter' && current.question && !event.repeat) controller.submit(current.question.id);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const paused = snapshot.phase === 'paused';
  useEffect(() => {
    if (paused) resumeRef.current?.focus();
    else pauseRef.current?.focus();
  }, [paused]);

  return (
    <div className="mm-screen mm-run">
      <header className="mm-hud">
        <dl className="mm-hud-stats" aria-label="Run status">
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Time left</dt>
            <dd className="mm-hud-value font-mono" data-hud="time">{formatRemaining(snapshot.remainingMs)}</dd>
          </div>
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Level</dt>
            <dd className="mm-hud-value" data-hud="level">{snapshot.level}</dd>
          </div>
          <div className="mm-hud-item">
            <dt className="mm-hud-label">Score</dt>
            <dd className="mm-hud-value" data-hud="score">{numberFormat.format(snapshot.score)}</dd>
          </div>
          <div className="mm-hud-item mm-hud-streak">
            <dt className="mm-hud-label">Streak</dt>
            <dd className="mm-hud-value" data-hud="streak">{snapshot.streak}</dd>
          </div>
        </dl>
        <button ref={pauseRef} type="button" className="mm-pause" onClick={() => controller.pause('player')} disabled={paused || snapshot.phase === 'ended'}>
          <Pause size={18} aria-hidden="true" /> Pause
        </button>
      </header>
      {eegLabel && <p className="mm-eeg-tag"><span className="status-tag status-tag-neutral">{eegLabel}: simulated, not measured</span></p>}

      {paused ? <PausePanel snapshot={snapshot} resumeRef={resumeRef} onResume={() => controller.resume()} onQuit={() => controller.quit()} /> : (
        <>
          <QuestionCard snapshot={snapshot} />
          <Keypad
            enabled={snapshot.phase === 'question'}
            canSubmit={snapshot.entry !== ''}
            onDigit={(digit) => controller.pressDigit(digit)}
            onDelete={() => controller.deleteDigit()}
            onSubmit={() => { if (snapshot.question) controller.submit(snapshot.question.id); }}
          />
        </>
      )}
    </div>
  );
};

const QuestionCard: React.FC<{ readonly snapshot: RunSnapshot }> = ({ snapshot }) => {
  const { feedback, question, entry, phase } = snapshot;
  const text = feedback?.questionText ?? question?.text ?? '';
  const tone = feedback === null ? '' : feedback.correct ? ' mm-card-correct' : ' mm-card-wrong';
  return (
    <section className={`mm-card${tone}`} aria-label="Question">
      <p className="mm-question">{phase === 'waiting' ? 'No more questions this run' : `${text} =`}</p>
      <p className="mm-entry font-mono">
        <span className="mm-visually-hidden">Your answer: </span>
        {entry === '' ? <span className="mm-entry-placeholder" aria-hidden="true">?</span> : <span data-hud="entry">{entry}</span>}
      </p>
      <p className="mm-feedback" role="status">
        {feedback === null ? '' : feedback.correct ? 'Correct' : feedback.timedOut ? `Time's up · ${feedback.expected}` : `Not quite · ${feedback.expected}`}
      </p>
    </section>
  );
};

const PausePanel: React.FC<{
  readonly snapshot: RunSnapshot;
  readonly resumeRef: React.RefObject<HTMLButtonElement | null>;
  readonly onResume: () => void;
  readonly onQuit: () => void;
}> = ({ snapshot, resumeRef, onResume, onQuit }) => (
  <section className="mm-card mm-paused" aria-labelledby="mm-paused-title">
    <h2 id="mm-paused-title" className="mm-paused-title">Paused</h2>
    <p className="mm-muted">
      {snapshot.pauseReason === 'background' ? 'The run paused while the app was in the background. ' : ''}
      The clock is stopped at {formatRemaining(snapshot.remainingMs)}. You'll get a new question when you resume.
    </p>
    <div className="mm-actions">
      <button ref={resumeRef} type="button" className="btn btn-primary" onClick={onResume}>Resume</button>
      <button type="button" className="btn btn-secondary" onClick={onQuit}>Quit run</button>
    </div>
    <p className="mm-help">Quitting ends the run now and saves it as unfinished.</p>
  </section>
);

// ---- Post-run handoff (NFCT-22 owns the full summary) ----

function eegMessage(eeg: EegRecordingOutcome, label: string): string {
  switch (eeg.status) {
    case 'included':
      return `${label} recording saved with this run. It is simulated data, not a measurement.`;
    case 'skipped':
      return eeg.reason === 'consent-required'
        ? `${label} was not saved: saving EEG needs your EEG consent.`
        : eeg.reason === 'consent-unavailable'
          ? `${label} was not saved: your EEG consent couldn’t be checked.`
          : `${label} was not saved: the recording was incomplete.`;
    case 'none':
      return `No ${label} was captured during this run.`;
  }
}

const RunHandoff: React.FC<{
  readonly outcome: RunOutcome;
  readonly save: SaveState;
  readonly eegLabel: string | null;
  readonly onPlayAgain: () => void;
  readonly onExit: () => void;
}> = ({ outcome, save, eegLabel, onPlayAgain, onExit }) => {
  const scored = mentalMath.score(outcome.run.trials, { modeId: mentalMath.MODE_ID, startLevel: outcome.run.startLevel });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const saveText = save.status === 'saving' ? 'Saving your run…'
    : save.status === 'queued' ? 'Saved on this device. Uploading to your account…'
      : save.status === 'confirmed' ? 'Run saved to your account.'
        : `This run couldn’t be saved. ${save.message}`;
  return (
    <div className="mm-screen">
      <section className="mm-panel" aria-labelledby="mm-handoff-title">
        <h1 id="mm-handoff-title" ref={headingRef} tabIndex={-1} className="mm-title font-display">
          {outcome.status === 'completed' ? 'Run complete' : 'Run ended early'}
        </h1>
        <div className="mm-result">
          <span className="mm-result-value" data-result="score">{numberFormat.format(scored.score)}</span>
          <span className="mm-hud-label">Score · not yet verified</span>
        </div>
        <p className="mm-muted">
          {outcome.run.trials.length} {outcome.run.trials.length === 1 ? 'question' : 'questions'} answered, {scored.metrics.correct} correct.
        </p>
        <p className={`mm-save mm-save-${save.status}`} role="status">{saveText}</p>
        {eegLabel && save.status !== 'saving' && save.status !== 'failed' && <p className="mm-help">{eegMessage(save.eeg, eegLabel)}</p>}
        <p className="mm-help">The server checks every run before it counts toward your records and unlocks. Until then this score is provisional.</p>
        <div className="mm-actions">
          <button type="button" className="btn btn-primary" onClick={onPlayAgain}>Play again</button>
          <button type="button" className="btn btn-secondary" onClick={onExit}>Done</button>
        </div>
      </section>
    </div>
  );
};
