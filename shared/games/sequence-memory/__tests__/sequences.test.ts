import { describe, expect, it } from 'vitest';
import { mentalMathV1, sequenceMemoryV1 as sm } from '@nfct/shared';

describe('Sequence Memory v1 sequences', () => {
  it('uses Mental Math v1\'s frozen PRNG and seed derivation, not a copy', () => {
    expect(sm.createRng).toBe(mentalMathV1.createRng);
    expect(sm.randomInt).toBe(mentalMathV1.randomInt);
    const rng = mentalMathV1.createRng(mentalMathV1.questionSeed(99, 3, 2));
    expect(sm.sequenceAt(99, 3, 2, 5)).toEqual(sm.generateSequence(5, rng));
  });

  it('is deterministic per (seed, position, variant, level)', () => {
    expect(sm.sequenceAt(42, 0, 0, 1)).toEqual(sm.sequenceAt(42, 0, 0, 1));
    expect(sm.sequenceAt(42, 0, 0, 10)).not.toEqual(sm.sequenceAt(42, 0, 1, 10));
    expect(sm.sequenceAt(42, 0, 0, 10)).not.toEqual(sm.sequenceAt(42, 1, 0, 10));
    expect(sm.sequenceAt(42, 0, 0, 10)).not.toEqual(sm.sequenceAt(43, 0, 0, 10));
  });

  it('property: every sequence is legal for its level, with no tile right after itself', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      for (const { level, span, gridSize } of sm.LEVELS) {
        const sequence = sm.sequenceAt(seed * 7919, seed % 25, seed % sm.SEQUENCE_VARIANTS, level);
        expect(sequence).toHaveLength(span);
        expect(sm.isLegalSequence(level, sequence)).toBe(true);
        for (const [index, tile] of sequence.entries()) {
          expect(tile).toBeGreaterThanOrEqual(0);
          expect(tile).toBeLessThan(gridSize * gridSize);
          if (index > 0) expect(tile).not.toBe(sequence[index - 1]);
        }
      }
    }
  });

  it('rejects sequences outside the level', () => {
    const legal = sm.sequenceAt(5, 0, 0, 3);
    expect(sm.isLegalSequence(3, legal)).toBe(true);
    expect(sm.isLegalSequence(3, legal.slice(1))).toBe(false); // wrong span
    expect(sm.isLegalSequence(3, [0, 0, 1, 2])).toBe(false); // immediate repeat
    expect(sm.isLegalSequence(3, [0, 1, 0, 9])).toBe(false); // off a 3×3 board
    expect(sm.isLegalSequence(3, [0, 1, 0, 1])).toBe(true); // a tile may come back later
  });

  it('refuses a variant outside 0-15', () => {
    expect(() => sm.sequenceAt(1, 0, sm.SEQUENCE_VARIANTS, 1)).toThrow(RangeError);
    expect(() => sm.sequenceAt(1, 0, -1, 1)).toThrow(RangeError);
  });
});
