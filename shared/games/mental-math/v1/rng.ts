// Mental Math gameVersion 1: the pseudo-random number generator and the
// derivation of each question's seed from the session seed. FROZEN: trusted
// scoring must reproduce these values bit for bit, possibly on another
// runtime, so every step below is exact.
//
// - 32-bit steps use only Math.imul, ^, | and >>>, which are defined on
//   32-bit integers (ToInt32 / ToUint32), never on floating-point values.
// - The only floating-point operations act on integers below 2^53 and divide
//   by a power of two, so they are exact in IEEE 754 doubles.
//
// Changing anything here changes which questions a seed produces: that is a
// new gameVersion (a new module), never an edit to this one.

/** An injected source of randomness. Question generation never uses Math.random. */
export interface Rng {
  /** The next unsigned 32-bit output; each call consumes exactly one step. */
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;
/** The widest range randomInt draws from, so `u32 * span` stays below 2^53. */
export const MAX_RANDOM_SPAN = 0x20_0000;

function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer, got ${value}`);
  }
}

/**
 * mulberry32 (Tommy Ettinger), with its state kept as an unsigned 32-bit
 * integer. Each step is:
 *
 *   state = (state + 0x6D2B79F5) mod 2^32
 *   t = imul(state ^ (state >>> 15), state | 1)
 *   t = t ^ (t + imul(t ^ (t >>> 7), t | 61))
 *   output = (t ^ (t >>> 14)) >>> 0
 *
 * This is the widely published mulberry32, returning the 32-bit integer
 * instead of dividing it by 2^32. The state lives in this closure; there is
 * no module state.
 */
export function createRng(seed: number): Rng {
  assertUint32(seed, 'seed');
  let state = seed;
  return {
    nextUint32(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}

/**
 * A uniform integer in [min, max], consuming exactly one step:
 * `min + floor(u32 * (max - min + 1) / 2^32)`. The product is below 2^53 and
 * the divisor is a power of two, so the result is exact on every runtime.
 */
export function randomInt(rng: Rng, min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new RangeError(`randomInt needs integers min <= max, got ${min}..${max}`);
  }
  const span = max - min + 1;
  if (span > MAX_RANDOM_SPAN) throw new RangeError(`randomInt span ${span} exceeds ${MAX_RANDOM_SPAN}`);
  return min + Math.floor((rng.nextUint32() * span) / UINT32_RANGE);
}

/**
 * Picks one item by integer weight, consuming exactly one step: draws
 * r = randomInt(0, total - 1) and returns the first item whose cumulative
 * weight exceeds r, in array order.
 */
export function pickWeighted<T extends { readonly weight: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (items.length === 0 || !items.every((item) => Number.isInteger(item.weight) && item.weight > 0)) {
    throw new RangeError('pickWeighted needs items with positive integer weights');
  }
  let remaining = randomInt(rng, 0, total - 1);
  for (const item of items) {
    if (remaining < item.weight) return item;
    remaining -= item.weight;
  }
  throw new Error('pickWeighted: unreachable');
}

/** murmur3's 32-bit finaliser (fmix32). */
function fmix32(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Recorded trials are numbered from 0; this bounds positions well above any real run. */
const MAX_POSITION = 0x7fff_ffff;

/**
 * The seed of one question, derived from the session seed, the question's
 * position (how many trials were recorded before it) and its variant (see
 * QUESTION_VARIANTS). Three fmix32 rounds:
 *
 *   h = fmix32((seed ^ 0x9E3779B9) >>> 0)
 *   h = fmix32((h + imul(position, 0x85EBCA77) + 0x27D4EB2F) >>> 0)
 *   h = fmix32((h + imul(variant, 0xC2B2AE3D) + 0x165667B1) >>> 0)
 *
 * The sums are exact integers below 2^35 before `>>> 0` reduces them mod 2^32.
 */
export function questionSeed(seed: number, position: number, variant: number): number {
  assertUint32(seed, 'seed');
  if (!Number.isInteger(position) || position < 0 || position > MAX_POSITION) {
    throw new RangeError(`position must be an integer 0-${MAX_POSITION}, got ${position}`);
  }
  if (!Number.isInteger(variant) || variant < 0 || variant > MAX_POSITION) {
    throw new RangeError(`variant must be a non-negative integer, got ${variant}`);
  }
  let h = fmix32((seed ^ 0x9e3779b9) >>> 0);
  h = fmix32((h + Math.imul(position, 0x85ebca77) + 0x27d4eb2f) >>> 0);
  h = fmix32((h + Math.imul(variant, 0xc2b2ae3d) + 0x165667b1) >>> 0);
  return h;
}
