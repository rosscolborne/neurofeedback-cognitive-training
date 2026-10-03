// Mental Math, gameVersion 1 (scoringVersion 1): the frozen v1 module.
//
// Versioning (ADR-001 decision 8, card NFCT-17):
// - gameVersion 1 gameplay is everything a stored v1 session depends on: the
//   run and levels (params.ts), the PRNG and seed derivation (rng.ts), question
//   generation and legality (questions.ts), the staircase (staircase.ts), the
//   trial and metrics semantics (schemas.ts), the time bank (timeBank.ts), the run rules (run.ts) and the
//   plausibility checks with their outcomes (plausibility.ts).
// - After launch this module is never edited. Changing level parameters, the
//   generator, the staircase or the trial shape or meaning makes scores
//   incomparable: add a new `v2/` module with gameVersion 2 beside this one.
//   Trusted scoring keeps a module per supported version, so v1 sessions are
//   always checked and scored by v1 code.
// - Changing a scoring constant or rule bumps scoringVersion (scoring.ts): add
//   the new scoring function beside the old one and point the definition at it;
//   stored results keep the scoringVersion they were written with.
// - Before the first external beta, parameters and constants may still be
//   tuned at version 1. The golden tests pin today's behaviour, so any such
//   change must update them deliberately.
//
// Nothing here reads a clock or Math.random, holds module state, or takes EEG
// input.

export * from './params';
export * from './limits';
export * from './rng';
export * from './questions';
export * from './staircase';
export * from './schemas';
export * from './scoring';
export * from './timeBank';
export * from './plausibility';
export * from './run';
export * from './definition';
