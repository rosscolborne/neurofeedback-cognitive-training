import { sequenceMemory as sm } from '@nfct/shared';
import type { RunOutcome } from '../runController';

/** A whole Sequence Memory run played through the shared reducer: every sequence tapped back, 400 ms a tap. */
export function playRun({ seed, startLevel = 1, wallStartMs = 1_790_000_000_000 }: { seed: number; startLevel?: number; wallStartMs?: number }): RunOutcome {
  let run = sm.startRun({ seed, startLevel });
  while (!sm.isRunComplete(run)) {
    run = sm.presentTrial(run, sm.recordedActiveMs(run));
    const current = run.current!;
    current.sequence.forEach((tile, index) => {
      run = sm.tapTile(run, { trialId: current.id, tile, atMs: 400 * (index + 1) }).run;
    });
  }
  const activeDurationMs = sm.recordedActiveMs(run);
  // Feedback between trials takes wall-clock time beyond the active time.
  return { status: 'completed', run, activeDurationMs, startedAtMs: wallStartMs, endedAtMs: wallStartMs + activeDurationMs + 20_000 };
}
