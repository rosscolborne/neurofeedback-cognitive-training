import { mentalMathV1 as mm } from '@nfct/shared';
import { at } from '../../../__tests__/fixtures';

/** One scripted player action on the question on screen. */
export type Step =
  | { readonly kind: 'correct'; readonly rtMs: number }
  | { readonly kind: 'wrong'; readonly rtMs: number }
  | { readonly kind: 'timeout' }
  /** Pause (or background) after `afterMs` of active time: the question is discarded. */
  | { readonly kind: 'pause'; readonly afterMs: number };

export const correct = (rtMs = 2_000): Step => ({ kind: 'correct', rtMs });
export const wrong = (rtMs = 2_000): Step => ({ kind: 'wrong', rtMs });
export const timeout = (): Step => ({ kind: 'timeout' });
export const pause = (afterMs = 500): Step => ({ kind: 'pause', afterMs });

function accepted(result: mm.AnswerResult): mm.MentalMathRun {
  if (!result.accepted) throw new Error(`answer refused: ${result.reason}`);
  return result.run;
}

/**
 * Plays steps through the pure run reducer on an integer active clock, as the
 * game screen does: each question appears when the previous one ended
 * (feedback does not run the clock).
 */
export function play(seed: number, startLevel: number, steps: readonly Step[]): { run: mm.MentalMathRun; clock: number } {
  let run = mm.startRun({ seed, startLevel });
  let clock = 0;
  for (const step of steps) {
    run = mm.presentQuestion(run, clock);
    const current = run.current!;
    switch (step.kind) {
      case 'pause':
        clock += step.afterMs;
        run = mm.discardQuestion(run);
        break;
      case 'timeout':
        run = accepted(mm.timeOutQuestion(run, { questionId: current.id }));
        clock += current.timeLimitMs;
        break;
      case 'correct':
      case 'wrong': {
        const response = step.kind === 'correct' ? current.expected : current.expected + 1;
        run = accepted(mm.answerQuestion(run, { questionId: current.id, response, rtMs: step.rtMs }));
        clock += Math.min(step.rtMs, current.timeLimitMs);
        break;
      }
    }
  }
  return { run, clock };
}

/** A checkable session for a played run, as the client would write it. */
export function sessionOf(
  seed: number,
  run: mm.MentalMathRun,
  overrides: Partial<mm.CheckableSession> = {},
): mm.CheckableSession {
  const scored = mm.score(run.trials, { modeId: mm.MODE_ID, startLevel: run.startLevel });
  return {
    modeId: mm.MODE_ID,
    startLevel: run.startLevel,
    peakLevel: mm.runPeakLevel(run),
    status: 'completed',
    activeDurationMs: mm.RUN_DURATION_MS,
    seed,
    trials: run.trials,
    summary: {
      score: scored.score,
      accuracy: scored.accuracy,
      trialsTotal: run.trials.length,
      trialsCorrect: scored.metrics.correct,
      responseTime: scored.responseTime,
      metrics: scored.metrics,
    },
    ...overrides,
  };
}

/** A full stored game session document for a played run (envelope included). */
export function storedMentalMathSession(seed: number, run: mm.MentalMathRun): Record<string, unknown> {
  const { summary, ...checkable } = sessionOf(seed, run);
  return {
    schemaVersion: 1,
    userId: 'user-1',
    gameId: mm.GAME_ID,
    gameVersion: mm.GAME_VERSION,
    modeId: checkable.modeId,
    startLevel: checkable.startLevel,
    seed,
    peakLevel: checkable.peakLevel,
    status: checkable.status,
    startedAt: at(0),
    endedAt: at(2),
    activeDurationMs: checkable.activeDurationMs,
    localDate: '2026-09-30',
    timezone: 'America/Toronto',
    createdAt: at(2),
    client: { appVersion: '0.1.0', platform: 'web' },
    trials: checkable.trials,
    summary,
  };
}

/** Correct answers until the run clock is nearly spent, for a full, conforming run. */
export function fullRun(seed: number, startLevel: number, pattern: readonly Step[]): { run: mm.MentalMathRun; clock: number } {
  const steps: Step[] = [];
  let spent = 0;
  for (let index = 0; spent < mm.RUN_DURATION_MS - 20_000; index += 1) {
    const step = pattern[index % pattern.length]!;
    steps.push(step);
    spent += step.kind === 'timeout' ? 18_000 : step.kind === 'pause' ? step.afterMs : step.rtMs;
  }
  return play(seed, startLevel, steps);
}
