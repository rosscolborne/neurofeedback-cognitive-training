import { z } from 'zod';

// The session seed: the one random input a game session's content is derived
// from. Every game session stores it (`seed` on the envelope), so trusted
// scoring can reproduce what the player was shown. Each game version defines,
// and freezes, how its content is derived from the seed.
//
// The client chooses the seed when the game starts, like the session ID, and
// never changes it. It is forgeable like everything else the client writes
// (ADR-001 decision 4): it makes sessions reproducible and checkable, it does
// not stop cheating. Leaderboards would need server-issued seeds.

/** The largest seed: seeds are unsigned 32-bit integers. */
export const SESSION_SEED_MAX = 0xffff_ffff;

/** An unsigned 32-bit integer, 0 to 4294967295. Mirrored by the rules' session key check. */
export const sessionSeedSchema = z.int().min(0).max(SESSION_SEED_MAX);

/**
 * Draws a new session seed from an injected source of randomness, so this
 * package needs no DOM or Node types. Pass a cryptographically strong fill,
 * for example `createSessionSeed((buffer) => crypto.getRandomValues(buffer))`.
 * The fill must write the random value into `buffer`; its return value is ignored.
 */
export function createSessionSeed(fillRandom: (buffer: Uint32Array) => unknown): number {
  const buffer = new Uint32Array(1);
  fillRandom(buffer);
  const seed = buffer[0];
  if (seed === undefined || !sessionSeedSchema.safeParse(seed).success) {
    throw new Error('createSessionSeed: the fill did not produce an unsigned 32-bit integer');
  }
  return seed;
}
