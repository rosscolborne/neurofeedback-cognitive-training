import { describe, expect, it } from 'vitest';
import { sequenceMemoryV1 as sm } from '@nfct/shared';
import { correct, corrects, play, timeout, wrong } from './helpers';

const ctx = (startLevel: number) => ({ modeId: sm.MODE_ID, startLevel });

describe('Sequence Memory v1 scoring', () => {
  it('scores 10 × (level + 1) per correct trial, with no speed bonus', () => {
    expect(sm.LEVELS.map(({ level }) => sm.pointsFor(level))).toEqual([20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
    const slow = play(1, 1, corrects(2, 1_500));
    const fast = play(1, 1, corrects(2, 300));
    expect(sm.score(slow.trials, ctx(1)).score).toBe(40);
    expect(sm.score(fast.trials, ctx(1)).score).toBe(40);
  });

  it('derives every metric from the trials', () => {
    const run = play(5, 2, [correct(), correct(), wrong(1), timeout(1), correct()]);
    expect(run.trials.map((trial) => trial.level)).toEqual([2, 2, 3, 2, 1]);
    expect(sm.score(run.trials, ctx(2))).toEqual({
      score: 30 + 30 + 20,
      accuracy: 3 / 5,
      responseTime: expect.objectContaining({ p90Ms: 5_000 }),
      peakLevel: 3,
      metrics: { correct: 3, attempted: 5, timedOut: 1, finalLevel: 1, longestSpan: 3 },
    });
  });

  it('never trusts the client flags: a claimed correct trial with a wrong tile scores nothing', () => {
    const run = play(5, 4, [wrong(0)]);
    const forged = run.trials.map((trial) => ({ ...trial, correct: true }));
    expect(sm.score(forged, ctx(4)).score).toBe(0);
  });

  it('judges with the level\'s limit, not the trial\'s', () => {
    const run = play(5, 1, [correct(1_900)]);
    expect(sm.score(run.trials, ctx(1)).metrics.correct).toBe(1);
    const lateButClaimed = run.trials.map((trial) => ({ ...trial, tapAtMs: [1_900, 4_000], rtMs: 4_000, responseLimitMs: 9_000 }));
    expect(sm.score(lateButClaimed, ctx(1)).metrics).toMatchObject({ correct: 0, timedOut: 1 });
  });

  it('reports the start level for an empty run', () => {
    expect(sm.score([], ctx(6))).toEqual({
      score: 0,
      accuracy: null,
      responseTime: null,
      peakLevel: 6,
      metrics: { correct: 0, attempted: 0, timedOut: 0, finalLevel: 6, longestSpan: 0 },
    });
  });

  it('refuses another mode or a start level outside 1-10', () => {
    expect(() => sm.score([], { modeId: 'reverse', startLevel: 1 })).toThrow(/mode/);
    expect(() => sm.score([], ctx(11))).toThrow(RangeError);
  });
});
