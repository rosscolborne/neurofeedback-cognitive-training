import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSessionSeed, SESSION_SEED_MAX, sessionSeedSchema } from '@nfct/shared';

describe('session seed', () => {
  it('is an unsigned 32-bit integer', () => {
    for (const seed of [0, 1, 123_456_789, SESSION_SEED_MAX]) expect(sessionSeedSchema.safeParse(seed).success).toBe(true);
    for (const seed of [-1, SESSION_SEED_MAX + 1, 0.5, Number.POSITIVE_INFINITY, '7', null]) {
      expect(sessionSeedSchema.safeParse(seed).success).toBe(false);
    }
  });

  it('is drawn from the injected source of randomness', () => {
    expect(createSessionSeed((buffer) => { buffer[0] = 0xdead_beef; })).toBe(0xdead_beef);
    expect(createSessionSeed((buffer) => buffer.fill(7))).toBe(7);
  });

  it('works with a real cryptographic fill, as the client passes it', () => {
    const seeds = Array.from({ length: 32 }, () => createSessionSeed((buffer) => webcrypto.getRandomValues(buffer)));

    expect(seeds.every((seed) => sessionSeedSchema.safeParse(seed).success)).toBe(true);
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});
