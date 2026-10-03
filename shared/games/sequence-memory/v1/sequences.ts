import { createRng, questionSeed, randomInt, type Rng } from '../../mental-math/v1/rng';
import { levelParams } from './params';

// Sequence Memory gameVersion 1: each trial's sequence, derived from the
// session seed. FROZEN. It reuses Mental Math v1's frozen PRNG and seed
// derivation (imported, never copied or edited), so it is exact on every
// runtime; how a sequence is drawn from that stream is defined here.

/**
 * How many variants each position has. A discarded trial (pause,
 * backgrounding, quitting) takes the next variant at the same position, so a
 * resumed run never replays the sequence the player already saw.
 */
export const SEQUENCE_VARIANTS = 16;

/** Tiles on a gridSize × gridSize board, numbered 0 to gridSize² - 1 row by row. */
export function tileCount(gridSize: number): number {
  return gridSize * gridSize;
}

/**
 * A sequence for `level`, consuming exactly `span` steps of `rng`: the first
 * tile is randomInt(0, n - 1); each later tile is r = randomInt(0, n - 2),
 * plus one when r >= the previous tile, so a tile never follows itself. A tile
 * may come back later in the sequence.
 */
export function generateSequence(level: number, rng: Rng): number[] {
  const { span, gridSize } = levelParams(level);
  const tiles = tileCount(gridSize);
  const sequence: number[] = [];
  for (let index = 0; index < span; index += 1) {
    const previous = sequence[index - 1];
    if (previous === undefined) {
      sequence.push(randomInt(rng, 0, tiles - 1));
    } else {
      const draw = randomInt(rng, 0, tiles - 2);
      sequence.push(draw >= previous ? draw + 1 : draw);
    }
  }
  return sequence;
}

/**
 * The sequence of the trial at `position` (the number of trials recorded
 * before it), `variant` (0 to SEQUENCE_VARIANTS - 1) of a session, shown at
 * `level`: generateSequence(level, createRng(questionSeed(seed, position, variant))).
 */
export function sequenceAt(seed: number, position: number, variant: number, level: number): number[] {
  if (!Number.isInteger(variant) || variant < 0 || variant >= SEQUENCE_VARIANTS) {
    throw new RangeError(`variant must be 0-${SEQUENCE_VARIANTS - 1}, got ${variant}`);
  }
  return generateSequence(level, createRng(questionSeed(seed, position, variant)));
}

/** Whether `sequence` could be one of `level`'s: its span, tiles of its grid, and no tile right after itself. */
export function isLegalSequence(level: number, sequence: readonly number[]): boolean {
  const { span, gridSize } = levelParams(level);
  const tiles = tileCount(gridSize);
  return sequence.length === span
    && sequence.every((tile, index) => Number.isInteger(tile) && tile >= 0 && tile < tiles && tile !== sequence[index - 1]);
}

export function sameSequence(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((tile, index) => tile === b[index]);
}
