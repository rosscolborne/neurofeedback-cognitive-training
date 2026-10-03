import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentalMath, readSessionProgressFields, type GameProgress, type GameSession, type ServerResult } from '@nfct/shared';
import type { EegCaptureProvider } from '../../../eeg/eegCapture';
import type { EegRecordingDraft, EegRecordingSave } from '../../../repositories/eegRecordingRepository';
import type {
  GameSessionHistoryEntry,
  GameSessionHistoryPage,
  GameSessionRecord,
  SaveGameSessionInput,
  SavedGameSession,
  StartedGameSession,
} from '../../../repositories/gameSessionRepository';
import { ProgressReadError, type ProgressWithRecentSessions } from '../../../repositories/progressRepository';
import { MentalMathScreen, type MentalMathScreenProps, type MentalMathView } from '../MentalMathScreen';
import type { VisibilitySource } from '../visibility';
import { FEEDBACK_MS } from '../runController';
import type { MentalMathSessionDraft } from '../sessionDraft';
import { clientSessionDocument } from '../runSummaryModel';
import { previewDecision, type ClientSessionDocument } from '../startLevel';
import { answerOf, pickerState, playRun, progressWith, sessionRecord } from './fixtures';
import { ManualClock } from './manualClock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 4242;
type SaveInput = SaveGameSessionInput<mentalMath.MentalMathTrial, mentalMath.MentalMathMetrics>;

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  isHidden = () => this.hidden;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(hidden: boolean) { this.hidden = hidden; this.listeners.forEach((listener) => listener()); }
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

type SaveResult = { sessionId: string; userId: string; acknowledged: Promise<void> };
type SaveRecording = (session: Pick<SavedGameSession, 'sessionId' | 'userId'>, draft: EegRecordingDraft) => Promise<EegRecordingSave>;

/** A recording queued and then acknowledged by the server. */
const acknowledgedRecording: SaveRecording = async (session) => ({ status: 'queued', recordingId: session.sessionId, serverOutcome: Promise.resolve({ status: 'acknowledged' }) });

function harness({ state = pickerState(null), progressError, eegProvider = null, saveImpl, saveRecording = acknowledgedRecording, getGameSession = vi.fn(), history = { entries: [], unreadable: [], nextCursor: null, fromCache: false }, listGameSessionHistory = vi.fn(), initialView } = {} as {
  state?: ProgressWithRecentSessions; eegProvider?: EegCaptureProvider | null;
  /** The progress read fails with this error instead of delivering `state`. */
  progressError?: Error;
  /** The live first history page. */
  history?: GameSessionHistoryPage;
  listGameSessionHistory?: (options: unknown) => Promise<GameSessionHistoryPage>;
  initialView?: MentalMathView;
  /** Replaces the default save (queued at once, acknowledged at once) for the call with this index. */
  saveImpl?: (input: SaveInput, call: number) => Promise<SaveResult>;
  saveRecording?: SaveRecording;
  getGameSession?: (sessionId: string) => Promise<unknown>;
}) {
  const clock = new ManualClock();
  const visibility = new FakeVisibility();
  const saves: SaveInput[] = [];
  /** The order in which saves resolved and recordings were offered. */
  const events: string[] = [];
  const savedResults: SaveResult[] = [];
  const save = vi.fn(async (input: SaveInput): Promise<SaveResult> => {
    saves.push(input);
    const result = saveImpl
      ? await saveImpl(input, saves.length - 1)
      : { sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', acknowledged: Promise.resolve() };
    savedResults.push(result);
    events.push('save-resolved');
    return result;
  });
  const recordingSaves = vi.fn((session: Pick<SavedGameSession, 'sessionId' | 'userId'>, draft: EegRecordingDraft) => {
    events.push('save-recording');
    return saveRecording(session, draft);
  });
  const startGameSession = vi.fn((): StartedGameSession => ({ sessionId: 'sessionAAAAAAAAAAAA1', seed: SEED, userId: 'player-1', save: save as unknown as StartedGameSession['save'] }));
  const gameSessions = {
    startGameSession,
    getGameSession: getGameSession as MentalMathScreenProps['gameSessions']['getGameSession'],
    subscribeToGameSessionHistory: vi.fn((_options: object, onNext: (page: GameSessionHistoryPage) => void) => { onNext(history); return () => {}; }),
    listGameSessionHistory: listGameSessionHistory as MentalMathScreenProps['gameSessions']['listGameSessionHistory'],
  };
  /** Every live progress listener; `publish` sends them a new state, as Firestore would. */
  const progressListeners = new Set<(value: ProgressWithRecentSessions) => void>();
  let latest = state;
  /** While set, new listeners get nothing until `publish`, as while Firestore is still reading. */
  let holdProgress = false;
  const progress = {
    subscribeToProgressWithRecentSessions: vi.fn((_gameId: string, _options: object, onNext: (value: ProgressWithRecentSessions) => void, onError: (error: Error) => void) => {
      if (progressError) {
        onError(progressError);
        return () => {};
      }
      progressListeners.add(onNext);
      if (!holdProgress) onNext(latest);
      return () => { progressListeners.delete(onNext); };
    }),
  };
  const holdNewProgressListeners = (hold: boolean) => { holdProgress = hold; };
  const publish = (next: ProgressWithRecentSessions) => act(() => { latest = next; progressListeners.forEach((listener) => listener(next)); });
  const onExit = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <MentalMathScreen
        gameSessions={gameSessions}
        eegRecordings={{ saveRecording: recordingSaves }}
        progress={progress}
        clock={clock}
        environment={{ timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }}
        visibility={visibility}
        eegProvider={eegProvider}
        initialView={initialView}
        onExit={onExit}
      />,
    );
  });
  const root = () => renderer.root;
  const buttons = (label: string) => root().findAll((node) => node.type === 'button' && textOf(node).trim() === label);
  const press = (label: string) => {
    const [button] = buttons(label);
    if (!button) throw new Error(`no button '${label}'`);
    act(() => { button.props.onClick(); });
  };
  const advance = (ms: number) => act(() => { clock.advance(ms); });
  const question = () => {
    const node = root().findAll((item) => item.props.className === 'mm-question')[0];
    return node ? textOf(node).replace(/ =$/, '') : null;
  };
  const hud = (name: string) => textOf(root().find((node) => node.props['data-hud'] === name));
  const radio = (level: number) => root().find((node) => node.type === 'input' && node.props.type === 'radio' && node.props.value === level);
  const typeAnswer = (value: number) => { for (const digit of String(value)) press(digit); };
  /** Answers `count` questions (right or wrong), `thinkMs` each, then lets the clock run out. */
  const playToEnd = (script: readonly boolean[], thinkMs = 900) => {
    for (const correct of script) {
      advance(thinkMs);
      const text = question();
      if (text === null) throw new Error('no question');
      typeAnswer(correct ? answerOf(text) : answerOf(text) + 1);
      press('Submit');
      advance(FEEDBACK_MS);
    }
    // Long enough for every remaining question to time out, feedback flashes included.
    advance(mentalMath.MAX_RUN_MS * 2);
  };
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };
  const title = () => root().findAll((node) => node.props.id === 'mm-handoff-title').map((node) => textOf(node))[0] ?? null;
  const saveStatus = () => root().findAll((node) => typeof node.props.className === 'string' && node.props.className.startsWith('mm-save ')).map((node) => textOf(node))[0] ?? null;
  const eegStatus = () => root().findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('mm-eeg-status')).map((node) => textOf(node))[0] ?? null;
  const enableEeg = () => act(() => { root().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); });
  const byData = (attribute: string, value: string) => root().findAll((node) => node.props[attribute] === value && typeof node.type === 'string').map((node) => textOf(node))[0] ?? null;
  return { renderer, root, clock, visibility, save, saves, savedResults, events, recordingSaves, eegStatus, enableEeg, startGameSession, onExit, buttons, press, advance, question, hud, radio, typeAnswer, playToEnd, flush, title, saveStatus, publish, holdNewProgressListeners, progress, gameSessions, byData };
}

const storageWrites = vi.fn();
beforeEach(() => {
  const storage = { setItem: storageWrites, getItem: () => null, removeItem: storageWrites, clear: storageWrites, key: () => null, length: 0 };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  storageWrites.mockReset();
});

describe('MentalMathScreen', () => {
  describe('when the progress read fails', () => {
    const FRIENDLY = 'Your progress couldn’t be loaded, so only level 1 is available right now.';
    const levelsHelp = (h: ReturnType<typeof harness>) => textOf(h.root().find((node) => node.props.id === 'mm-levels-help'));

    it('shows the friendly state and offers level 1, and logs the read, code and message for diagnosis', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // What real Firestore sends while the history query's composite index is still building.
      const indexBuilding = Object.assign(new Error('The query requires an index. That index is currently building and cannot be used yet. See its status here: https://console.firebase.google.com/v1/r/project/nfct-dev/firestore/indexes?create_composite=abc'), { code: 'failed-precondition' });
      const h = harness({ progressError: new ProgressReadError('recent sessions', indexBuilding) });

      expect(levelsHelp(h)).toBe(FRIENDLY);
      expect(h.radio(1).props.checked).toBe(true);
      expect(h.radio(2).props.disabled).toBe(true);
      expect(h.buttons('Start at level 1')[0]?.props.disabled).toBe(false);
      // The player never sees the backend error.
      expect(textOf(h.root())).not.toMatch(/index|failed-precondition|console\.firebase/);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Mental Math progress could not be loaded', {
        read: 'recent sessions',
        code: 'failed-precondition',
        message: indexBuilding.message,
      });
      warn.mockRestore();
    });

    it('logs an error without a read or code as unknown, and never a user ID in a path', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const h = harness({ progressError: new Error('Missing or insufficient permissions for users/Xq81uidXYZ/progress/mental-math') });

      expect(levelsHelp(h)).toBe(FRIENDLY);
      expect(warn).toHaveBeenCalledWith('Mental Math progress could not be loaded', {
        read: 'unknown',
        code: 'unknown',
        message: 'Missing or insufficient permissions for users/{uid}/progress/mental-math',
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('Xq81uidXYZ');
      warn.mockRestore();
    });
  });

  it('offers start levels 1 to the unlocked level, locks the rest, and defaults to the last start level', () => {
    const last = sessionRecord('sessionAAAAAAAAAAAA1', playRun({ seed: SEED, startLevel: 2, correct: 0 }), { awaitingResult: false, seed: SEED });
    const h = harness({ state: pickerState(progressWith(4), [last]) });
    for (const level of [1, 2, 3]) expect(h.radio(level).props.disabled).toBe(false);
    for (const level of [4, 5, 10]) expect(h.radio(level).props.disabled).toBe(true);
    expect(h.radio(2).props.checked).toBe(true);
    act(() => { h.radio(3).props.onChange(); });
    h.press('Start at level 3');
    expect(h.startGameSession).toHaveBeenCalledTimes(1);
    expect(h.hud('level')).toBe('3');
  });

  it('plays a full run with the keypad, answers each question once, and saves once as completed', async () => {
    const h = harness();
    h.press('Start at level 1');
    expect(h.hud('time')).toBe('0:45'); // the starting time bank
    // Submit needs an answer, and a complete answer never submits itself.
    expect(h.buttons('Submit')[0]!.props['aria-disabled']).toBe('true');
    h.advance(1_000);
    const first = h.question()!;
    h.typeAnswer(answerOf(first));
    h.advance(2_000);
    expect(h.question()).toBe(first);
    expect(h.hud('entry')).toBe(String(answerOf(first)));
    // A double tap on Submit resolves the question once.
    const submit = h.buttons('Submit')[0]!;
    act(() => { submit.props.onClick(); submit.props.onClick(); });
    // Right in 3 s (under two thirds of level 1's 8 s): +2 s, beside the timer and in the spoken feedback.
    expect(h.hud('bank-change')).toBe('+2s');
    expect(h.hud('time')).toBe('0:44');
    expect(textOf(h.root().find((node) => node.props.className === 'mm-feedback'))).toBe('Correct · +2 seconds');
    h.advance(FEEDBACK_MS);
    expect(h.hud('score')).not.toBe('0');
    expect(h.save).not.toHaveBeenCalled();

    h.playToEnd([true, true, false, true, true]);
    expect(h.save).toHaveBeenCalledTimes(1);
    const input = h.saves[0]!;
    const session = input.session as MentalMathSessionDraft;
    // Completed when the time bank ran out, which the trials alone determine.
    expect(session).toMatchObject({ gameId: 'mental-math', modeId: 'timed-90', status: 'completed', startLevel: 1 });
    expect(session.activeDurationMs).toBe(mentalMath.bankEnds(session.trials).final);
    // Six answered questions, plus the timeouts after them; nothing for the question on screen at expiry.
    expect(session.trials.filter((trial) => !trial.timedOut)).toHaveLength(6);
    expect(session.trials[0]!.rtMs).toBe(3_000);
    expect(session.summary.score).toBe(mentalMath.score(session.trials, { modeId: 'timed-90', startLevel: 1 }).score);
    expect(h.recordingSaves).not.toHaveBeenCalled();
    expect(h.root().findByProps({ id: 'mm-handoff-title' }).children.join('')).toBe('Run complete');
    // No partial-run state is ever written to browser storage.
    expect(storageWrites).not.toHaveBeenCalled();
    await h.flush();
  });

  it('writes nothing before the run ends, and nothing at all if the screen closes mid-run', () => {
    const cancel = vi.fn();
    const provider: EegCaptureProvider = { source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: vi.fn(() => null), cancel }) };
    const h = harness({ eegProvider: provider });
    h.enableEeg();
    h.press('Start at level 1');
    h.advance(30_000);
    h.press('Pause');
    h.advance(60_000);
    expect(h.save).not.toHaveBeenCalled();
    act(() => h.renderer.unmount());
    h.advance(mentalMath.MAX_RUN_MS * 2);
    expect(h.save).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.clock.pendingTimers).toBe(0);
    expect(storageWrites).not.toHaveBeenCalled();
  });

  it('pauses with a frozen clock and a discarded question, and resumes with a fresh one', async () => {
    const h = harness();
    h.press('Start at level 1');
    h.advance(10_000); // the first question timed out at 8 s
    h.advance(FEEDBACK_MS);
    const before = h.question();
    h.press('Pause');
    expect(h.question()).toBeNull();
    expect(h.buttons('Resume')).toHaveLength(1);
    const frozen = h.hud('time');
    h.advance(120_000);
    expect(h.hud('time')).toBe(frozen);
    h.press('Resume');
    expect(h.question()).not.toBe(before);
    h.press('Pause');
    h.press('Quit run');
    const session = h.saves[0]!.session as MentalMathSessionDraft;
    expect(session.status).toBe('abandoned');
    expect(session.trials).toHaveLength(1);
    expect(session.activeDurationMs).toBe(10_000);
    expect(h.root().findByProps({ id: 'mm-handoff-title' }).children.join('')).toBe('Run ended early');
    await h.flush();
  });

  it('pauses when the app goes to the background, and never abandons the run', () => {
    const h = harness();
    h.press('Start at level 1');
    h.advance(4_000);
    act(() => h.visibility.set(true));
    expect(h.question()).toBeNull();
    expect(textOf(h.root().findByProps({ id: 'mm-paused-title' }).parent!)).toContain('in the background');
    h.advance(10 * 60_000);
    act(() => h.visibility.set(false));
    // Still paused, still the same run, clock frozen.
    expect(h.buttons('Resume')).toHaveLength(1);
    expect(h.hud('time')).toBe('0:41');
    expect(h.save).not.toHaveBeenCalled();
    h.press('Resume');
    expect(h.question()).not.toBeNull();
  });

  it('with the simulated EEG provider, offers its recording once, after the session is queued, with what save() returned', async () => {
    const recording = { source: 'simulated' } as EegRecordingDraft;
    const provider: EegCaptureProvider = { source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: () => recording, cancel: vi.fn() }) };
    const h = harness({ eegProvider: provider });
    h.enableEeg();
    h.press('Start at level 1');
    expect(textOf(h.root())).toContain('Simulated EEG (Demo Mode): simulated, not measured');
    h.playToEnd([true, false, true]);
    await h.flush();
    // The session draft never carries EEG; the recording goes through its own call.
    expect(Object.keys(h.saves[0]!)).toEqual(['definition', 'session']);
    expect(h.recordingSaves).toHaveBeenCalledTimes(1);
    expect(h.recordingSaves.mock.calls[0]![0]).toBe(h.savedResults[0]);
    expect(h.recordingSaves.mock.calls[0]![1]).toBe(recording);
    expect(h.events).toEqual(['save-resolved', 'save-recording']);
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) recording saved with this run. It is simulated data, not a measurement.');
    expect(textOf(h.root())).not.toMatch(/measured EEG/i);
  });

  it('labels a measured provider as measured, from the provider’s own source', async () => {
    const provider: EegCaptureProvider = { source: 'measured', label: 'Muse S', start: () => ({ finish: () => ({ source: 'measured' } as EegRecordingDraft), cancel: vi.fn() }) };
    const h = harness({ eegProvider: provider });
    h.enableEeg();
    h.press('Start at level 1');
    expect(textOf(h.root())).toContain('Muse S: measured');
    expect(textOf(h.root())).not.toMatch(/simulated/i);
    h.playToEnd([]);
    await h.flush();
    expect(h.eegStatus()).toBe('Muse S recording saved with this run.');
    expect(textOf(h.root())).not.toMatch(/simulated|not a measurement/i);
  });

  const simulatedProvider = (): EegCaptureProvider => ({ source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: () => ({ source: 'simulated' } as EegRecordingDraft), cancel: vi.fn() }) });

  it.each([
    ['consent-required', 'Simulated EEG (Demo Mode) was not saved: saving EEG needs your EEG consent.'],
    ['consent-unavailable', 'Simulated EEG (Demo Mode) wasn’t saved because your EEG consent couldn’t be loaded (you may be offline, on a slow connection, or have profile changes still uploading).'],
    ['invalid', 'Simulated EEG (Demo Mode) was not saved: the recording was incomplete.'],
    ['session-not-saved', 'Simulated EEG (Demo Mode) was not saved because the run was not saved.'],
    ['owner-changed', 'Simulated EEG (Demo Mode) was not saved because you signed out.'],
    ['already-recorded', 'Simulated EEG (Demo Mode) was already saved for this run.'],
  ] as const)('reports a skipped recording (%s) separately: the run is still saved', async (reason, copy) => {
    const h = harness({ eegProvider: simulatedProvider(), saveRecording: async () => ({ status: 'skipped', reason, message: reason }) });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe(copy);
  });

  it('reports a recording the server refused (consent withdrawn) without failing the run', async () => {
    let refuse!: () => void;
    const h = harness({
      eegProvider: simulatedProvider(),
      saveRecording: async (session) => ({
        status: 'queued',
        recordingId: session.sessionId,
        serverOutcome: new Promise((resolve) => { refuse = () => resolve({ status: 'refused', reason: 'consent-withdrawn', message: 'withdrawn' }); }),
      }),
    });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) recording saved on this device. Uploading… It is simulated data, not a measurement.');
    refuse();
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) was not saved: your EEG consent was withdrawn.');
  });

  it('offers the recording as soon as the session is queued, without waiting for the server (offline)', async () => {
    const h = harness({
      eegProvider: simulatedProvider(),
      saveImpl: async () => ({ sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', acknowledged: new Promise<void>(() => {}) }),
      saveRecording: async () => ({ status: 'skipped', reason: 'consent-unavailable', message: 'offline' }),
    });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.recordingSaves).toHaveBeenCalledTimes(1);
    expect(h.saveStatus()).toBe('Saved on this device. Uploading to your account…');
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) wasn’t saved because your EEG consent couldn’t be loaded (you may be offline, on a slow connection, or have profile changes still uploading).');
  });

  it('never makes the session wait on EEG: with the recording still checking consent, the run is saved', async () => {
    const h = harness({ eegProvider: simulatedProvider(), saveRecording: () => new Promise<EegRecordingSave>(() => {}) });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Saving Simulated EEG (Demo Mode)…');
  });

  it('reports an EEG save that throws as not saved, and the run as saved', async () => {
    const h = harness({ eegProvider: simulatedProvider(), saveRecording: async () => { throw new Error('boom'); } });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) couldn’t be saved.');
  });

  it('never offers the recording when the session save itself fails', async () => {
    const h = harness({ eegProvider: simulatedProvider(), saveImpl: async () => { throw new Error('The game session is not valid.'); } });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.recordingSaves).not.toHaveBeenCalled();
    expect(h.saveStatus()).toBe('This run couldn’t be saved. The game session is not valid.');
    expect(h.eegStatus()).toBeNull();
  });

  it('never lets a late save result from one run replace the next run, which keeps playing on screen', async () => {
    let finishSave!: () => void;
    let acknowledge!: () => void;
    const h = harness({
      saveImpl: (_input, call) => (call === 0
        // Run 1: the save is slow to queue (for example the EEG consent read), then waits for the network.
        ? new Promise<SaveResult>((resolve) => { finishSave = () => resolve({ sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', acknowledged: new Promise<void>((done) => { acknowledge = done; }) }); })
        : Promise.resolve({ sessionId: 'sessionAAAAAAAAAAAA2', userId: 'player-1', acknowledged: Promise.resolve() })),
    });
    h.press('Start at level 1');
    h.playToEnd([true]);
    await h.flush();
    expect(h.saveStatus()).toBe('Saving your run…');
    h.press('Play again');
    h.press('Start at level 1');
    h.advance(2_000);
    const runTwoQuestion = h.question();
    expect(runTwoQuestion).not.toBeNull();

    finishSave();
    await h.flush();
    acknowledge();
    await h.flush();
    // Run 2 is still the screen, still running, and nothing more was saved.
    expect(h.title()).toBeNull();
    expect(h.question()).toBe(runTwoQuestion);
    expect(h.hud('time')).toBe('0:43');
    expect(h.saves).toHaveLength(1);
    h.advance(1_000);
    expect(h.hud('time')).toBe('0:42');

    h.playToEnd([]);
    await h.flush();
    expect(h.saves).toHaveLength(2);
    expect(h.title()).toBe('Run complete');
    expect(h.saveStatus()).toBe('Run saved to your account.');
  });

  it('tears down a run whose screen was replaced, so it never plays on unseen or saves', async () => {
    const h = harness();
    h.press('Start at level 1');
    h.advance(5_000);
    act(() => h.renderer.unmount());
    h.advance(mentalMath.MAX_RUN_MS * 2);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.clock.pendingTimers).toBe(0);
  });

  it('still saves the run when the EEG capture fails to finish, and reports the recording as not captured', async () => {
    const provider: EegCaptureProvider = { source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: () => { throw new Error('capture broke'); }, cancel: vi.fn() }) };
    const h = harness({ eegProvider: provider });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([true]);
    await h.flush();
    expect(h.saves).toHaveLength(1);
    expect(h.recordingSaves).not.toHaveBeenCalled();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('No Simulated EEG (Demo Mode) was captured during this run.');
  });

  it('confirms a save whose acknowledgement was refused when the session is on the server (ambiguous commit)', async () => {
    const refused = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const getGameSession = vi.fn(async () => ({ status: 'readable', id: 'sessionAAAAAAAAAAAA1', data: { hasPendingWrites: false }, fromCache: false, hasPendingWrites: false }));
    const h = harness({
      getGameSession,
      saveImpl: async () => ({ sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', acknowledged: Promise.reject(refused) }),
    });
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(getGameSession).toHaveBeenCalledWith('sessionAAAAAAAAAAAA1');
    expect(h.saveStatus()).toBe('Run saved to your account.');
  });

  it('says the run could not be saved when the acknowledgement was refused and the session is not on the server', async () => {
    const refused = new Error('Missing or insufficient permissions.');
    const getGameSession = vi.fn(async () => ({ status: 'missing', id: 'sessionAAAAAAAAAAAA1', fromCache: false, hasPendingWrites: false }));
    const h = harness({
      getGameSession,
      saveImpl: async () => ({ sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', acknowledged: Promise.reject(refused) }),
    });
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(getGameSession).toHaveBeenCalledTimes(1);
    expect(h.saveStatus()).toBe('This run couldn’t be saved. Missing or insufficient permissions.');
  });

  it('keeps a pressed key focusable through the feedback flash, and ignores held keys', async () => {
    const listeners: Record<string, (event: KeyboardEvent) => void> = {};
    vi.stubGlobal('window', { addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { listeners[type] = listener; }, removeEventListener: vi.fn() });
    const h = harness();
    h.press('Start at level 1');
    h.advance(1_000);
    const preventDefault = vi.fn();
    const key = (name: string, repeat = false) => act(() => { listeners.keydown!({ key: name, repeat, altKey: false, ctrlKey: false, metaKey: false, preventDefault } as unknown as KeyboardEvent); });
    key('4');
    key('4', true);
    key('4', true);
    expect(h.hud('entry')).toBe('4');
    key('Enter');
    key('Enter', true);
    // During the flash the keys are aria-disabled, never disabled, so focus is not dropped.
    const submit = h.buttons('Submit')[0]!;
    expect(submit.props.disabled).toBeUndefined();
    expect(submit.props['aria-disabled']).toBe('true');
    expect(h.buttons('4')[0]!.props['aria-disabled']).toBe('true');
    // During the flash the keys are left to the browser.
    preventDefault.mockClear();
    key('Enter');
    key('7');
    expect(preventDefault).not.toHaveBeenCalled();
    h.advance(FEEDBACK_MS);
    expect(h.buttons('4')[0]!.props['aria-disabled']).toBeUndefined();
    h.press('Pause');
    // Paused: Enter, digits and Backspace keep their native behaviour, so Enter activates a focused Resume or Quit run.
    key('Enter');
    key('5');
    key('Backspace');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(h.buttons('Resume')).toHaveLength(1);
    h.press('Quit run');
    expect(h.saves[0]!.session.trials).toHaveLength(1);
    expect(h.saves[0]!.session.trials[0]).toMatchObject({ response: 4, rtMs: 1_000 });
    await h.flush();
  });

  it('gives identical trials and score with and without simulated EEG for the same seed and inputs', async () => {
    const script = [true, true, true, false, true, true, true, true, false, true];
    const plain = harness();
    plain.press('Start at level 1');
    plain.playToEnd(script, 1_100);
    const provider: EegCaptureProvider = { source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: () => ({ source: 'simulated' } as EegRecordingDraft), cancel: vi.fn() }) };
    const withEeg = harness({ eegProvider: provider });
    withEeg.enableEeg();
    withEeg.press('Start at level 1');
    withEeg.playToEnd(script, 1_100);
    await withEeg.flush();
    const a = plain.saves[0]!.session as MentalMathSessionDraft;
    const b = withEeg.saves[0]!.session as MentalMathSessionDraft;
    expect(b.trials).toEqual(a.trials);
    expect(b.summary).toEqual(a.summary);
    expect(plain.recordingSaves).not.toHaveBeenCalled();
    expect(withEeg.recordingSaves).toHaveBeenCalledTimes(1);
    expect(withEeg.recordingSaves.mock.calls[0]![1]).toMatchObject({ source: 'simulated' });
  });

  describe('post-session summary and per-game progress (NFCT-22)', () => {
    const SESSION_ID = 'sessionAAAAAAAAAAAA1';
    const format = (value: number) => new Intl.NumberFormat().format(value);
    const climb = [true, true, true, true, true, true, true];

    /** What trusted scoring writes for the run the harness saved: the shared decision the Cloud Function makes. */
    function trustedFor(h: ReturnType<typeof harness>, progress: GameProgress | null = null) {
      const document = { ...h.saves[0]!.session, schemaVersion: 1, userId: 'player-1', seed: SEED, createdAt: h.saves[0]!.session.endedAt } as unknown as ClientSessionDocument;
      const decision = previewDecision(progress, SESSION_ID, document);
      if (!decision) throw new Error('no decision');
      const processed = (result: ServerResult): GameSessionRecord => ({ id: SESSION_ID, session: { ...document, result } as unknown as GameSession, awaitingResult: false, hasPendingWrites: false });
      return { document, decision, processed };
    }

    it('shows the provisional score first, then the trusted result in the same place, with its breakdown, best and unlock', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.playToEnd(climb);
      await h.flush();
      expect(h.title()).toBe('Run complete');
      const local = (h.saves[0]!.session as MentalMathSessionDraft).summary;
      expect(h.byData('data-summary', 'verification')).toBe('Pending');
      expect(h.byData('data-summary', 'caption')).toBe('');
      expect(h.byData('data-result', 'score')).toBe(format(local.score));
      // Predicted achievements read exactly as confirmed ones (no layout shift), marked provisional.
      const pending = (name: string) => h.root().find((node) => node.props['data-summary'] === name && node.type === 'li').props['data-pending'];
      expect(h.byData('data-summary', 'record')).toBe('New personal best (pending)From level 1: best score, most correct answers and highest level.');
      expect(h.byData('data-summary', 'unlock')).toBe('Level 2 unlocked (pending)You can now start a run at level 2.');
      expect([pending('record'), pending('unlock')]).toEqual(['true', 'true']);
      // The totals count the run before it is scored, so they are marked too (NFCT-66).
      const totalsTitle = () => textOf(h.root().findByProps({ id: 'mm-totals-title' }));
      expect(totalsTitle()).toBe('Mental Math so far Pending');

      const { decision, processed } = trustedFor(h);
      if (decision.result.validity !== 'valid') throw new Error('expected a valid result');
      const result: ServerResult = { ...decision.result, score: 4321, metrics: { ...decision.result.metrics, difficultyPoints: 4000, speedBonusPoints: 321 } };
      h.publish(pickerState(decision.progress, [processed(result)]));
      expect(h.byData('data-summary', 'verification')).toBe('Final');
      expect(h.byData('data-summary', 'caption')).toBe('');
      expect(h.byData('data-result', 'score')).toBe(format(4321));
      expect(h.byData('data-result', 'difficulty-points')).toBe(format(4000));
      expect(h.byData('data-result', 'speed-bonus')).toBe(`+${format(321)}`);
      expect(h.byData('data-summary', 'record')).toBe('New personal bestFrom level 1: best score, most correct answers and highest level.');
      expect(h.byData('data-summary', 'unlock')).toBe('Level 2 unlockedYou can now start a run at level 2.');
      expect([pending('record'), pending('unlock')]).toEqual(['false', 'false']);
      expect(h.byData('data-total', 'runs-completed')).toBe('1');
      expect(totalsTitle()).toBe('Mental Math so far');
      expect(textOf(h.root())).not.toMatch(/EEG|µV|alpha|theta|focus/i);

      // The unlocked level is selectable in the picker.
      h.press('Play again');
      expect(h.radio(2).props.disabled).toBe(false);
      expect(h.radio(3).props.disabled).toBe(true);
    });

    it('explains a flagged run and never presents it as a record', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.playToEnd(climb);
      await h.flush();
      const { decision, processed } = trustedFor(h);
      const flagged = { ...decision.result, validity: 'flagged', reasons: ['rt-below-floor'] } as ServerResult;
      h.publish(pickerState(null, [processed(flagged)]));
      expect(h.byData('data-summary', 'verification')).toBe('Flagged');
      expect(h.byData('data-summary', 'caption')).toBe('Too many answers came in faster than allowed. It counts toward your totals, but not your records or unlocks.');
      expect(h.byData('data-summary', 'record')).toContain('Flagged runs don’t set records');
      expect(h.byData('data-summary', 'unlock')).toContain('Next unlock: start level 2');
    });

    it('says an unfinished run sets no record', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.advance(2_000);
      h.press('Pause');
      h.press('Quit run');
      await h.flush();
      expect(h.title()).toBe('Run ended early');
      expect(h.byData('data-summary', 'record')).toContain('Unfinished runs don’t set records');
    });

    /** A processed history row for a run played with the fixtures, and the progress after it. */
    function playedEntry(id: string, startLevel: number, correct: number, wallStartMs: number, progress: GameProgress | null) {
      const document = clientSessionDocument(playRun({ seed: SEED, startLevel, correct, wallStartMs }), { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }, { sessionId: id, userId: 'player-1', seed: SEED });
      const decision = previewDecision(progress, id, document)!;
      const entry: GameSessionHistoryEntry = { id, session: readSessionProgressFields({ ...document, result: decision.result }), awaitingResult: false, hasPendingWrites: false };
      return { entry, decision };
    }

    it('opens the game’s progress from the picker: totals, bests per start level, and cursor-paged history', async () => {
      const one = playedEntry('sessionBBBBBBBBBBBB1', 1, 7, 1_790_000_000_000, null);
      const two = playedEntry('sessionBBBBBBBBBBBB2', 2, 2, 1_790_000_200_000, one.decision.progress);
      const cursor = { uid: 'player-1', gameId: 'mental-math', endedAt: two.entry.session.endedAt, id: two.entry.id };
      const listGameSessionHistory = vi.fn(async () => ({ entries: [one.entry], unreadable: [], nextCursor: null, fromCache: false }));
      const h = harness({
        state: pickerState(two.decision.progress),
        history: { entries: [two.entry], unreadable: [], nextCursor: cursor, fromCache: false },
        listGameSessionHistory,
      });
      h.press('Progress');
      expect(textOf(h.root().findByProps({ id: 'mm-progress-title' }))).toBe('Your Mental Math');
      expect(h.byData('data-total', 'runs-completed')).toBe('2');
      expect(h.byData('data-total', 'unlocked')).toBe('2 of 10');
      const score = (result: ServerResult) => (result.validity === 'invalid' ? '' : format(result.score));
      expect(textOf(h.root().findByProps({ 'data-best-level': 1 }))).toBe(`Level 1${score(one.decision.result)}7 correct · reached level 3`);
      expect(textOf(h.root().findByProps({ 'data-best-level': 2 }))).toBe(`Level 2${score(two.decision.result)}2 correct · reached level 2`);
      const rows = () => h.root().findAll((node) => typeof node.props['data-history-row'] === 'string' && node.type === 'li').map((node) => node.props['data-history-row']);
      expect(rows()).toEqual([two.entry.id]);
      expect(textOf(h.root())).not.toMatch(/EEG|µV|alpha|theta|focus/i);

      h.press('Show more runs');
      await h.flush();
      expect(listGameSessionHistory).toHaveBeenCalledWith({ gameId: 'mental-math', pageSize: 10, cursor });
      expect(rows()).toEqual([two.entry.id, one.entry.id]);
      expect(h.buttons('Show more runs')).toHaveLength(0);

      h.press('Back');
      expect(h.radio(2).props.disabled).toBe(false);
    });

    it('opens on the progress screen when asked, and Back leaves the game', () => {
      const h = harness({ initialView: 'progress' });
      expect(textOf(h.root().findByProps({ id: 'mm-progress-title' }))).toBe('Your Mental Math');
      expect(textOf(h.root())).toContain('No runs yet.');
      h.press('Back');
      expect(h.onExit).toHaveBeenCalledTimes(1);
    });
  });

  describe('summary and progress polish (NFCT-52)', () => {
    const format = (value: number) => new Intl.NumberFormat().format(value);
    const climb = [true, true, true, true, true, true, true];
    const highlight = (h: ReturnType<typeof harness>, name: string) => h.root().find((node) => node.props['data-summary'] === name && node.type === 'li');
    const totalsNote = (h: ReturnType<typeof harness>) => textOf(h.root().find((node) => typeof node.props.className === 'string' && node.props.className.includes('mm-totals-note')));
    const provisionalTags = (node: ReactTestInstance) => node.findAll((item) => item.props['data-provisional'] === 'true' && typeof item.type === 'string');

    it('while the records load, says so in the cards and the totals, without claiming checked totals', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.holdNewProgressListeners(true);
      h.playToEnd(climb);
      await h.flush();
      expect(h.byData('data-summary', 'record')).toBe('RecordsLoading your records…');
      expect(h.byData('data-summary', 'unlock')).toBe('Start levelsLoading your start levels…');
      expect(h.byData('data-total', 'runs-completed')).toBe('—');
      expect(totalsNote(h)).toBe('Loading your totals…');

      // The records arrive: the preview counts this run, and the loading note goes.
      h.publish(pickerState(null));
      expect(h.byData('data-total', 'runs-completed')).toBe('1');
      expect(h.root().findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('mm-totals-note'))).toHaveLength(0);
    });

    it('marks a predicted flag as provisional, like a predicted best, until the server decides', async () => {
      const h = harness();
      h.press('Start at level 1');
      // Answers far faster than the 250 ms floor: the preview predicts the server's rt-below-floor flag.
      h.playToEnd([true, true, true, true, true, true, true, true, true, true], 100);
      await h.flush();
      expect(h.byData('data-summary', 'verification')).toBe('Pending');
      expect(h.byData('data-summary', 'record')).toBe('Flagged runs don’t set records (pending)No record yet from level 1.');
      expect(highlight(h, 'record').props['data-pending']).toBe('true');

      const document = { ...h.saves[0]!.session, schemaVersion: 1, userId: 'player-1', seed: SEED, createdAt: h.saves[0]!.session.endedAt } as unknown as ClientSessionDocument;
      const decision = previewDecision(null, 'sessionAAAAAAAAAAAA1', document)!;
      expect(decision.result).toMatchObject({ validity: 'flagged', reasons: ['rt-below-floor'] });
      h.publish(pickerState(decision.progress, [{ id: 'sessionAAAAAAAAAAAA1', session: { ...document, result: decision.result } as unknown as GameSession, awaitingResult: false, hasPendingWrites: false }]));
      expect(h.byData('data-summary', 'verification')).toBe('Flagged');
      expect(h.byData('data-summary', 'record')).toBe('Flagged runs don’t set recordsNo record yet from level 1.');
      expect(highlight(h, 'record').props['data-pending']).toBe('false');
    });

    it('says a run flagged only for its locked start level counts toward records once that level is unlocked', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.playToEnd(climb);
      await h.flush();
      const document = { ...h.saves[0]!.session, schemaVersion: 1, userId: 'player-1', seed: SEED, createdAt: h.saves[0]!.session.endedAt } as unknown as ClientSessionDocument;
      const decision = previewDecision(null, 'sessionAAAAAAAAAAAA1', document)!;
      const locked = { ...decision.result, validity: 'flagged', reasons: ['start-level-locked'] } as ServerResult;
      h.publish(pickerState(null, [{ id: 'sessionAAAAAAAAAAAA1', session: { ...document, result: locked } as unknown as GameSession, awaitingResult: false, hasPendingWrites: false }]));
      expect(h.byData('data-summary', 'caption')).toBe('This start level wasn’t unlocked yet when this run was scored. It counts toward your totals now, and toward your records and unlocks once that level is unlocked.');
      expect(h.byData('data-summary', 'record')).toBe('Not a record yetThis run can still set a record once level 1 is unlocked.');
    });

    it('keeps the flagged copy for an unfinished run at a locked start level: an upgrade gives it no records or unlocks', async () => {
      const h = harness();
      h.press('Start at level 1');
      h.advance(2_000);
      h.press('Pause');
      h.press('Quit run');
      await h.flush();
      const document = { ...h.saves[0]!.session, schemaVersion: 1, userId: 'player-1', seed: SEED, createdAt: h.saves[0]!.session.endedAt } as unknown as ClientSessionDocument;
      const decision = previewDecision(null, 'sessionAAAAAAAAAAAA1', document)!;
      const locked = { ...decision.result, validity: 'flagged', reasons: ['start-level-locked'] } as ServerResult;
      h.publish(pickerState(null, [{ id: 'sessionAAAAAAAAAAAA1', session: { ...document, result: locked } as unknown as GameSession, awaitingResult: false, hasPendingWrites: false }]));
      expect(h.byData('data-summary', 'caption')).toBe('This start level wasn’t unlocked yet when this run was scored. It counts toward your totals, but not your records or unlocks.');
      expect(h.byData('data-summary', 'record')).toBe('Flagged runs don’t set recordsNo record yet from level 1.');
    });

    it('marks the picker’s best as provisional while a run the server hasn’t checked holds it', () => {
      const pending = sessionRecord('sessionBBBBBBBBBBBB1', playRun({ seed: SEED, startLevel: 1, correct: 7 }), { seed: SEED });
      const h = harness({ state: pickerState(null, [pending]) });
      const best = h.root().find((node) => node.props['data-picker'] === 'best');
      expect(textOf(best)).toMatch(/^Your best from level 1: [\d,]+ Pending$/);
      expect(provisionalTags(best)).toHaveLength(1);

      // Once the server has checked it, the same best is shown plainly.
      const decision = previewDecision(null, pending.id, pending.session as unknown as ClientSessionDocument)!;
      h.publish(pickerState(decision.progress, [{ ...pending, session: { ...pending.session, result: decision.result }, awaitingResult: false, hasPendingWrites: false }]));
      expect(textOf(best)).toMatch(/^Your best from level 1: [\d,]+$/);
      expect(provisionalTags(best)).toHaveLength(0);
    });

    it('keeps the picker’s level and EEG choice across Progress and Back', () => {
      const eegProvider: EegCaptureProvider = { source: 'simulated', label: 'Simulated EEG (Demo Mode)', start: () => ({ finish: () => ({ source: 'simulated' } as EegRecordingDraft), cancel: vi.fn() }) };
      const h = harness({ state: pickerState(progressWith(5)), eegProvider });
      // Start level 4 is unlocked and is the default; the player picks level 2 and EEG.
      expect(h.radio(4).props.checked).toBe(true);
      act(() => { h.radio(2).props.onChange(); });
      h.enableEeg();
      h.press('Progress');
      expect(textOf(h.root().findByProps({ id: 'mm-progress-title' }))).toBe('Your Mental Math');
      h.press('Back');
      expect(h.radio(2).props.checked).toBe(true);
      expect(h.root().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked).toBe(true);
      expect(h.buttons('Start at level 2')).toHaveLength(1);
    });

    it('marks bests held by unchecked runs as provisional, and tags a verified record run “New best”', () => {
      const pending = sessionRecord('sessionBBBBBBBBBBBB2', playRun({ seed: SEED, startLevel: 1, correct: 7, wallStartMs: 1_790_000_200_000 }), { seed: SEED });
      const checked = playRun({ seed: SEED, startLevel: 1, correct: 3, wallStartMs: 1_790_000_000_000 });
      const checkedDocument = clientSessionDocument(checked, { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }, { sessionId: 'sessionBBBBBBBBBBBB1', userId: 'player-1', seed: SEED });
      const decision = previewDecision(null, 'sessionBBBBBBBBBBBB1', checkedDocument)!;
      const entry: GameSessionHistoryEntry = { id: 'sessionBBBBBBBBBBBB1', session: readSessionProgressFields({ ...checkedDocument, result: decision.result }), awaitingResult: false, hasPendingWrites: false };
      const h = harness({ initialView: 'progress', state: pickerState(decision.progress, [pending]), history: { entries: [entry], unreadable: [], nextCursor: null, fromCache: false } });
      const levelOne = h.root().findByProps({ 'data-best-level': 1 });
      expect(provisionalTags(levelOne)).toHaveLength(1);
      expect(textOf(levelOne)).toMatch(/^Level 1Pending[\d,]+7 correct · reached level 3$/);
      // The history shows trusted results only: the checked run set a best when it was processed.
      const row = h.root().findByProps({ 'data-history-row': 'sessionBBBBBBBBBBBB1' });
      expect(textOf(row)).toContain('New best');
      expect(textOf(row)).not.toContain('Personal best');
      expect(textOf(row)).toContain(format(decision.result.validity === 'valid' ? decision.result.score : 0));
    });
  });
});
