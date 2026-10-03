import { z } from 'zod';
import { MAX_LEVEL, MIN_LEVEL } from './params';

// Sequence Memory gameVersion 1: the trial and metrics schemas. FROZEN: a
// material change to the trial shape or its meaning is a new gameVersion.
//
// The schemas check shape and generous bounds. Whether a trial is consistent
// (its sequence, its response and flags, its timing, its level) is decided by
// the plausibility checks, which report stable reason codes instead of failing
// the whole document.

/**
 * Sanity bounds, wider than any v1 level; each level's own values are checked
 * by plausibility. Literals, not shared constants, so a shared change cannot
 * alter v1.
 */
const MAX_GRID_SIZE = 8;
const MAX_TILE = MAX_GRID_SIZE * MAX_GRID_SIZE - 1;
const MAX_SEQUENCE = 16;
const MAX_PHASE_MS = 60_000;
/** The longest active run time any trial may start at (the shared session maximum when v1 was frozen). */
const MAX_SHOWN_AT_MS = 3_600_000;
/** The most trials any session may carry (the shared cap when v1 was frozen). */
const MAX_COUNT = 400;

const tileSchema = z.int().min(0).max(MAX_TILE);
const phaseMsSchema = z.int().min(0).max(MAX_PHASE_MS);

/**
 * One presented sequence that the player answered, got wrong or let time
 * out. Trials discarded on pause, backgrounding or quitting are never trials.
 * All times are integer milliseconds of active run time.
 */
export const trialSchema = z.strictObject({
  /** The level the trial was shown at. */
  level: z.int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** The board was gridSize × gridSize tiles, numbered row by row from 0. */
  gridSize: z.int().min(2).max(MAX_GRID_SIZE),
  /** The tiles that lit up, in order; a tile never follows itself. */
  sequence: z.array(tileSchema).min(1).max(MAX_SEQUENCE),
  /** The tiles the player tapped, in order, up to and including the first wrong one. */
  response: z.array(tileSchema).max(MAX_SEQUENCE),
  /** When each tap landed, from the start of the response phase; non-decreasing, one per response tile. */
  tapAtMs: z.array(phaseMsSchema).max(MAX_SEQUENCE),
  /** The whole sequence was tapped back in order before the limit. */
  correct: z.boolean(),
  /** The limit came before the player finished or erred. */
  timedOut: z.boolean(),
  /** Active run time when the board appeared and presentation began (pauses and feedback excluded). */
  shownAtMs: z.int().min(0).max(MAX_SHOWN_AT_MS),
  /** The level's presentation: from the board appearing to the response phase. */
  presentationMs: z.int().min(1).max(MAX_PHASE_MS),
  /** The level's limit for the whole response. */
  responseLimitMs: z.int().min(1).max(MAX_PHASE_MS),
  /** From the start of the response phase to the last tap (correct or wrong), or responseLimitMs on a timeout. */
  rtMs: phaseMsSchema,
});
export type SequenceMemoryTrial = z.infer<typeof trialSchema>;

const countSchema = z.int().min(0).max(MAX_COUNT);

/**
 * What trusted scoring derives from the trials, stored in result.metrics. The
 * client's summary.metrics is a display copy validated by the same schema, so
 * it checks types and bounds only: cross-field consistency is a plausibility
 * matter (summary-mismatch) and never makes the raw trials unwritable.
 */
export const metricsSchema = z.strictObject({
  /** Trials recalled correctly. */
  correct: countSchema,
  /** Trials recorded (correct, wrong or timed out); discarded trials are not trials. */
  attempted: countSchema,
  /** Trials that timed out. */
  timedOut: countSchema,
  /** The level of the last trial; the start level when there are no trials. */
  finalLevel: z.int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** The longest sequence recalled correctly (its level's span); 0 when none was. */
  longestSpan: z.int().min(0).max(MAX_SEQUENCE),
});
export type SequenceMemoryMetrics = z.infer<typeof metricsSchema>;
