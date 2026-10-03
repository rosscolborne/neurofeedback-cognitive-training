// Sequence Memory, gameVersion 1 (scoringVersion 1): the frozen v1 module
// (NFCT-93), on Mental Math v1's model.
//
// Versioning (ADR-001 decision 8):
// - gameVersion 1 gameplay is everything a stored v1 session depends on: the
//   run and levels (params.ts), the sequence derivation (sequences.ts, over
//   Mental Math v1's frozen PRNG), the staircase (staircase.ts), the response
//   rules (limits.ts), the trial and metrics semantics (schemas.ts), the run
//   rules (run.ts) and the plausibility checks with their outcomes
//   (plausibility.ts).
// - After launch this module is never edited. Changing level parameters, the
//   generator, the staircase or the trial shape or meaning makes scores
//   incomparable: add a new `v2/` module with gameVersion 2 beside this one.
// - Changing a scoring constant or rule bumps scoringVersion (scoring.ts).
// - Before the first external beta, parameters and constants may still be
//   tuned at version 1 from the simulation. The golden tests pin today's
//   behaviour, so any such change must update them deliberately.
//
// Nothing here reads a clock or Math.random, holds module state, or takes EEG
// input.

export * from './params';
export * from './sequences';
export * from './staircase';
export * from './limits';
export * from './schemas';
export * from './scoring';
export * from './plausibility';
export * from './run';
export * from './definition';
export { createRng, randomInt, type Rng } from '../../mental-math/v1/rng';
