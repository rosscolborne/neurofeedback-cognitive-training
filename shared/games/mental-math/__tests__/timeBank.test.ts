import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { correct, play, sessionOf, timeout, wrong, type Step } from './helpers';

const SEED = 0x00c0_ffee;

/** Plays `step` (as a function of the question's level) until the bank runs out or the trial cap is reached. */
function playOut(startLevel: number, stepFor: (level: number) => Step): { run: mm.MentalMathRun; clock: number } {
  let run = mm.startRun({ seed: SEED, startLevel });
  let clock = 0;
  while (clock < run.endsAtMs && !mm.isTrialCapReached(run)) {
    const shown = mm.presentQuestion(run, clock);
    const current = shown.current!;
    const step = stepFor(current.level);
    const result = step.kind === 'timeout'
      ? mm.timeOutQuestion(shown, { questionId: current.id })
      : mm.answerQuestion(shown, {
        questionId: current.id,
        response: step.kind === 'correct' ? current.expected : current.expected + 1,
        rtMs: step.kind === 'pause' ? 0 : step.rtMs,
      });
    if (!result.accepted) {
      run = mm.discardQuestion(shown); // expiry wins
      break;
    }
    run = result.run;
    clock = result.trial.shownAtMs + result.trial.rtMs;
  }
  return { run, clock };
}

describe('Mental Math v1 time bank: gains and losses', () => {
  it('pays for speed relative to the level\'s limit: +3 s under a third, +2 s under two thirds, nothing slower', () => {
    // Level 1: an 8 s limit.
    expect(mm.timeBankChange(1, 'correct', 0)).toBe(3_000);
    expect(mm.timeBankChange(1, 'correct', 2_666)).toBe(3_000);
    expect(mm.timeBankChange(1, 'correct', 2_667)).toBe(2_000);
    expect(mm.timeBankChange(1, 'correct', 5_333)).toBe(2_000);
    expect(mm.timeBankChange(1, 'correct', 5_334)).toBe(0);
    // Level 10: an 18 s limit, so the same tier takes longer.
    expect(mm.timeBankChange(10, 'correct', 5_999)).toBe(3_000);
    expect(mm.timeBankChange(10, 'correct', 6_000)).toBe(2_000);
    expect(mm.timeBankChange(10, 'correct', 12_000)).toBe(0);
  });

  it('costs 5 s for a wrong answer, however fast, and nothing extra for a timeout', () => {
    expect(mm.timeBankChange(1, 'wrong', 500)).toBe(-5_000);
    expect(mm.timeBankChange(7, 'wrong', 13_000)).toBe(-5_000);
    expect(mm.timeBankChange(4, 'timeout', 10_000)).toBe(0);
  });

  it('moves the bank as each trial ends, through the reducer, and reports the applied change', () => {
    const start = mm.startRun({ seed: SEED, startLevel: 1 });
    expect(start.endsAtMs).toBe(mm.START_BANK_MS);

    const { run } = play(SEED, 1, [correct(1_000)]);
    expect(run.endsAtMs).toBe(mm.START_BANK_MS + 3_000);
    const shown = mm.presentQuestion(run, 1_000);
    const missed = mm.answerQuestion(shown, { questionId: shown.current!.id, response: shown.current!.expected + 1, rtMs: 2_000 });
    expect(missed).toMatchObject({ accepted: true, bankChangeMs: -5_000, run: { endsAtMs: mm.START_BANK_MS - 2_000 } });

    const timedOut = play(SEED, 1, [timeout()]).run;
    expect(timedOut.endsAtMs).toBe(mm.START_BANK_MS); // the 8 s already drained from the bank
  });

  it('ends the run when a wrong answer empties the bank, as that trial ends', () => {
    // 4 s in the bank before the answer: the penalty takes it to 0.
    const shown = mm.presentQuestion(mm.startRun({ seed: SEED, startLevel: 2 }), mm.START_BANK_MS - 6_000);
    const result = mm.answerQuestion(shown, { questionId: shown.current!.id, response: shown.current!.expected + 1, rtMs: 2_000 });
    if (!result.accepted) throw new Error('refused');
    const trialEnd = mm.START_BANK_MS - 4_000;
    expect(result.run.endsAtMs).toBe(trialEnd);
    expect(result.bankChangeMs).toBe(-4_000); // only what was left
    expect(() => mm.presentQuestion(result.run, trialEnd)).toThrow(/run ends/);
  });
});

describe('Mental Math v1 time bank: cap and run limit', () => {
  it('never holds more than 60 s, and never runs past 180 s of active time', () => {
    expect(mm.nextBankEnd(50_000, 1_000, 3_000)).toBe(53_000); // 49 s left + 3 s
    expect(mm.nextBankEnd(60_000, 1_000, 3_000)).toBe(61_000); // 59 s + 3 s, held at 60 s
    expect(mm.nextBankEnd(10_000, 8_000, -5_000)).toBe(8_000); // 2 s - 5 s, held at 0
    expect(mm.nextBankEnd(175_000, 170_000, 3_000)).toBe(178_000);
    expect(mm.nextBankEnd(179_000, 170_000, 3_000)).toBe(mm.MAX_RUN_MS);
    expect(mm.nextBankEnd(mm.MAX_RUN_MS, 179_000, 3_000)).toBe(mm.MAX_RUN_MS);
  });

  it('reports a gain the cap clipped as what was actually added', () => {
    // Nine fast answers from 45 s at 500 ms each: the bank fills to 60 s, then gains are clipped.
    const { run } = play(SEED, 1, Array.from({ length: 9 }, () => correct(500)));
    expect(run.endsAtMs - 4_500).toBe(mm.BANK_CAP_MS);
    const shown = mm.presentQuestion(run, 4_500);
    const result = mm.answerQuestion(shown, { questionId: shown.current!.id, response: shown.current!.expected, rtMs: 500 });
    expect(result).toMatchObject({ accepted: true, bankChangeMs: 500 }); // only the 0.5 s just spent comes back
  });

  it('terminates even for a flawless, fast player: the run ends at exactly 180 s', () => {
    const { run, clock } = playOut(1, () => correct(500));
    expect(run.endsAtMs).toBe(mm.MAX_RUN_MS);
    expect(clock).toBe(mm.MAX_RUN_MS);
    expect(run.trials.length).toBeLessThan(mm.MAX_TRIALS);
    expect(Math.max(...run.trials.map((trial) => trial.level))).toBe(10);
    expect(mm.checkSession(sessionOf(SEED, run))).toEqual({ outcome: 'valid', reasons: [], issues: [] });
  });

  it('terminates for a player who keeps missing: the bank drains', () => {
    const { run, clock } = playOut(5, () => wrong(1_000));
    expect(run.endsAtMs).toBe(clock);
    expect(run.endsAtMs).toBeLessThan(mm.START_BANK_MS);
  });
});

describe('Mental Math v1 time bank: starting-level fairness', () => {
  it('starts every run with the same bank, whatever the start level', () => {
    for (let level = mm.MIN_LEVEL; level <= mm.MAX_LEVEL; level += 1) {
      expect(mm.startRun({ seed: SEED, startLevel: level }).endsAtMs).toBe(mm.START_BANK_MS);
    }
  });

  it('gives a higher start no more time, even for a player equally quick at every level', () => {
    // Answers everything correctly in 30% of the level's limit plus 0.6 s: the same tier everywhere.
    const player = (level: number) => correct(Math.round(mm.timeLimitFor(level) * 0.3) + 600);
    const fromOne = playOut(1, player).run;
    for (const startLevel of [2, 4, 6, 8, 10]) {
      const higher = playOut(startLevel, player).run;
      expect({ startLevel, longer: higher.endsAtMs > fromOne.endsAtMs }).toEqual({ startLevel, longer: false });
    }
  });

  it('gives a higher start no score advantage for players who find the early levels quick', () => {
    const scoreOf = (run: mm.MentalMathRun) => mm.score(run.trials, { modeId: mm.MODE_ID, startLevel: run.startLevel }).score;
    const players: Record<string, (level: number) => Step> = {
      // Always right, one more second per level (an unlocked high start is earned like this).
      'steady climber': (level) => correct(1_000 * level),
      // Quick and right below level 6, always wrong from level 6 up.
      'skill ceiling at 6': (level) => (level < 6 ? correct(1_200 * level) : wrong(1_200 * level)),
    };
    for (const [name, player] of Object.entries(players)) {
      const fromOne = playOut(1, player).run;
      for (const startLevel of [2, 3, 4, 6, 8, 10]) {
        const higher = playOut(startLevel, player).run;
        expect({ name, startLevel, longer: higher.endsAtMs > fromOne.endsAtMs, higherScore: scoreOf(higher) > scoreOf(fromOne) })
          .toEqual({ name, startLevel, longer: false, higherScore: false });
      }
    }
  });

  it('is replayed from the trials alone, so trusted scoring checks the run length exactly', () => {
    const { run } = playOut(3, (level) => (level >= 6 ? wrong(4_000) : correct(1_500)));
    const replayed = mm.bankEnds(run.trials);
    expect(replayed.final).toBe(run.endsAtMs);
    expect(replayed.before[0]).toBe(mm.START_BANK_MS);
    expect(mm.checkSession(sessionOf(SEED, run))).toEqual({ outcome: 'valid', reasons: [], issues: [] });
    // A completed session that claims the old fixed 90 s is flagged.
    expect(mm.checkSession(sessionOf(SEED, run, { activeDurationMs: 90_000 })).reasons).toEqual(['active-duration-mismatch']);
  });
});
