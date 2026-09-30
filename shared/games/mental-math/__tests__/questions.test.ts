import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';

type Shape = mm.QuestionShape;
const q = (operands: number[], operators: mm.Operator[], grouped = false): Shape => ({ operands, operators, grouped });

/** Many session seeds, spread over the 32-bit range. */
const SEEDS = Array.from({ length: 150 }, (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0);
const POSITIONS = [0, 1, 7, 39, 399];

function* generated(level: number): Generator<mm.Question> {
  for (const seed of SEEDS) {
    for (const position of POSITIONS) {
      for (let variant = 0; variant < mm.QUESTION_VARIANTS; variant += 4) yield mm.questionAt(seed, position, variant, level);
    }
  }
}

describe('evaluate', () => {
  it('applies standard precedence when not grouped, and brackets when grouped', () => {
    expect(mm.evaluate(q([2, 3, 4], ['+', '×']))).toBe(14);
    expect(mm.evaluate(q([2, 3, 4], ['+', '×'], true))).toBe(20);
    expect(mm.evaluate(q([2, 3, 4], ['×', '+']))).toBe(10);
    expect(mm.evaluate(q([20, 3, 4], ['-', '÷']))).toBeNull(); // 20 - 3 / 4 is not whole
    expect(mm.evaluate(q([20, 4, 4], ['-', '÷'], true))).toBe(4);
    expect(mm.evaluate(q([9, 3, 2], ['-', '+']))).toBe(8); // left to right
    expect(mm.evaluate(q([24, 4, 2], ['÷', '×']))).toBe(12);
    expect(mm.evaluate(q([7, 5], ['-']))).toBe(2);
  });

  it('returns null for inexact division, division by zero and malformed shapes', () => {
    expect(mm.evaluate(q([7, 2], ['÷']))).toBeNull();
    expect(mm.evaluate(q([7, 0], ['÷']))).toBeNull();
    expect(mm.evaluate(q([7, 2, 3], ['+']))).toBeNull();
    expect(mm.evaluate(q([7], []))).toBeNull();
    expect(mm.evaluate(q([7, 2.5], ['+']))).toBeNull();
  });

  it('reports the first evaluated step of a two-step question', () => {
    expect(mm.intermediateOf(q([2, 3, 4], ['+', '×']))).toBe(12);
    expect(mm.intermediateOf(q([2, 3, 4], ['+', '×'], true))).toBe(5);
    expect(mm.intermediateOf(q([2, 3], ['+']))).toBeNull();
  });
});

describe('trivial questions', () => {
  it('names every trivial pattern the card rules out', () => {
    expect(mm.trivialitiesOf(q([7, 1], ['×']))).toEqual(['times-one']);
    expect(mm.trivialitiesOf(q([7, 0], ['×']))).toEqual(['non-positive-operand', 'non-positive-result']);
    expect(mm.trivialitiesOf(q([7, 1], ['÷']))).toEqual(['divide-by-one']);
    expect(mm.trivialitiesOf(q([7, 7], ['÷']))).toEqual(['quotient-one']);
    expect(mm.trivialitiesOf(q([7, 2], ['÷']))).toEqual(['inexact-division']);
    expect(mm.trivialitiesOf(q([7, 7], ['-']))).toEqual(['non-positive-result']);
    expect(mm.trivialitiesOf(q([3, 7], ['-']))).toEqual(['non-positive-result']);
    expect(mm.trivialitiesOf(q([4, 5, 5], ['+', '-']))).toEqual(['cancellation']);
    expect(mm.trivialitiesOf(q([4, 5, 4], ['+', '-']))).toEqual(['cancellation']);
    expect(mm.trivialitiesOf(q([9, 5, 5], ['-', '+']))).toEqual(['cancellation']);
    expect(mm.trivialitiesOf(q([6, 5, 5], ['×', '÷']))).toEqual(['cancellation']);
    expect(mm.trivialitiesOf(q([6, 6, 3], ['-', '×'], true))).toEqual(['non-positive-result']);
    expect(mm.trivialitiesOf(q([7, 8, 1], ['+', '×'], true))).toEqual(['times-one']);
    expect(mm.trivialitiesOf(q([4, 5, 6], ['+', '×'], true))).toEqual([]);
  });
});

describe('level legality', () => {
  it('accepts the level examples of design section J and rejects other levels\' questions', () => {
    expect(mm.isLegalQuestion(1, q([7, 5], ['+']))).toBe(true);
    expect(mm.isLegalQuestion(1, q([15, 9], ['+']))).toBe(false); // over 20
    expect(mm.isLegalQuestion(2, q([47, 8], ['+']))).toBe(true);
    expect(mm.isLegalQuestion(2, q([47, 38], ['+']))).toBe(false);
    expect(mm.isLegalQuestion(3, q([47, 38], ['+']))).toBe(true); // carry
    expect(mm.isLegalQuestion(3, q([41, 38], ['+']))).toBe(false); // no carry
    expect(mm.isLegalQuestion(3, q([52, 38], ['-']))).toBe(true); // borrow
    expect(mm.isLegalQuestion(3, q([58, 32], ['-']))).toBe(false); // no borrow
    expect(mm.isLegalQuestion(4, q([7, 8], ['×']))).toBe(true);
    expect(mm.isLegalQuestion(4, q([7, 1], ['×']))).toBe(false);
    expect(mm.isLegalQuestion(5, q([56, 7], ['÷']))).toBe(true);
    expect(mm.isLegalQuestion(5, q([12, 12], ['×']))).toBe(true);
    expect(mm.isLegalQuestion(5, q([7, 1], ['÷']))).toBe(false);
    expect(mm.isLegalQuestion(6, q([47, 6], ['×']))).toBe(true);
    expect(mm.isLegalQuestion(6, q([467, 38], ['-']))).toBe(true);
    expect(mm.isLegalQuestion(7, q([4, 5, 6], ['+', '×'], true))).toBe(true);
    expect(mm.isLegalQuestion(7, q([4, 5, 6], ['+', '×']))).toBe(false); // wrong grouping for the template
    expect(mm.isLegalQuestion(8, q([54, 46, 7], ['-', '×'], true))).toBe(true);
    expect(mm.isLegalQuestion(8, q([40, 32, 8], ['+', '÷'], true))).toBe(true);
    expect(mm.isLegalQuestion(9, q([47, 6, 38], ['×', '+']))).toBe(true);
    expect(mm.isLegalQuestion(9, q([87, 9, 45], ['×', '+']))).toBe(false); // answer over 500
    expect(mm.isLegalQuestion(10, q([87, 9, 45], ['×', '+']))).toBe(true);
    expect(mm.isLegalQuestion(10, q([7, 9, 45], ['×', '+']))).toBe(false); // intermediate under 100
  });

  it('includes each level\'s fallback question', () => {
    for (const params of mm.LEVELS) expect(mm.isLegalQuestion(params.level, params.fallback)).toBe(true);
  });

  it('makes levels 7-10 mostly two-step: exactly 80 of every 100 template weight', () => {
    for (const params of mm.LEVELS) {
      const weight = (steps: number) => params.templates.filter((t) => t.operators.length === steps).reduce((sum, t) => sum + t.weight, 0);
      const total = weight(1) + weight(2);
      expect(total).toBe(100);
      expect(weight(2)).toBe(params.level >= 7 ? mm.TWO_STEP_WEIGHT : 0);
    }
  });
});

describe('question generator (property tests over all 10 levels and many seeds)', () => {
  it('always gives a legal, positive whole-number question with no trivial step', () => {
    for (const params of mm.LEVELS) {
      let count = 0;
      for (const question of generated(params.level)) {
        count += 1;
        const legal = mm.isLegalQuestion(params.level, question);
        if (!legal || !Number.isInteger(question.expected) || question.expected < 1) {
          throw new Error(`level ${params.level}: ${mm.formatQuestion(question)} = ${question.expected}`);
        }
        expect(mm.evaluate(question)).toBe(question.expected);
        expect(mm.trivialitiesOf(question)).toEqual([]);
        expect(question.operators).toHaveLength(question.operands.length - 1);
        if (question.operands.length === 2) expect(question.grouped).toBe(false);
        expect(question.operands.every((operand) => Number.isInteger(operand) && operand >= 1)).toBe(true);
      }
      expect(count).toBe(SEEDS.length * POSITIONS.length * 4);
    }
  });

  it('builds division as divisor × quotient: always exact, divisor and quotient at least 2', () => {
    for (const params of mm.LEVELS) {
      for (const question of generated(params.level)) {
        const [op1, op2] = question.operators;
        if (op1 === '÷') {
          const [dividend, divisor] = question.operands as [number, number];
          expect(dividend % divisor).toBe(0);
          expect(divisor).toBeGreaterThanOrEqual(2);
          expect(dividend / divisor).toBeGreaterThanOrEqual(2);
        }
        if (op2 === '÷') {
          const dividend = mm.intermediateOf(question)!;
          const divisor = question.operands[2]!;
          expect(dividend % divisor).toBe(0);
          expect(dividend / divisor).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('keeps each level inside the design section J bounds', () => {
    const answers = (level: number) => [...generated(level)].map((question) => question.expected);
    expect(Math.max(...answers(1))).toBeLessThanOrEqual(20);
    expect(Math.max(...answers(2))).toBeLessThanOrEqual(99);
    for (const question of generated(2)) {
      const digits = question.operands.map((operand) => String(operand).length).sort();
      expect(digits).toEqual([1, 2]);
    }
    for (const question of generated(3)) {
      const [a, b] = question.operands as [number, number];
      expect(a >= 10 && b >= 10).toBe(true);
      expect(question.operators[0] === '+' ? (a % 10) + (b % 10) >= 10 : a % 10 < b % 10).toBe(true);
    }
    for (const question of generated(4)) {
      if (question.operators[0] === '×') expect(question.operands.every((operand) => operand >= 2 && operand <= 9)).toBe(true);
    }
    for (const question of generated(5)) {
      if (question.operators[0] === '÷') expect(question.expected >= 2 && question.expected <= 9).toBe(true);
      else expect(question.operands.every((operand) => operand >= 2 && operand <= 12)).toBe(true);
    }
    expect(Math.max(...answers(9))).toBeLessThanOrEqual(999); // one-step review items reach 999
    for (const question of generated(9)) if (question.operators.length === 2) expect(question.expected).toBeLessThanOrEqual(500);
    for (const question of generated(10)) {
      expect(question.expected).toBeLessThanOrEqual(999);
      if (question.operators.length === 2) expect(mm.intermediateOf(question)).toBeGreaterThanOrEqual(100);
    }
  });

  it('is deterministic: the same seed, position, variant and level give the same question', () => {
    for (const params of mm.LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        expect(mm.questionAt(seed, 3, 5, params.level)).toEqual(mm.questionAt(seed, 3, 5, params.level));
      }
    }
  });

  it('falls back to the level\'s fixed question when every bounded draw fails', () => {
    // A generator stuck at its lowest output keeps drawing an empty or
    // rejected candidate; generation still ends, with the legal fallback.
    const stuck: mm.Rng = { nextUint32: () => 0 };
    for (const params of mm.LEVELS) {
      const question = mm.generateQuestion(params.level, stuck);
      expect(mm.isLegalQuestion(params.level, question)).toBe(true);
    }
    // Level 3 then always draws 10 + 10, which has no units carry.
    const level3 = mm.generateQuestion(3, stuck);
    expect(level3.template).toBe('fallback');
    expect(level3).toMatchObject({ operands: [47, 38], operators: ['+'], grouped: false, expected: 85 });
  });

  it('refuses a variant outside 0-15 and a level outside 1-10', () => {
    expect(() => mm.questionAt(1, 0, mm.QUESTION_VARIANTS, 1)).toThrow(RangeError);
    expect(() => mm.questionAt(1, 0, 0, 11)).toThrow(RangeError);
    expect(() => mm.questionAt(1, 0, 0, 0)).toThrow(RangeError);
  });
});
