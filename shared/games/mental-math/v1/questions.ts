import {
  levelParams,
  type IntRange,
  type LevelParams,
  type Operator,
  type QuestionShape,
  type QuestionTemplate,
} from './params';
import { createRng, pickWeighted, questionSeed, randomInt, type Rng } from './rng';

// Mental Math gameVersion 1: evaluating, checking and generating questions.
// FROZEN with gameVersion 1 (see ./index.ts).

/** A generated question: its shape, the answer and which template produced it. */
export type Question = QuestionShape & {
  readonly expected: number;
  /** The template id, or 'fallback'. Not stored on trials. */
  readonly template: string;
};

/**
 * How many variants each question position has. A question discarded by a
 * pause is replaced by the next variant at the same position (wrapping after
 * the last), so trusted scoring can reproduce every recorded question by
 * trying at most this many variants, without any stored counter.
 */
export const QUESTION_VARIANTS = 16;
/** Bounded retry: draws per question before the level's fallback is used. */
export const MAX_DRAWS_PER_QUESTION = 64;

function isMulDiv(operator: Operator): boolean {
  return operator === '×' || operator === '÷';
}

/** One exact integer step, or null when division is inexact or by zero. */
function apply(operator: Operator, left: number, right: number): number | null {
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '×': return left * right;
    case '÷': return right === 0 || left % right !== 0 ? null : left / right;
  }
}

type Step = { readonly operator: Operator; readonly left: number; readonly right: number; readonly result: number };

/**
 * True for a three-operand question evaluated as a op1 (b op2 c): not
 * grouped, with × or ÷ after + or -. Every other three-operand question is
 * evaluated (a op1 b) op2 c, whether bracketed or by left-to-right precedence.
 */
function evaluatesRightPairFirst(shape: Pick<QuestionShape, 'operators' | 'grouped'>): boolean {
  const [first, second] = shape.operators;
  return !shape.grouped && first !== undefined && second !== undefined && isMulDiv(second) && !isMulDiv(first);
}

/** The evaluation steps in order, or null if the shape is malformed or a step is inexact. */
function stepsOf(shape: QuestionShape): Step[] | null {
  const { operands, operators } = shape;
  if (!operands.every(Number.isSafeInteger)) return null;
  const step = (operator: Operator, left: number, right: number): Step | null => {
    const result = apply(operator, left, right);
    return result === null || !Number.isSafeInteger(result) ? null : { operator, left, right, result };
  };
  if (operands.length === 2 && operators.length === 1) {
    const only = step(operators[0]!, operands[0]!, operands[1]!);
    return only && [only];
  }
  if (operands.length !== 3 || operators.length !== 2) return null;
  const [a, b, c] = operands as [number, number, number];
  const [op1, op2] = operators as [Operator, Operator];
  if (evaluatesRightPairFirst(shape)) {
    const inner = step(op2, b, c);
    const outer = inner && step(op1, a, inner.result);
    return inner && outer && [inner, outer];
  }
  const inner = step(op1, a, b);
  const outer = inner && step(op2, inner.result, c);
  return inner && outer && [inner, outer];
}

/**
 * The exact integer value of the operands with their operators and grouping,
 * or null when the shape is malformed or a division is inexact or by zero.
 * With `grouped: false`, × and ÷ bind tighter than + and -, and equal
 * precedence evaluates left to right.
 */
export function evaluate(shape: QuestionShape): number | null {
  const steps = stepsOf(shape);
  return steps ? steps[steps.length - 1]!.result : null;
}

/** The value of the first evaluated step of a three-operand question, else null. */
export function intermediateOf(shape: QuestionShape): number | null {
  const steps = stepsOf(shape);
  return steps && steps.length === 2 ? steps[0]!.result : null;
}

/**
 * Why a question is trivial or not a positive whole-number exercise. v1
 * never generates any of these:
 * - 'non-positive-operand': an operand below 1 (so no ×0 and no +0);
 * - 'non-positive-result': a step or the answer below 1 (so no a - a);
 * - 'times-one', 'divide-by-one': a factor or divisor of 1;
 * - 'quotient-one': a ÷ a;
 * - 'inexact-division': a remainder, or division by zero;
 * - 'cancellation': the second step undoes the first (a + b - b, a + b - a,
 *   a - b + b, a × b ÷ b, a × b ÷ a, a ÷ b × b).
 */
export type Triviality =
  | 'non-positive-operand'
  | 'non-positive-result'
  | 'times-one'
  | 'divide-by-one'
  | 'quotient-one'
  | 'inexact-division'
  | 'cancellation';

export function trivialitiesOf(shape: QuestionShape): Triviality[] {
  const found = new Set<Triviality>();
  if (shape.operands.some((operand) => operand < 1)) found.add('non-positive-operand');
  const evaluated = (operator: Operator, left: number, right: number): number | null => {
    if (operator === '×' && (left === 1 || right === 1)) found.add('times-one');
    if (operator === '÷') {
      if (right === 1) found.add('divide-by-one');
      if (right === 0 || left % right !== 0) {
        found.add('inexact-division');
        return null;
      }
      if (left === right) found.add('quotient-one');
    }
    const result = apply(operator, left, right);
    if (result !== null && result < 1) found.add('non-positive-result');
    return result;
  };
  const { operands, operators } = shape;
  if (operands.length === 2 && operators.length === 1) {
    evaluated(operators[0]!, operands[0]!, operands[1]!);
  } else if (operands.length === 3 && operators.length === 2) {
    const [a, b, c] = operands as [number, number, number];
    const [op1, op2] = operators as [Operator, Operator];
    if (evaluatesRightPairFirst(shape)) {
      const inner = evaluated(op2, b, c);
      if (inner !== null) evaluated(op1, a, inner);
    } else {
      const inner = evaluated(op1, a, b);
      if (inner !== null) evaluated(op2, inner, c);
      const inverse = (op1 === '+' && op2 === '-') || (op1 === '-' && op2 === '+')
        || (op1 === '×' && op2 === '÷') || (op1 === '÷' && op2 === '×');
      const undoesFirst = c === b || ((op1 === '+' || op1 === '×') && c === a);
      if (inverse && undoesFirst) found.add('cancellation');
    }
  }
  return [...found];
}

function inRange(value: number, { min, max }: IntRange): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function constraintHolds(constraint: QuestionTemplate['constraints'][number], operands: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = operands;
  switch (constraint) {
    case 'units-carry': return (a % 10) + (b % 10) >= 10;
    case 'units-borrow': return a % 10 < b % 10;
    case 'no-cancellation': return c !== a && c !== b;
  }
}

/** Whether a question is one the template can produce. */
export function matchesTemplate(shape: QuestionShape, template: QuestionTemplate): boolean {
  if (shape.grouped !== template.grouped || !sameList(shape.operators, template.operators)) return false;
  if (shape.operands.length !== template.operands.length) return false;
  if (!shape.operands.every((operand, index) => inRange(operand, template.operands[index]!))) return false;
  const steps = stepsOf(shape);
  if (!steps || !inRange(steps[steps.length - 1]!.result, template.answer)) return false;
  if (template.intermediate === null ? steps.length !== 1
    : steps.length !== 2 || !inRange(steps[0]!.result, template.intermediate)) {
    return false;
  }
  if (trivialitiesOf(shape).length > 0) return false;
  return template.constraints.every((constraint) => constraintHolds(constraint, shape.operands));
}

/** The level's template that produces this question, if any. */
export function templateFor(level: number, shape: QuestionShape): QuestionTemplate | undefined {
  return levelParams(level).templates.find((template) => matchesTemplate(shape, template));
}

/** Whether a question belongs to the level: its operators, grouping, operand ranges and bounds. */
export function isLegalQuestion(level: number, shape: QuestionShape): boolean {
  return templateFor(level, shape) !== undefined;
}

export function sameQuestion(a: QuestionShape, b: QuestionShape): boolean {
  return a.grouped === b.grouped && sameList(a.operators, b.operators) && sameList(a.operands, b.operands);
}

/** A plain-text rendering, e.g. "(4 + 5) × 6". Display is NFCT-21's; this is for tests and reports. */
export function formatQuestion(shape: QuestionShape): string {
  const [a, b, c] = shape.operands;
  const [op1, op2] = shape.operators;
  if (op2 === undefined) return `${a} ${op1} ${b}`;
  return shape.grouped ? `(${a} ${op1} ${b}) ${op2} ${c}` : `${a} ${op1} ${b} ${op2} ${c}`;
}

// ---- Drawing ----
//
// Each draw uses only randomInt, in the order written, so a seed always gives
// the same question. A draw can fail (return null) when a range is empty; the
// caller then retries, up to MAX_DRAWS_PER_QUESTION times, and validates every
// candidate with matchesTemplate, so a draw never has to be exact.

function randomIn(rng: Rng, low: number, high: number): number | null {
  return low > high ? null : randomInt(rng, low, high);
}

function ceilDiv(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

function floorDiv(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator);
}

/** A free draw of `x op y` whose result should land in `result`. */
function drawPair(rng: Rng, operator: Operator, x: IntRange, y: IntRange, result: IntRange): [number, number] | null {
  switch (operator) {
    case '+':
    case '×':
      return [randomInt(rng, x.min, x.max), randomInt(rng, y.min, y.max)];
    case '-': {
      // Subtrahend and difference, then the minuend: still uniform over valid pairs.
      const right = randomInt(rng, y.min, y.max);
      const difference = randomInt(rng, result.min, result.max);
      return [right + difference, right];
    }
    case '÷': {
      // Divisor, then a quotient that keeps the dividend in range: division is
      // always built as divisor × quotient, so it is exact.
      const divisor = randomInt(rng, y.min, y.max);
      const quotient = randomIn(rng, Math.max(result.min, ceilDiv(x.min, divisor)), Math.min(result.max, floorDiv(x.max, divisor)));
      return quotient === null ? null : [divisor * quotient, divisor];
    }
  }
}

/** Given the left value, a right operand that puts `left op right` in `result`. */
function drawRightOperand(rng: Rng, operator: Operator, left: number, y: IntRange, result: IntRange): number | null {
  switch (operator) {
    case '+': return randomIn(rng, Math.max(y.min, result.min - left), Math.min(y.max, result.max - left));
    case '-': return randomIn(rng, Math.max(y.min, left - result.max), Math.min(y.max, left - result.min));
    case '×': return randomIn(rng, Math.max(y.min, ceilDiv(result.min, left)), Math.min(y.max, floorDiv(result.max, left)));
    case '÷': throw new Error('Mental Math v1 builds (a op b) ÷ c from the divisor first');
  }
}

/** Given the right value, a left operand that puts `left op right` in `result`. */
function drawLeftOperand(rng: Rng, operator: Operator, right: number, x: IntRange, result: IntRange): number | null {
  switch (operator) {
    case '+': return randomIn(rng, Math.max(x.min, result.min - right), Math.min(x.max, result.max - right));
    case '-': return randomIn(rng, Math.max(x.min, result.min + right), Math.min(x.max, result.max + right));
    case '×':
    case '÷': throw new Error('Mental Math v1 evaluates a right pair first only after + or -');
  }
}

/** Two operands in range whose `x op y` equals `value`. */
function splitValue(rng: Rng, operator: Operator, value: number, x: IntRange, y: IntRange): [number, number] | null {
  switch (operator) {
    case '+': {
      const left = randomIn(rng, Math.max(x.min, value - y.max), Math.min(x.max, value - y.min));
      return left === null ? null : [left, value - left];
    }
    case '-': {
      const right = randomIn(rng, Math.max(y.min, x.min - value), Math.min(y.max, x.max - value));
      return right === null ? null : [value + right, right];
    }
    case '×':
    case '÷': throw new Error('Mental Math v1 never splits a value into a product or quotient');
  }
}

function drawShape(template: QuestionTemplate, rng: Rng): QuestionShape | null {
  const { operators, grouped, operands: ranges, answer } = template;
  if (operators.length === 1) {
    const pair = drawPair(rng, operators[0]!, ranges[0]!, ranges[1]!, answer);
    return pair && { operands: pair, operators, grouped };
  }
  const [op1, op2] = operators as [Operator, Operator];
  const [rangeA, rangeB, rangeC] = ranges as [IntRange, IntRange, IntRange];
  const intermediate = template.intermediate!;
  if (evaluatesRightPairFirst(template)) {
    // a op1 (b op2 c)
    const pair = drawPair(rng, op2, rangeB, rangeC, intermediate);
    const inner = pair && apply(op2, pair[0], pair[1]);
    if (!pair || inner === null) return null;
    const a = drawLeftOperand(rng, op1, inner, rangeA, answer);
    return a === null ? null : { operands: [a, pair[0], pair[1]], operators, grouped };
  }
  // (a op1 b) op2 c
  if (op2 === '÷') {
    // Divisor first, so every divisor is equally likely, then a quotient that
    // keeps the dividend in the intermediate range, then split the dividend.
    const c = randomInt(rng, rangeC.min, rangeC.max);
    const quotient = randomIn(rng, Math.max(answer.min, ceilDiv(intermediate.min, c)), Math.min(answer.max, floorDiv(intermediate.max, c)));
    const pair = quotient === null ? null : splitValue(rng, op1, c * quotient, rangeA, rangeB);
    return pair && { operands: [pair[0], pair[1], c], operators, grouped };
  }
  const pair = drawPair(rng, op1, rangeA, rangeB, intermediate);
  const inner = pair && apply(op1, pair[0], pair[1]);
  if (!pair || inner === null) return null;
  const c = drawRightOperand(rng, op2, inner, rangeC, answer);
  return c === null ? null : { operands: [pair[0], pair[1], c], operators, grouped };
}

function toQuestion(shape: QuestionShape, template: string): Question {
  return {
    operands: [...shape.operands],
    operators: [...shape.operators],
    grouped: shape.grouped,
    expected: evaluate(shape)!,
    template,
  };
}

/**
 * One question at `level`: picks a template by weight (one step), then makes
 * up to MAX_DRAWS_PER_QUESTION draws from it and returns the first legal one.
 * If every draw fails it returns the level's fixed fallback, so generation
 * always terminates with a legal question.
 */
export function generateQuestion(level: number, rng: Rng): Question {
  const params: LevelParams = levelParams(level);
  const template = pickWeighted(rng, params.templates);
  for (let draw = 0; draw < MAX_DRAWS_PER_QUESTION; draw += 1) {
    const shape = drawShape(template, rng);
    if (shape && matchesTemplate(shape, template)) return toQuestion(shape, template.id);
  }
  return toQuestion(params.fallback, 'fallback');
}

/**
 * The question at `position` (how many trials were recorded before it) and
 * `variant` (0 to QUESTION_VARIANTS - 1) of a session, shown at `level`.
 */
export function questionAt(seed: number, position: number, variant: number, level: number): Question {
  if (!Number.isInteger(variant) || variant < 0 || variant >= QUESTION_VARIANTS) {
    throw new RangeError(`variant must be 0-${QUESTION_VARIANTS - 1}, got ${variant}`);
  }
  return generateQuestion(level, createRng(questionSeed(seed, position, variant)));
}
