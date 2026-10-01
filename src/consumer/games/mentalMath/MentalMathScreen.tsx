import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, Lock, Pause, Trophy } from 'lucide-react';
import { mentalMath, type GameProgress } from '@nfct/shared';
import type { GameClock } from '../../clock/gameClock';
import type { EegCapture, EegCaptureProvider } from '../../eeg/eegCapture';
import type { EegRecordingDraft, EegRecordingRepository, EegRecordingSave } from '../../repositories/eegRecordingRepository';
import type { GameSessionRepository, SavedGameSession, StartedGameSession } from '../../repositories/gameSessionRepository';
import type { ProgressRepository, ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { Keypad } from './Keypad';
import { MentalMathProgress } from './MentalMathProgress';
import { MentalMathRunController, type RunOutcome, type RunSnapshot } from './runController';
import type { EegInfo, EegState, SaveState } from './runSave';
import { RunSummary } from './RunSummary';
import { bestsFor, type RunIdentity } from './runSummary';
import { buildSessionDraft, type SessionEnvironment } from './sessionDraft';
import { currentProgress, startLevelChoices, type StartLevelChoices } from './startLevel';
import { documentVisibility, type VisibilitySource } from './visibility';
import './mentalMath.css';

// Mental Math, playable end to end: the start-level picker, the run, the
// post-session summary and the game's progress and history (NFCT-21, NFCT-22).
// The session is written once, when the run ends, and never before: a run
// closed early by the OS or by leaving the screen leaves nothing behind.

/** Which screen Mental Math opens on. */
export type MentalMathView = 'picker' | 'progress';

export interface MentalMathScreenProps {
  readonly gameSessions: Pick<GameSessionRepository, 'startGameSession' | 'getGameSession' | 'subscribeToGameSessionHistory' | 'listGameSessionHistory'>;
  /** Writes the run's EEG recording, after the session is queued. */
  readonly eegRecordings: Pick<EegRecordingRepository, 'saveRecording'>;
  readonly progress: Pick<ProgressRepository, 'subscribeToProgressWithRecentSessions'>;
  readonly clock: GameClock;
  readonly environment: SessionEnvironment;
  readonly visibility?: VisibilitySource;
  /** An optional EEG provider the player may switch on; EEG is never required. */
  readonly eegProvider?: EegCaptureProvider | null;
  /** The screen to open on: the start-level picker (default) or the game's progress and history. */
  readonly initialView?: MentalMathView;
  readonly onExit: () => void;
}

type Stage =
  | { readonly kind: 'picker' }
  /** `back` is where Back leads: the picker, or out of the game when it opened on this screen. */
  | { readonly kind: 'progress'; readonly back: 'picker' | 'exit' }
  | { readonly kind: 'playing'; readonly controller: MentalMathRunController; readonly eeg: EegInfo | null }
  | { readonly kind: 'handoff'; readonly outcome: RunOutcome; readonly run: RunIdentity; readonly save: SaveState; readonly eeg: EegInfo | null }
  | { readonly kind: 'start-failed'; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const MentalMathScreen: React.FC<MentalMathScreenProps> = ({
  gameSessions,
  eegRecordings,
  progress,
  clock,
  environment,
  visibility = documentVisibility,
  eegProvider = null,
  initialView = 'picker',
  onExit,
}) => {
  const [stage, setStage] = useState<Stage>(initialView === 'progress' ? { kind: 'progress', back: 'exit' } : { kind: 'picker' });
  const active = useRef<{ controller: MentalMathRunController; capture: EegCapture | null } | null>(null);

  /** Tears down a run that has not ended: no save, no partial state. */
  const discardActiveRun = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.controller.dispose();
    try {
      current.capture?.cancel();
    } catch {
      // EEG is optional; a failing provider never affects the game.
    }
  }, []);

  // Leaving the screen mid-run keeps nothing.
  useEffect(() => discardActiveRun, [discardActiveRun]);

  // A run whose screen is gone is torn down, so it can never keep playing unseen.
  useEffect(() => {
    if (active.current && (stage.kind !== 'playing' || stage.controller !== active.current.controller)) discardActiveRun();
  }, [stage, discardActiveRun]);

  const saveRun = useCallback((game: StartedGameSession, controller: MentalMathRunController, capture: EegCapture | null, outcome: RunOutcome, eeg: EegInfo | null) => {
    // Every update names its own run: a late result for this run never replaces a newer run's screen.
    const setSave = (save: SaveState) => setStage((current) => (
      current.kind === 'handoff' && current.outcome === outcome ? { ...current, save } : current
    ));
    const run: RunIdentity = { sessionId: game.sessionId, userId: game.userId, seed: game.seed };
    setStage((current) => (
      current.kind === 'playing' && current.controller === controller ? { kind: 'handoff', outcome, run, save: { status: 'saving' }, eeg } : current
    ));
    let eegRecording: EegRecordingDraft | null = null;
    try {
      eegRecording = capture?.finish() ?? null;
    } catch {
      // EEG is optional: a capture that fails to finish is reported as not captured, and the run is still saved.
      eegRecording = null;
    }
    let saved: SavedGameSession;
    // The session and the EEG recording report separately; each update keeps the other's latest state.
    let session: 'queued' | 'confirmed' | 'failed' = 'queued';
    let eegState: EegState = { status: eegRecording ? 'checking' : 'none' };
    const report = (message = '') => setSave(session === 'failed' ? { status: 'failed', message } : { status: session, eeg: eegState });
    void (async () => {
      try {
        saved = await game.save({ definition: mentalMath.definition, session: buildSessionDraft(outcome, environment) });
      } catch (error) {
        setSave({ status: 'failed', message: errorMessage(error) });
        return;
      }
      report();
      // Offered straight after the session is queued (not after it is acknowledged), with what save() returned.
      if (eegRecording) void saveEeg(saved, eegRecording);
      try {
        await saved.acknowledged;
        session = 'confirmed';
        report();
      } catch (error) {
        // The refusal can be ambiguous (the write landed, its acknowledgement
        // was lost): check before telling the player the save failed.
        const read = await gameSessions.getGameSession(saved.sessionId).catch(() => null);
        session = read?.status === 'readable' && !read.data.hasPendingWrites ? 'confirmed' : 'failed';
        report(errorMessage(error));
      }
    })();

    async function saveEeg(queuedSession: SavedGameSession, draft: EegRecordingDraft): Promise<void> {
      const update = (next: EegState) => { eegState = next; if (session !== 'failed') report(); };
      let result: EegRecordingSave;
      try {
        result = await eegRecordings.saveRecording(queuedSession, draft);
      } catch {
        // Never affects the session.
        update({ status: 'not-saved', reason: 'error' });
        return;
      }
      if (result.status === 'skipped') {
        update({ status: 'not-saved', reason: result.reason });
        return;
      }
      update({ status: 'queued' });
      try {
        const server = await result.serverOutcome;
        update(server.status === 'acknowledged' ? { status: 'saved' } : { status: 'not-saved', reason: server.reason });
      } catch {
        update({ status: 'not-saved', reason: 'error' });
      }
    }
  }, [environment, gameSessions, eegRecordings]);

  const startRun = useCallback((startLevel: number, withEeg: boolean) => {
    let game: StartedGameSession;
    try {
      game = gameSessions.startGameSession();
    } catch (error) {
      setStage({ kind: 'start-failed', message: errorMessage(error) });
      return;
    }
    const provider = withEeg ? eegProvider : null;
    const eeg: EegInfo | null = provider ? { label: provider.label, source: provider.source } : null;
    let capture: EegCapture | null = null;
    const controller: MentalMathRunController = new MentalMathRunController({
      seed: game.seed,
      startLevel,
      clock,
      onEnd: (outcome) => {
        if (active.current?.controller === controller) active.current = null;
        saveRun(game, controller, capture, outcome, eeg);
      },
    });
    try {
      capture = provider?.start() ?? null;
    } catch {
      // EEG is optional: a provider that fails to start never blocks the game.
      capture = null;
    }
    discardActiveRun();
    active.current = { controller, capture };
    setStage({ kind: 'playing', controller, eeg: capture ? eeg : null });
    controller.start();
  }, [clock, discardActiveRun, eegProvider, gameSessions, saveRun]);

  switch (stage.kind) {
    case 'picker':
      return (
        <StartLevelPicker
          progress={progress}
          eegProvider={eegProvider}
          onStart={startRun}
          onViewProgress={() => setStage({ kind: 'progress', back: 'picker' })}
          onExit={onExit}
        />
      );
    case 'progress':
      return (
        <MentalMathProgress
          progress={progress}
          gameSessions={gameSessions}
          onBack={() => (stage.back === 'exit' ? onExit() : setStage({ kind: 'picker' }))}
          onPlay={() => setStage({ kind: 'picker' })}
        />
      );
    case 'playing':
      return <RunView controller={stage.controller} eeg={stage.eeg} visibility={visibility} />;
    case 'handoff':
      return (
        <RunSummary
          outcome={stage.outcome}
          run={stage.run}
          environment={environment}
          save={stage.save}
          eeg={stage.eeg}
          progress={progress}
          onPlayAgain={() => setStage({ kind: 'picker' })}
          onViewProgress={() => setStage({ kind: 'progress', back: 'picker' })}
          onExit={onExit}
        />
      );
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
  /** `progress` is the cached progress with this device's pending runs applied, as the unlocks use it. */
  | { readonly status: 'ready'; readonly choices: StartLevelChoices; readonly progress: GameProgress | null }
  | { readonly status: 'unavailable'; readonly choices: StartLevelChoices };

const numberFormat = new Intl.NumberFormat();

/** The selected start level's best score, from the same preview as the unlocks. */
function bestLine(data: PickerData, level: number | null): string {
  if (data.status !== 'ready' || level === null) return '\u00A0';
  const best = bestsFor(data.progress, level).score?.value;
  return best === undefined ? `No finished runs from level ${level} yet.` : `Your best from level ${level}: ${numberFormat.format(best)}`;
}

const StartLevelPicker: React.FC<{
  readonly progress: MentalMathScreenProps['progress'];
  readonly eegProvider: EegCaptureProvider | null;
  readonly onStart: (startLevel: number, withEeg: boolean) => void;
  readonly onViewProgress: () => void;
  readonly onExit: () => void;
}> = ({ progress, eegProvider, onStart, onViewProgress, onExit }) => {
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
        apply({ status: 'ready', choices: startLevelChoices(state), progress: currentProgress(state).progress });
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
        <button type="button" className="btn btn-ghost mm-topbar-action" onClick={onViewProgress}>
          <Trophy size={18} aria-hidden="true" /> Progress
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
          <p className="mm-level-best" data-picker="best">{bestLine(data, selected)}</p>
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

const RunView: React.FC<{
  readonly controller: MentalMathRunController;
  readonly eeg: EegInfo | null;
  readonly visibility: VisibilitySource;
}> = ({ controller, eeg, visibility }) => {
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
      const digit = /^[0-9]$/.test(event.key);
      if (!digit && event.key !== 'Backspace' && event.key !== 'Enter') return;
      // Keys answer only while a question is on screen. Otherwise (paused, the
      // feedback flash) the browser keeps its native behaviour, so Enter still
      // activates a focused button such as Resume or Quit run.
      const current = controller.getSnapshot();
      if (current.phase !== 'question' || current.question === null) return;
      event.preventDefault();
      // Holding a digit or Enter never repeats it.
      if (event.repeat && event.key !== 'Backspace') return;
      if (digit) controller.pressDigit(Number(event.key));
      else if (event.key === 'Backspace') controller.deleteDigit();
      else controller.submit(current.question.id);
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
          <Pause size={18} aria-hidden="true" /> <span className="mm-pause-label">Pause</span>
        </button>
      </header>
      {eeg && <p className="mm-eeg-tag"><span className="status-tag status-tag-neutral">{eeg.label}: {eeg.source === 'simulated' ? 'simulated, not measured' : 'measured'}</span></p>}

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
      <p className="mm-question" aria-live="polite">{phase === 'waiting' ? 'No more questions this run' : `${text} =`}</p>
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
