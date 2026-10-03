// Sequence Memory gameVersion 1: the run, the ten levels and the plausibility
// constants, as versioned data. Every value is provisional, set by the
// simulation tests (simulation.ts), not by real play: before the first
// external beta they may be tuned at gameVersion 1, deliberately updating the
// golden tests. After launch any change is gameplay and needs a new
// gameVersion module (NFCT-93).
//
// A trial: the grid appears, then after LEAD_IN_MS the sequence's tiles light
// one at a time (each for litMs, then gapMs dark). The response phase starts
// when the last tile's gap ends, and the player taps the tiles back in order
// within responseLimitMs.

/** The one v1 mode: forward recall over levels 1-10 with a 2-up/1-down staircase. */
export const MODE_ID = 'standard';
/** The lowest and highest levels. */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
/** k in the k-up/1-down staircase: this many correct trials in a row at a level move up one level. */
export const LEVEL_UP_STREAK = 2;
/** A run is this many recorded trials; it then ends as completed. */
export const TRIALS_PER_RUN = 20;
/** The board is shown this long before the first tile lights. */
export const LEAD_IN_MS = 600;
/** The response limit is RESPONSE_BASE_MS plus RESPONSE_PER_TILE_MS for each tile in the sequence. */
export const RESPONSE_BASE_MS = 2_000;
export const RESPONSE_PER_TILE_MS = 1_000;
/** A tap sooner than this after the previous one (or after the response phase starts) is implausibly fast. */
export const MIN_PLAUSIBLE_TAP_MS = 100;
/** A session is flagged when more than this share of its taps are faster than MIN_PLAUSIBLE_TAP_MS. */
export const MAX_FAST_TAP_PERCENT = 20;
/**
 * Slack for rounding in the client's active clock. A conforming client records
 * integer clock readings, so its trials meet exactly and the session's active
 * time is exactly the end of its last trial.
 */
export const TIMING_TOLERANCE_MS = 50;

export type LevelParams = {
  readonly level: number;
  /** How many tiles light up: the sequence length. */
  readonly span: number;
  /** The grid is gridSize x gridSize tiles, numbered 0 to gridSize² - 1 row by row. */
  readonly gridSize: number;
  /** How long each tile stays lit. */
  readonly litMs: number;
  /** The dark gap after each lit tile, including the last. */
  readonly gapMs: number;
  /** LEAD_IN_MS + span × (litMs + gapMs): from the board appearing to the response phase. */
  readonly presentationMs: number;
  /** RESPONSE_BASE_MS + span × RESPONSE_PER_TILE_MS: the whole response must end strictly before it. */
  readonly responseLimitMs: number;
};

function level(levelNumber: number, span: number, gridSize: number, litMs: number, gapMs: number): LevelParams {
  return {
    level: levelNumber,
    span,
    gridSize,
    litMs,
    gapMs,
    presentationMs: LEAD_IN_MS + span * (litMs + gapMs),
    responseLimitMs: RESPONSE_BASE_MS + span * RESPONSE_PER_TILE_MS,
  };
}

/**
 * Span grows with the level, from 2 to 9 tiles. The grid grows from 3×3 to
 * 4×4 at level 4 and 5×5 at level 7, and the pacing quickens at the same steps.
 */
export const LEVELS: readonly LevelParams[] = Object.freeze([
  level(1, 2, 3, 700, 300),
  level(2, 3, 3, 700, 300),
  level(3, 4, 3, 700, 300),
  level(4, 4, 4, 600, 250),
  level(5, 5, 4, 600, 250),
  level(6, 6, 4, 600, 250),
  level(7, 6, 5, 500, 200),
  level(8, 7, 5, 500, 200),
  level(9, 8, 5, 500, 200),
  level(10, 9, 5, 500, 200),
].map((params) => Object.freeze(params)));

export function levelParams(levelNumber: number): LevelParams {
  const params = Number.isInteger(levelNumber) ? LEVELS[levelNumber - 1] : undefined;
  if (!params) throw new RangeError(`Sequence Memory v1 has levels ${MIN_LEVEL}-${MAX_LEVEL}, got ${levelNumber}`);
  return params;
}

/** The longest one trial can take: the slowest presentation plus the longest response limit. */
export const MAX_TRIAL_MS = Math.max(...LEVELS.map((params) => params.presentationMs + params.responseLimitMs));

/** The longest a run can last in active time: every trial at its longest. */
export const MAX_RUN_MS = TRIALS_PER_RUN * MAX_TRIAL_MS;
