import { describe, expect, it, vi } from 'vitest';
import { sequenceMemory as sm } from '@nfct/shared';
import { ManualClock } from '../../mentalMath/__tests__/manualClock';
import { FEEDBACK_MS, SequenceMemoryRunController, type RunOutcome } from '../runController';

const SEED = 4242;

function setup(startLevel = 1) {
  const clock = new ManualClock();
  const onEnd = vi.fn<(outcome: RunOutcome) => void>();
  const controller = new SequenceMemoryRunController({ seed: SEED, startLevel, clock, onEnd });
  const snap = () => controller.getSnapshot();
  /** The sequence on screen, as the reducer holds it (what the board lit up). */
  const sequence = () => (controller as unknown as { run: sm.SequenceMemoryRun }).run.current!.sequence;
  /** Taps `tiles`, `gapMs` apart. */
  const tapAll = (tiles: readonly number[], gapMs = 400) => {
    for (const tile of tiles) {
      clock.advance(gapMs);
      controller.tap(snap().trial!.id, tile);
    }
  };
  return { clock, onEnd, controller, snap, sequence, tapAll };
}

describe('SequenceMemoryRunController', () => {
  it('lights the sequence one tile at a time, then opens the response phase at the level\'s presentation length', () => {
    const { controller, clock, snap, sequence } = setup(3);
    controller.start();
    const params = sm.levelParams(3);
    expect(snap()).toMatchObject({ phase: 'presenting', litTile: null, trial: { level: 3, gridSize: 3, span: 4 } });
    const shown = sequence();
    for (const [step, tile] of shown.entries()) {
      clock.advance(step === 0 ? sm.LEAD_IN_MS : params.gapMs);
      expect(snap()).toMatchObject({ litTile: tile, litStep: step });
      clock.advance(params.litMs);
      expect(snap().litTile).toBeNull();
    }
    clock.advance(params.gapMs);
    expect(snap()).toMatchObject({ phase: 'responding', responseLimitMs: params.responseLimitMs, responseRemainingMs: params.responseLimitMs });
  });

  it('ignores taps during the presentation and taps for another trial', () => {
    const { controller, clock, snap, sequence } = setup();
    controller.start();
    const id = snap().trial!.id;
    clock.advance(1_000);
    controller.tap(id, sequence()[0]!);
    expect(snap().tapped).toEqual([]);
    clock.advance(sm.levelParams(1).presentationMs);
    controller.tap('t99', sequence()[0]!);
    expect(snap().tapped).toEqual([]);
  });

  it('records a correct trial, flashes feedback off the active clock, and presents the next trial where the last ended', () => {
    const { controller, clock, snap, sequence, tapAll } = setup();
    controller.start();
    const shown = sequence();
    clock.advance(sm.levelParams(1).presentationMs);
    tapAll(shown, 500);
    expect(snap()).toMatchObject({ phase: 'feedback', trialsRecorded: 1, score: 20, feedback: { correct: true, timedOut: false } });
    clock.advance(FEEDBACK_MS);
    expect(snap().phase).toBe('presenting');
    const run = (controller as unknown as { run: sm.SequenceMemoryRun }).run;
    expect(run.trials[0]).toMatchObject({ correct: true, rtMs: 1_000, tapAtMs: [500, 1_000], shownAtMs: 0 });
    expect(run.current!.shownAtMs).toBe(sm.trialEndMs(run.trials[0]!));
  });

  it('ends a trial at the first wrong tile, and times one out at the response limit', () => {
    const { controller, clock, snap, sequence } = setup();
    controller.start();
    const params = sm.levelParams(1);
    clock.advance(params.presentationMs + 300);
    const wrongTile = (sequence()[0]! + 1) % 9;
    controller.tap(snap().trial!.id, wrongTile);
    expect(snap().feedback).toMatchObject({ correct: false, timedOut: false, response: [wrongTile] });
    clock.advance(FEEDBACK_MS + params.presentationMs);
    clock.advance(params.responseLimitMs);
    expect(snap().feedback).toMatchObject({ correct: false, timedOut: true, response: [] });
  });

  it('a pause during the presentation discards the trial; resuming shows a fresh sequence, and the lost time is not active time', () => {
    const { controller, clock, snap, sequence, tapAll } = setup(5);
    controller.start();
    const first = { id: snap().trial!.id, sequence: sequence() };
    clock.advance(2_000);
    controller.pause('background');
    expect(snap()).toMatchObject({ phase: 'paused', pauseReason: 'background', trial: null, litTile: null });
    clock.advance(60_000);
    controller.resume();
    expect(snap().phase).toBe('presenting');
    expect(snap().trial!.id).not.toBe(first.id);
    expect(sequence()).not.toEqual(first.sequence);
    const run = (controller as unknown as { run: sm.SequenceMemoryRun }).run;
    expect(run.current).toMatchObject({ position: 0, shownAtMs: 0, level: 5 });
    clock.advance(sm.levelParams(5).presentationMs);
    tapAll(sequence(), 400);
    expect((controller as unknown as { run: sm.SequenceMemoryRun }).run.trials).toHaveLength(1);
  });

  it('a pause during the response drops the taps made so far', () => {
    const { controller, clock, snap, sequence } = setup(2);
    controller.start();
    clock.advance(sm.levelParams(2).presentationMs + 400);
    controller.tap(snap().trial!.id, sequence()[0]!);
    expect(snap().tapped).toHaveLength(1);
    controller.pause();
    controller.resume();
    expect(snap()).toMatchObject({ phase: 'presenting', tapped: [], trialsRecorded: 0 });
  });

  it('completes after TRIALS_PER_RUN trials, once, with a session trusted scoring finds valid', () => {
    const { controller, clock, snap, sequence, tapAll, onEnd } = setup();
    controller.start();
    for (let trial = 0; trial < sm.TRIALS_PER_RUN; trial += 1) {
      if (trial === 4) {
        clock.advance(700);
        controller.pause();
        controller.resume();
      }
      clock.advance(sm.levelParams(snap().trial!.level).presentationMs);
      const tiles = sequence();
      tapAll(trial % 4 === 3 ? [(tiles[0]! + 1) % (snap().trial!.gridSize ** 2)] : tiles, 350);
      clock.advance(FEEDBACK_MS);
    }
    expect(onEnd).toHaveBeenCalledOnce();
    const outcome = onEnd.mock.calls[0]![0];
    expect(outcome.status).toBe('completed');
    expect(outcome.run.trials).toHaveLength(sm.TRIALS_PER_RUN);
    expect(outcome.activeDurationMs).toBe(sm.recordedActiveMs(outcome.run));
    const report = sm.checkSession({
      modeId: sm.MODE_ID,
      startLevel: 1,
      peakLevel: sm.runPeakLevel(outcome.run),
      status: outcome.status,
      activeDurationMs: outcome.activeDurationMs,
      seed: SEED,
      trials: outcome.run.trials,
    });
    expect(report).toMatchObject({ outcome: 'valid', reasons: [] });
    expect(snap().phase).toBe('ended');
  });

  it('quitting ends the run as abandoned, and as completed once every trial is recorded', () => {
    const early = setup();
    early.controller.start();
    early.clock.advance(1_000);
    early.controller.quit();
    expect(early.onEnd.mock.calls[0]![0]).toMatchObject({ status: 'abandoned', activeDurationMs: 0 });

    const late = setup(10);
    late.controller.start();
    for (let trial = 0; trial < sm.TRIALS_PER_RUN; trial += 1) {
      // Every trial times out, so the level falls: wait out each trial at its own level.
      const params = sm.levelParams(late.snap().trial!.level);
      late.clock.advance(params.presentationMs + params.responseLimitMs);
      if (trial < sm.TRIALS_PER_RUN - 1) late.clock.advance(FEEDBACK_MS);
    }
    expect(late.snap().phase).toBe('feedback');
    late.controller.quit();
    expect(late.onEnd.mock.calls[0]![0]).toMatchObject({ status: 'completed' });
  });

  it('dispose stops everything without reporting a run', () => {
    const { controller, clock, onEnd } = setup();
    controller.start();
    controller.dispose();
    clock.advance(1_000_000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(clock.pendingTimers).toBe(0);
  });
});
