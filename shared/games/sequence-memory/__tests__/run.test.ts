import { describe, expect, it } from 'vitest';
import { sequenceMemoryV1 as sm } from '@nfct/shared';
import { correct, corrects, fullRun, otherTile, pause, play, timeout, wrong } from './helpers';

describe('Sequence Memory v1 run reducer', () => {
  it('records a correct trial when the last tile is tapped, and moves up after two', () => {
    const run = play(7, 1, corrects(2));
    expect(run.trials.map((trial) => [trial.level, trial.correct, trial.timedOut])).toEqual([[1, true, false], [1, true, false]]);
    expect(run.staircase.level).toBe(2);
    const [first] = run.trials;
    expect(first).toMatchObject({ gridSize: 3, presentationMs: 2_600, responseLimitMs: 4_000, shownAtMs: 0, rtMs: 800, tapAtMs: [400, 800] });
    expect(first!.response).toEqual(first!.sequence);
    expect(run.trials[1]!.shownAtMs).toBe(sm.trialEndMs(first!));
  });

  it('ends a trial at the first wrong tile, keeping the taps up to and including it', () => {
    const run = play(7, 4, [wrong(2, 300)]);
    const [trial] = run.trials;
    expect(trial).toMatchObject({ correct: false, timedOut: false, rtMs: 900, tapAtMs: [300, 600, 900] });
    expect(trial!.response.slice(0, 2)).toEqual(trial!.sequence.slice(0, 2));
    expect(trial!.response[2]).not.toBe(trial!.sequence[2]);
    expect(run.staircase.level).toBe(3);
  });

  it('times out with the taps made so far, at the response limit', () => {
    const run = play(7, 2, [timeout(1)]);
    expect(run.trials[0]).toMatchObject({ correct: false, timedOut: true, rtMs: 5_000, tapAtMs: [300] });
    expect(run.trials[0]!.response).toHaveLength(1);
  });

  it('treats a tap at the limit as too late: the trial times out without it', () => {
    let run = sm.presentTrial(sm.startRun({ seed: 3, startLevel: 1 }), 0);
    const current = run.current!;
    const result = sm.tapTile(run, { trialId: current.id, tile: current.sequence[0]!, atMs: current.responseLimitMs });
    expect(result.accepted && result.trial).toMatchObject({ timedOut: true, response: [], tapAtMs: [], rtMs: current.responseLimitMs });
    run = sm.presentTrial(sm.startRun({ seed: 3, startLevel: 1 }), 0);
    const justInTime = sm.tapTile(run, { trialId: current.id, tile: current.sequence[0]!, atMs: current.responseLimitMs - 1 });
    expect(justInTime.accepted && justInTime.trial).toBeNull();
  });

  it('ignores taps for another trial or with nothing on screen', () => {
    const run = sm.presentTrial(sm.startRun({ seed: 3, startLevel: 1 }), 0);
    expect(sm.tapTile(run, { trialId: 't0', tile: 0, atMs: 10 })).toMatchObject({ accepted: false, reason: 'stale-trial' });
    expect(sm.tapTile(sm.startRun({ seed: 3, startLevel: 1 }), { trialId: 't1', tile: 0, atMs: 10 }))
      .toMatchObject({ accepted: false, reason: 'no-trial' });
  });

  it('refuses taps off the board or back in time', () => {
    let run = sm.presentTrial(sm.startRun({ seed: 3, startLevel: 3 }), 0);
    const current = run.current!;
    expect(() => sm.tapTile(run, { trialId: current.id, tile: 9, atMs: 10 })).toThrow(RangeError);
    const first = sm.tapTile(run, { trialId: current.id, tile: current.sequence[0]!, atMs: 500 });
    run = first.run;
    expect(() => sm.tapTile(run, { trialId: current.id, tile: current.sequence[1]!, atMs: 499 })).toThrow(RangeError);
  });

  it('discarding keeps the position and level and presents the next variant, never the same sequence', () => {
    let run = play(11, 5, [correct()]);
    run = sm.presentTrial(run, sm.recordedActiveMs(run));
    const shown = run.current!;
    run = sm.discardTrial(run);
    expect(run.trials).toHaveLength(1);
    expect(run.staircase).toEqual({ level: 5, levelStreak: 1 });
    run = sm.presentTrial(run, sm.recordedActiveMs(run));
    expect(run.current!.position).toBe(shown.position);
    expect(run.current!.variant).toBe((shown.variant + 1) % sm.SEQUENCE_VARIANTS);
    expect(run.current!.sequence).not.toEqual(shown.sequence);
    expect(run.current!.id).not.toBe(shown.id);
  });

  it('a pause mid-response drops the partial taps', () => {
    let run = sm.presentTrial(sm.startRun({ seed: 9, startLevel: 2 }), 0);
    const current = run.current!;
    run = sm.tapTile(run, { trialId: current.id, tile: current.sequence[0]!, atMs: 400 }).run;
    run = sm.discardTrial(run);
    expect(run.trials).toEqual([]);
    expect(run.current).toBeNull();
  });

  it('a run is complete after TRIALS_PER_RUN trials and presents no more', () => {
    const run = fullRun();
    expect(run.trials).toHaveLength(sm.TRIALS_PER_RUN);
    expect(sm.isRunComplete(run)).toBe(true);
    expect(() => sm.presentTrial(run, sm.recordedActiveMs(run))).toThrow(/trials/);
  });

  it('refuses to present before the previous trial ended, or with one on screen', () => {
    const run = play(1, 1, [correct()]);
    expect(() => sm.presentTrial(run, sm.recordedActiveMs(run) - 1)).toThrow(RangeError);
    const shown = sm.presentTrial(run, sm.recordedActiveMs(run));
    expect(() => sm.presentTrial(shown, sm.recordedActiveMs(run))).toThrow(/already/);
  });

  it('property: replayed levels and seeds always match what the reducer recorded', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const steps = Array.from({ length: 30 }, (_, index) => {
        const pick = (seed * 31 + index * 17) % 9;
        return pick < 5 ? correct(250 + pick * 40) : pick < 7 ? wrong(pick - 5) : pick < 8 ? timeout(0) : pause(200);
      });
      const run = play(seed, 1 + (seed % 10), steps);
      const levels = sm.replayLevels(run.startLevel, run.trials.map(sm.isCorrectTrial));
      expect(run.trials.map((trial) => trial.level)).toEqual(levels);
      expect(sm.validateTrialsAgainstSeed(seed, run.trials).issues).toEqual([]);
    }
  });

  it('uses another tile for a wrong tap', () => {
    const run = sm.presentTrial(sm.startRun({ seed: 1, startLevel: 1 }), 0);
    expect(otherTile(run.current!, 8)).toBe(0);
  });
});
