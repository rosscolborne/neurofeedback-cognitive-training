import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';

/** The widely published mulberry32, verbatim apart from types, as the reference implementation. */
function publishedMulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function outputs(seed: number, count: number): number[] {
  const rng = mm.createRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe('Mental Math v1 PRNG', () => {
  it('is mulberry32, step for step, over long streams', () => {
    for (const seed of [0, 1, 42, 0x7fff_ffff, 0x8000_0000, 0xdead_beef, 0xffff_ffff]) {
      const reference = publishedMulberry32(seed);
      const ours = mm.createRng(seed);
      for (let step = 0; step < 5_000; step += 1) {
        expect(ours.nextUint32() / 4294967296).toBe(reference());
      }
    }
  });

  it('keeps its golden outputs (frozen with gameVersion 1)', () => {
    expect(outputs(0, 4)).toEqual([1144304738, 1416247, 958946056, 627933444]);
    expect(outputs(42, 4)).toEqual([2581720956, 1925393290, 3661312704, 2876485805]);
    expect(outputs(0xffff_ffff, 4)).toEqual([3850105811, 813802916, 3073704848, 4054706436]);
  });

  it('holds its state per generator, with no module state', () => {
    const a = mm.createRng(7);
    const b = mm.createRng(7);
    const first = a.nextUint32();
    a.nextUint32();

    expect(b.nextUint32()).toBe(first);
  });

  it('refuses seeds that are not unsigned 32-bit integers', () => {
    for (const seed of [-1, 2 ** 32, 1.5, Number.NaN]) expect(() => mm.createRng(seed)).toThrow(RangeError);
  });

  it('draws bounded integers exactly, one step per draw', () => {
    const rng = mm.createRng(99);
    const reference = mm.createRng(99);
    for (let draw = 0; draw < 2_000; draw += 1) {
      const value = mm.randomInt(rng, -3, 17);
      expect(value).toBe(-3 + Math.floor((reference.nextUint32() * 21) / 2 ** 32));
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThanOrEqual(17);
    }
    // Extremes of the output map to the ends of the range.
    expect(mm.randomInt({ nextUint32: () => 0 }, 5, 9)).toBe(5);
    expect(mm.randomInt({ nextUint32: () => 0xffff_ffff }, 5, 9)).toBe(9);
    expect(() => mm.randomInt(rng, 3, 2)).toThrow(RangeError);
    expect(() => mm.randomInt(rng, 0, mm.MAX_RANDOM_SPAN)).toThrow(RangeError);
  });

  it('picks by cumulative integer weight in array order', () => {
    const items = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];
    const at = (u32: number) => mm.pickWeighted({ nextUint32: () => u32 }, items).id;

    expect(at(0)).toBe('a');
    expect(at(2 ** 30 - 1)).toBe('a');
    expect(at(2 ** 30)).toBe('b');
    expect(at(0xffff_ffff)).toBe('b');
    expect(() => mm.pickWeighted(mm.createRng(1), [{ weight: 0.5 }])).toThrow(RangeError);
  });

  it('derives distinct, golden question seeds from (seed, position, variant)', () => {
    expect(mm.questionSeed(0, 0, 0)).toBe(mm.questionSeed(0, 0, 0));
    expect([
      mm.questionSeed(0, 0, 0),
      mm.questionSeed(0, 0, 1),
      mm.questionSeed(0, 1, 0),
      mm.questionSeed(1, 0, 0),
      mm.questionSeed(0xffff_ffff, 399, 15),
    ]).toEqual([3039179631, 362446981, 2758809130, 240168008, 787088108]);

    const seen = new Set<number>();
    for (let position = 0; position < 400; position += 1) {
      for (let variant = 0; variant < mm.QUESTION_VARIANTS; variant += 1) seen.add(mm.questionSeed(12_345, position, variant));
    }
    expect(seen.size).toBe(400 * mm.QUESTION_VARIANTS);
    expect(() => mm.questionSeed(1, -1, 0)).toThrow(RangeError);
    expect(() => mm.questionSeed(1, 0, 0.5)).toThrow(RangeError);
  });
});
