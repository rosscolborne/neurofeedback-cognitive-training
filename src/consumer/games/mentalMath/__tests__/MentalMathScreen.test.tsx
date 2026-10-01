import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentalMath } from '@nfct/shared';
import type { EegCaptureProvider } from '../../../eeg/eegCapture';
import type { EegRecordingDraft, EegRecordingSave } from '../../../repositories/eegRecordingRepository';
import type { SaveGameSessionInput, SavedGameSession, StartedGameSession } from '../../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../../repositories/progressRepository';
import { MentalMathScreen, type MentalMathScreenProps } from '../MentalMathScreen';
import type { VisibilitySource } from '../visibility';
import { FEEDBACK_MS } from '../runController';
import type { MentalMathSessionDraft } from '../sessionDraft';
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

function harness({ state = pickerState(null), eegProvider = null, saveImpl, saveRecording = acknowledgedRecording, getGameSession = vi.fn() } = {} as {
  state?: ProgressWithRecentSessions; eegProvider?: EegCaptureProvider | null;
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
  const gameSessions = { startGameSession, getGameSession: getGameSession as MentalMathScreenProps['gameSessions']['getGameSession'] };
  const progress = { subscribeToProgressWithRecentSessions: vi.fn((_gameId: string, _options: object, onNext: (value: ProgressWithRecentSessions) => void) => { onNext(state); return () => {}; }) };
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
    advance(mentalMath.RUN_DURATION_MS * 2);
  };
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };
  const title = () => root().findAll((node) => node.props.id === 'mm-handoff-title').map((node) => textOf(node))[0] ?? null;
  const saveStatus = () => root().findAll((node) => typeof node.props.className === 'string' && node.props.className.startsWith('mm-save ')).map((node) => textOf(node))[0] ?? null;
  const eegStatus = () => root().findAll((node) => typeof node.props.className === 'string' && node.props.className.includes('mm-eeg-status')).map((node) => textOf(node))[0] ?? null;
  const enableEeg = () => act(() => { root().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); });
  return { renderer, root, clock, visibility, save, saves, savedResults, events, recordingSaves, eegStatus, enableEeg, startGameSession, onExit, buttons, press, advance, question, hud, radio, typeAnswer, playToEnd, flush, title, saveStatus };
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

  it('plays a full run with the keypad, answers each question once, and saves once as completed', () => {
    const h = harness();
    h.press('Start at level 1');
    expect(h.hud('time')).toBe('1:30');
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
    h.advance(FEEDBACK_MS);
    expect(h.hud('score')).not.toBe('0');
    expect(h.save).not.toHaveBeenCalled();

    h.playToEnd([true, true, false, true, true]);
    expect(h.save).toHaveBeenCalledTimes(1);
    const input = h.saves[0]!;
    const session = input.session as MentalMathSessionDraft;
    expect(session).toMatchObject({ gameId: 'mental-math', modeId: 'timed-90', status: 'completed', startLevel: 1, activeDurationMs: 90_000 });
    // Six answered questions, plus the timeouts after them; nothing for the question on screen at expiry.
    expect(session.trials.filter((trial) => !trial.timedOut)).toHaveLength(6);
    expect(session.trials[0]!.rtMs).toBe(3_000);
    expect(session.summary.score).toBe(mentalMath.score(session.trials, { modeId: 'timed-90', startLevel: 1 }).score);
    expect(h.recordingSaves).not.toHaveBeenCalled();
    expect(h.root().findByProps({ id: 'mm-handoff-title' }).children.join('')).toBe('Run complete');
    // No partial-run state is ever written to browser storage.
    expect(storageWrites).not.toHaveBeenCalled();
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
    h.advance(mentalMath.RUN_DURATION_MS * 2);
    expect(h.save).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.clock.pendingTimers).toBe(0);
    expect(storageWrites).not.toHaveBeenCalled();
  });

  it('pauses with a frozen clock and a discarded question, and resumes with a fresh one', () => {
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
    expect(h.hud('time')).toBe('1:26');
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
    ['consent-unavailable', 'Simulated EEG (Demo Mode) wasn’t saved because your EEG consent couldn’t be confirmed: you were offline or the connection was too slow.'],
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
    expect(h.eegStatus()).toBe('Simulated EEG (Demo Mode) wasn’t saved because your EEG consent couldn’t be confirmed: you were offline or the connection was too slow.');
  });

  it('never makes the session wait on EEG: with the recording still checking consent, the run is saved', async () => {
    const h = harness({ eegProvider: simulatedProvider(), saveRecording: () => new Promise<EegRecordingSave>(() => {}) });
    h.enableEeg();
    h.press('Start at level 1');
    h.playToEnd([]);
    await h.flush();
    expect(h.saveStatus()).toBe('Run saved to your account.');
    expect(h.eegStatus()).toBe('Checking your EEG consent before saving Simulated EEG (Demo Mode)…');
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
    expect(h.hud('time')).toBe('1:28');
    expect(h.saves).toHaveLength(1);
    h.advance(1_000);
    expect(h.hud('time')).toBe('1:27');

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
    h.advance(mentalMath.RUN_DURATION_MS * 2);
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

  it('keeps a pressed key focusable through the feedback flash, and ignores held keys', () => {
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
});
