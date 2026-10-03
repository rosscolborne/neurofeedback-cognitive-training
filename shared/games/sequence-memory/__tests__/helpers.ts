import { sequenceMemoryV1 as sm } from '@nfct/shared';

/** One scripted player action on the trial on screen. */
export type Step =
  /** Taps the whole sequence back, `tapMs` apart (the first `tapMs` after the response phase starts). */
  | { readonly kind: 'correct'; readonly tapMs: number }
  /** Taps correctly up to `at`, then a wrong tile there. */
  | { readonly kind: 'wrong'; readonly at: number; readonly tapMs: number }
  /** Taps `taps` correct tiles, then lets the response limit pass. */
  | { readonly kind: 'timeout'; readonly taps: number }
  /** Pause (or background) after `afterMs` of the trial: it is discarded. */
  | { readonly kind: 'pause'; readonly afterMs: number };

export const correct = (tapMs = 400): Step => ({ kind: 'correct', tapMs });
export const wrong = (at = 0, tapMs = 400): Step => ({ kind: 'wrong', at, tapMs });
export const timeout = (taps = 0): Step => ({ kind: 'timeout', taps });
export const pause = (afterMs = 500): Step => ({ kind: 'pause', afterMs });

function accepted(result: sm.TapResult): sm.SequenceMemoryRun {
  if (!result.accepted) throw new Error(`tap refused: ${result.reason}`);
  return result.run;
}

/** A tile of the trial's grid that is not `tile`. */
export function otherTile(current: sm.PresentedTrial, tile: number): number {
  return (tile + 1) % sm.tileCount(current.gridSize);
}

/**
 * Plays steps through the pure run reducer, as the run controller does: each
 * trial is presented at the end of the recorded trials (feedback does not run
 * the clock, and a discarded trial's time is not active time). Steps after
 * the run is complete are ignored.
 */
export function play(seed: number, startLevel: number, steps: readonly Step[]): sm.SequenceMemoryRun {
  let run = sm.startRun({ seed, startLevel });
  for (const step of steps) {
    if (sm.isRunComplete(run)) break;
    run = sm.presentTrial(run, sm.recordedActiveMs(run));
    const current = run.current!;
    switch (step.kind) {
      case 'pause':
        run = sm.discardTrial(run);
        break;
      case 'timeout': {
        for (let index = 0; index < step.taps; index += 1) {
          run = accepted(sm.tapTile(run, { trialId: current.id, tile: current.sequence[index]!, atMs: 300 * (index + 1) }));
        }
        run = accepted(sm.timeOutTrial(run, { trialId: current.id }));
        break;
      }
      case 'correct':
      case 'wrong': {
        const stopAt = step.kind === 'wrong' ? step.at : current.sequence.length;
        for (let index = 0; index <= Math.min(stopAt, current.sequence.length - 1); index += 1) {
          const tile = index === stopAt ? otherTile(current, current.sequence[index]!) : current.sequence[index]!;
          run = accepted(sm.tapTile(run, { trialId: current.id, tile, atMs: step.tapMs * (index + 1) }));
        }
        break;
      }
    }
  }
  return run;
}

/** `count` correct trials. */
export function corrects(count: number, tapMs = 400): Step[] {
  return Array.from({ length: count }, () => correct(tapMs));
}

/** A checkable session for a played run, as the client would write it. */
export function sessionOf(
  seed: number,
  run: sm.SequenceMemoryRun,
  overrides: Partial<sm.CheckableSession> = {},
): sm.CheckableSession {
  const scored = sm.score(run.trials, { modeId: sm.MODE_ID, startLevel: run.startLevel });
  return {
    modeId: sm.MODE_ID,
    startLevel: run.startLevel,
    peakLevel: sm.runPeakLevel(run),
    status: sm.isRunComplete(run) ? 'completed' : 'abandoned',
    activeDurationMs: sm.recordedActiveMs(run),
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

/** The reasons checkSession reports. */
export function reasonsOf(session: sm.CheckableSession): string[] {
  return sm.checkSession(session).reasons;
}

/** A full honest run: correct, wrong and timed-out trials and pauses, `TRIALS_PER_RUN` trials. */
export function fullRun(seed = 1234, startLevel = 1): sm.SequenceMemoryRun {
  const steps: Step[] = [];
  for (let index = 0; steps.filter((step) => step.kind !== 'pause').length < sm.TRIALS_PER_RUN; index += 1) {
    if (index % 7 === 3) steps.push(pause(300));
    else if (index % 5 === 4) steps.push(wrong(1));
    else if (index % 11 === 10) steps.push(timeout(1));
    else steps.push(correct(350));
  }
  return play(seed, startLevel, steps);
}
