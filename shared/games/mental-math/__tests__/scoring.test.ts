import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { createRng } from '../v1/rng';
import { PLAYER_PROFILES, simulateRun } from '../simulation';

type Trial = mm.MentalMathTrial;
const ctx = (startLevel: number) => ({ modeId: mm.MODE_ID, startLevel });

function trial(level: number, operands: number[], operators: mm.Operator[], response: number | null, rtMs: number, grouped = false): Trial {
  const expected = mm.evaluate({ operands, operators, grouped })!;
  const timeLimitMs = mm.timeLimitFor(level);
  return {
    level, operands, operators, grouped, expected, response,
    correct: response === expected, timedOut: response === null,
    shownAtMs: 0, rtMs: response === null ? timeLimitMs : rtMs, timeLimitMs,
  };
}

/** A hand-built session starting at level 2, with its points worked out below. */
const GOLDEN_TRIALS: Trial[] = [
  trial(2, [47, 8], ['+'], 55, 2_000), // 75 + round(75 × 6000 / 16000 = 28.125) = 103
  trial(2, [60, 7], ['-'], 53, 0), // 75 + round(37.5) = 113 (half up)
  trial(2, [33, 9], ['+'], 42, 4_000), // 75 + round(18.75) = 94; third correct: up to 3
  trial(3, [47, 38], ['+'], 84, 3_000), // wrong: 0; down to 2
  trial(2, [20, 3], ['-'], null, 8_000), // timeout: 0; down to 1
  trial(1, [7, 5], ['+'], 12, 7_999), // 50 + round(0.003) = 50
];

describe('Mental Math v1 scoring (scoringVersion 1)', () => {
  it('uses B(L) = 25 × (L + 1): 50 at level 1, 275 at level 10', () => {
    expect(mm.LEVELS.map(({ level }) => mm.basePoints(level))).toEqual([50, 75, 100, 125, 150, 175, 200, 225, 250, 275]);
    expect(() => mm.basePoints(11)).toThrow(RangeError);
  });

  it('scores the golden session exactly, the same on every run (golden test)', () => {
    const expected = {
      score: 360,
      accuracy: 4 / 6,
      responseTime: { medianMs: 3_500, meanMs: 24_999 / 6, p90Ms: 8_000 },
      peakLevel: 3,
      metrics: {
        correct: 4,
        attempted: 6,
        timedOut: 1,
        longestStreak: 3,
        finalLevel: 1,
        difficultyPoints: 275,
        speedBonusPoints: 85,
      },
    };
    for (let run = 0; run < 3; run += 1) expect(mm.score(GOLDEN_TRIALS, ctx(2))).toEqual(expected);
    expect(mm.definition.score(GOLDEN_TRIALS, ctx(2))).toEqual(expected);
  });

  it('rounds exact halves up, in integer arithmetic', () => {
    expect(mm.speedBonus(2, 0)).toBe(38); // 37.5
    expect(mm.speedBonus(2, 7_680)).toBe(2); // 1.5
    expect(mm.speedBonus(2, 7_040)).toBe(5); // 4.5
    expect(mm.speedBonus(4, 0)).toBe(63); // 62.5
    expect(mm.speedBonus(4, 9_920)).toBe(1); // 0.5
    expect(mm.speedBonus(4, 4_960)).toBe(32); // 31.5
    expect(mm.speedBonus(10, 0)).toBe(138); // 137.5
    expect(mm.speedBonus(1, 0)).toBe(25);
    expect(mm.pointsFor(10, 0)).toBe(413);
  });

  it('matches round(0.5 × B × max(0, 1 − rt / T)) at every level and response time', () => {
    for (const { level, timeLimitMs: limit } of mm.LEVELS) {
      const base = mm.basePoints(level);
      for (let rt = 0; rt <= limit + 1_000; rt += 13) {
        // An exact half: B × (T − rt) leaves remainder T modulo 2T.
        const isExactHalf = rt < limit && (base * (limit - rt)) % (2 * limit) === limit;
        const float = 0.5 * base * Math.max(0, 1 - rt / limit);
        const reference = isExactHalf ? Math.ceil(float) : Math.round(float);
        expect(mm.speedBonus(level, rt)).toBe(reference);
      }
      expect(mm.speedBonus(level, limit)).toBe(0);
      expect(mm.speedBonus(level, limit - 1)).toBeLessThanOrEqual(1);
    }
  });

  it('scores wrong answers and timeouts 0, with no streak multiplier', () => {
    const correctOnly = [trial(1, [7, 5], ['+'], 12, 4_000), trial(1, [7, 5], ['+'], 12, 4_000), trial(1, [7, 5], ['+'], 12, 4_000)];
    const perAnswer = mm.pointsFor(1, 4_000);

    expect(mm.score(correctOnly, ctx(1)).score).toBe(3 * perAnswer);
    expect(mm.score([trial(1, [7, 5], ['+'], 11, 1_000)], ctx(1)).score).toBe(0);
    expect(mm.score([trial(1, [7, 5], ['+'], null, 0)], ctx(1)).score).toBe(0);
  });

  it('keeps difficultyPoints + speedBonusPoints == score, and a valid metrics shape, over simulated runs', () => {
    const behaviour = createRng(5);
    for (const profile of PLAYER_PROFILES) {
      for (const startLevel of [1, 5, 10]) {
        const { run } = simulateRun(profile, startLevel, behaviour.nextUint32(), behaviour);
        const scored = mm.score(run.trials, ctx(startLevel));
        expect(scored.metrics.difficultyPoints + scored.metrics.speedBonusPoints).toBe(scored.score);
        expect(mm.metricsSchema.parse(scored.metrics)).toEqual(scored.metrics);
        expect(scored.peakLevel).toBe(Math.max(...run.trials.map((t) => t.level)));
      }
    }
  });

  it('never trusts the client\'s correct, expected or timeLimitMs flags', () => {
    const honest = trial(3, [47, 38], ['+'], 85, 2_000);
    const points = mm.pointsFor(3, 2_000);

    expect(mm.score([honest], ctx(3)).score).toBe(points);
    // A wrong response claimed correct, with a forged expected value, scores 0.
    expect(mm.score([{ ...honest, response: 90, expected: 90, correct: true }], ctx(3)).score).toBe(0);
    // A forged, longer time limit does not inflate the speed bonus.
    expect(mm.score([{ ...honest, timeLimitMs: 60_000 }], ctx(3)).score).toBe(points);
    // An answer at or after the level's deadline counts as a timeout.
    const late = { ...honest, rtMs: 10_000 };
    expect(mm.score([late], ctx(3))).toMatchObject({ score: 0, metrics: { correct: 0, timedOut: 1 } });
  });

  it('counts the longest streak of consecutive correct trials across level changes', () => {
    const levels = [1, 1, 1, 2, 2, 2, 3, 2];
    const trials = levels.map((level, index) => trial(level, [7, 5], ['+'], index === 7 ? 1 : 12, 1_000));
    // Seven correct in a row span levels 1, 2 and 3; the in-level streak restarted twice.
    expect(mm.score(trials, ctx(1)).metrics.longestStreak).toBe(7);
    const broken = [...trials.slice(0, 2), trial(1, [7, 5], ['+'], null, 0), ...trials.slice(0, 4)];
    expect(mm.score(broken, ctx(1)).metrics.longestStreak).toBe(4);
  });

  it('defines an empty session: no score, null accuracy and response times, peak and final level at the start', () => {
    expect(mm.score([], ctx(6))).toEqual({
      score: 0,
      accuracy: null,
      responseTime: null,
      peakLevel: 6,
      metrics: { correct: 0, attempted: 0, timedOut: 0, longestStreak: 0, finalLevel: 6, difficultyPoints: 0, speedBonusPoints: 0 },
    });
  });

  it('summarises response times: median, mean and nearest-rank p90 over every trial, timeouts included', () => {
    const at = (rts: number[]) => mm.responseTimeSummary(rts.map((rt) => ({ ...trial(1, [7, 5], ['+'], 12, 0), rtMs: rt })));

    expect(at([3_000])).toEqual({ medianMs: 3_000, meanMs: 3_000, p90Ms: 3_000 });
    expect(at([4_000, 1_000, 3_000])).toEqual({ medianMs: 3_000, meanMs: 8_000 / 3, p90Ms: 4_000 });
    expect(at([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ medianMs: 5.5, meanMs: 5.5, p90Ms: 9 });
    expect(at([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual({ medianMs: 6, meanMs: 6, p90Ms: 10 });
    expect(at([])).toBeNull();
  });

  it('refuses a mode or start level the definition does not have', () => {
    expect(() => mm.score([], { modeId: 'endless', startLevel: 1 })).toThrow(/mode/);
    expect(() => mm.score([], ctx(0))).toThrow(RangeError);
  });
});
