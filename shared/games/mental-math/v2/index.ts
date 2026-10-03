// Mental Math, gameVersion 2 (scoringVersion 1): the time-bank run (NFCT-60).
//
// gameVersion 1 (../v1) is the fixed 90 s run and stays frozen, so sessions
// saved under it are still judged by its own rules. gameVersion 2 reuses
// every v1 building block (levels, PRNG, questions, staircase, trial and
// metrics schemas, scoring) and owns only what the time bank changes: the
// bank itself (timeBank.ts), the run reducer (run.ts), the timing checks
// (plausibility.ts) and the catalogue entry (definition.ts).
//
// FROZEN after launch like v1. Nothing here reads a clock or Math.random,
// holds module state, or takes EEG input.

export * from '../v1/params';
export * from '../v1/limits';
export * from '../v1/rng';
export * from '../v1/questions';
export * from '../v1/staircase';
export * from '../v1/schemas';
export * from '../v1/scoring';
export * from './timeBank';
export * from './plausibility';
export * from './run';
export * from './definition';
