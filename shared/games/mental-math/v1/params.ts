// Mental Math gameVersion 1: the run, the ten levels and their question
// templates, as versioned data. These are the design's section J parameters,
// made exact and checkable. They are provisional until the simulation and
// playtesting (card NFCT-17): before the first external beta they may be tuned
// at gameVersion 1, deliberately updating the golden tests. After launch any
// change is gameplay and needs a new gameVersion module.

/** The operator symbols a trial stores: ASCII '-', Unicode '×' (U+00D7) and '÷' (U+00F7). */
export const OPERATORS = ['+', '-', '×', '÷'] as const;
export type Operator = (typeof OPERATORS)[number];

export type IntRange = { readonly min: number; readonly max: number };

/**
 * Extra conditions a template's questions must meet:
 * - 'units-carry': a + b needs a carry out of the units column.
 * - 'units-borrow': a - b needs a borrow in the units column.
 * - 'no-cancellation': in a + b - c, c differs from a and from b.
 */
export type TemplateConstraint = 'units-carry' | 'units-borrow' | 'no-cancellation';

/**
 * One kind of question. A question matches the template when its operators
 * and grouping are the template's, every operand is in its range, the first
 * evaluated step (three operands only) lands in `intermediate`, the answer in
 * `answer`, and every constraint holds.
 */
export type QuestionTemplate = {
  /** Stable within its level. */
  readonly id: string;
  /** Relative integer weight within the level. */
  readonly weight: number;
  readonly operators: readonly Operator[];
  /** True means (a op b) op c; false means standard precedence. Always false for two operands. */
  readonly grouped: boolean;
  readonly operands: readonly IntRange[];
  /** The value of the first evaluated step; null for one-step templates. */
  readonly intermediate: IntRange | null;
  readonly answer: IntRange;
  readonly constraints: readonly TemplateConstraint[];
};

export type QuestionShape = {
  readonly operands: readonly number[];
  readonly operators: readonly Operator[];
  readonly grouped: boolean;
};

export type LevelParams = {
  readonly level: number;
  /** The per-question limit. Only stops stalling; the run clock supplies the pressure. */
  readonly timeLimitMs: number;
  readonly templates: readonly QuestionTemplate[];
  /** Used only if every bounded draw fails; a legal question of the level. */
  readonly fallback: QuestionShape;
};

/** The one v1 mode: a fixed 90 s run over levels 1-10 with a 3-up/1-down staircase. */
export const MODE_ID = 'timed-90';
/** The timed-90 run: 90 s of active time (pauses and answer feedback excluded). */
export const RUN_DURATION_MS = 90_000;
/** The lowest and highest levels. */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
/** Three correct answers in a row at the current level move up one level. */
export const LEVEL_UP_STREAK = 3;
/** The most trials one session may carry (the shared cap). */
export const MAX_TRIALS = 400;
/** Responses are typed on a digit keypad with no minus key: 0 to 6 digits. */
export const MAX_RESPONSE = 999_999;
/** A response faster than this is implausible. */
export const MIN_PLAUSIBLE_RT_MS = 250;
/**
 * "Mostly two-step": at levels 7-10 two-step templates carry 80 of every 100
 * weight, and one-step review questions the other 20. Review questions keep
 * their level's stated bounds (one-digit parts at level 7, two-digit parts at
 * level 8, answers up to 500 at level 9, up to 999 at level 10).
 */
export const TWO_STEP_WEIGHT = 80;
export const ONE_STEP_REVIEW_WEIGHT = 20;

function range(min: number, max: number): IntRange {
  return { min, max };
}

type TemplateSpec = Omit<QuestionTemplate, 'weight' | 'constraints' | 'intermediate'> & {
  readonly intermediate?: IntRange;
  readonly constraints?: readonly TemplateConstraint[];
};

function template(weight: number, spec: TemplateSpec): QuestionTemplate {
  return {
    id: spec.id,
    weight,
    operators: spec.operators,
    grouped: spec.grouped,
    operands: spec.operands,
    intermediate: spec.intermediate ?? null,
    answer: spec.answer,
    constraints: spec.constraints ?? [],
  };
}

// Level 3's + and -, reused at level 4.
const add2d2dCarry: TemplateSpec = {
  id: 'add-2d-2d-carry', operators: ['+'], grouped: false,
  operands: [range(10, 99), range(10, 99)], answer: range(30, 198), constraints: ['units-carry'],
};
const sub2d2dBorrow: TemplateSpec = {
  id: 'sub-2d-2d-borrow', operators: ['-'], grouped: false,
  operands: [range(10, 99), range(10, 99)], answer: range(1, 79), constraints: ['units-borrow'],
};

// Level 6's four one-step templates, reused as the review share at level 10.
const level6Specs: readonly TemplateSpec[] = [
  { id: 'mul-2d-1d', operators: ['×'], grouped: false, operands: [range(11, 99), range(2, 9)], answer: range(22, 891) },
  { id: 'div-2d-quotient', operators: ['÷'], grouped: false, operands: [range(22, 225), range(2, 9)], answer: range(11, 25) },
  { id: 'add-3d-2d', operators: ['+'], grouped: false, operands: [range(100, 989), range(10, 99)], answer: range(110, 999) },
  { id: 'sub-3d-2d', operators: ['-'], grouped: false, operands: [range(101, 999), range(10, 99)], answer: range(2, 989) },
];

// One-step review questions for levels 7-9, within each level's own bounds.
// Level 7 (one-digit parts): the × tables 2-9 only.
const level7ReviewSpecs: readonly TemplateSpec[] = [
  { id: 'review-mul-tables-2-9', operators: ['×'], grouped: false, operands: [range(2, 9), range(2, 9)], answer: range(4, 81) },
];
// Level 8 (two-digit parts): no operand above 99.
const level8ReviewSpecs: readonly TemplateSpec[] = [
  { id: 'review-add-2d-2d', operators: ['+'], grouped: false, operands: [range(10, 99), range(10, 99)], answer: range(20, 198) },
  { id: 'review-sub-2d-2d', operators: ['-'], grouped: false, operands: [range(11, 99), range(10, 98)], answer: range(1, 89) },
  { id: 'review-mul-2d-1d', operators: ['×'], grouped: false, operands: [range(11, 99), range(2, 9)], answer: range(22, 891) },
  { id: 'review-div-2d-1d', operators: ['÷'], grouped: false, operands: [range(22, 99), range(2, 9)], answer: range(11, 49) },
];
// Level 9 (answers up to 500).
const level9ReviewSpecs: readonly TemplateSpec[] = [
  { id: 'review-mul-2d-1d-500', operators: ['×'], grouped: false, operands: [range(11, 99), range(2, 9)], answer: range(22, 500) },
  { id: 'review-div-2d-quotient', operators: ['÷'], grouped: false, operands: [range(22, 225), range(2, 9)], answer: range(11, 25) },
  { id: 'review-add-3d-2d-500', operators: ['+'], grouped: false, operands: [range(100, 490), range(10, 99)], answer: range(110, 500) },
  { id: 'review-sub-3d-2d-500', operators: ['-'], grouped: false, operands: [range(101, 500), range(10, 99)], answer: range(2, 490) },
];

function withReview(twoStep: readonly [number, TemplateSpec][], review: readonly TemplateSpec[]): QuestionTemplate[] {
  const reviewWeight = ONE_STEP_REVIEW_WEIGHT / review.length;
  return [
    ...twoStep.map(([weight, spec]) => template(weight, spec)),
    ...review.map((spec) => template(reviewWeight, spec)),
  ];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The ten v1 levels (design section J). Ranges are inclusive. "One-digit"
 * parts are 2-9 (no ±1, ×1 or ÷1); "two-digit" parts are 10-99 unless a
 * range says otherwise.
 */
export const LEVELS: readonly LevelParams[] = deepFreeze([
  {
    // + and - within 20.
    level: 1,
    timeLimitMs: 8_000,
    templates: [
      template(50, { id: 'add-within-20', operators: ['+'], grouped: false, operands: [range(1, 19), range(1, 19)], answer: range(2, 20) }),
      template(50, { id: 'sub-within-20', operators: ['-'], grouped: false, operands: [range(2, 20), range(1, 19)], answer: range(1, 19) }),
    ],
    fallback: { operands: [7, 5], operators: ['+'], grouped: false },
  },
  {
    // + and - of a two-digit and a one-digit number, answers up to 99.
    level: 2,
    timeLimitMs: 8_000,
    templates: [
      template(25, { id: 'add-2d-1d', operators: ['+'], grouped: false, operands: [range(10, 97), range(2, 9)], answer: range(12, 99) }),
      template(25, { id: 'add-1d-2d', operators: ['+'], grouped: false, operands: [range(2, 9), range(10, 97)], answer: range(12, 99) }),
      template(50, { id: 'sub-2d-1d', operators: ['-'], grouped: false, operands: [range(11, 99), range(2, 9)], answer: range(2, 97) }),
    ],
    fallback: { operands: [47, 8], operators: ['+'], grouped: false },
  },
  {
    // + and - of two two-digit numbers, always with a units carry or borrow.
    level: 3,
    timeLimitMs: 10_000,
    templates: [template(50, add2d2dCarry), template(50, sub2d2dBorrow)],
    fallback: { operands: [47, 38], operators: ['+'], grouped: false },
  },
  {
    // × tables 2-9, mixed with level-3 + and -.
    level: 4,
    timeLimitMs: 10_000,
    templates: [
      template(50, { id: 'mul-tables-2-9', operators: ['×'], grouped: false, operands: [range(2, 9), range(2, 9)], answer: range(4, 81) }),
      template(25, add2d2dCarry),
      template(25, sub2d2dBorrow),
    ],
    fallback: { operands: [7, 8], operators: ['×'], grouped: false },
  },
  {
    // ÷ facts from the 2-9 tables (divisor × quotient); × up to 12.
    level: 5,
    timeLimitMs: 10_000,
    templates: [
      template(50, { id: 'div-facts-2-9', operators: ['÷'], grouped: false, operands: [range(4, 81), range(2, 9)], answer: range(2, 9) }),
      template(50, { id: 'mul-up-to-12', operators: ['×'], grouped: false, operands: [range(2, 12), range(2, 12)], answer: range(4, 144) }),
    ],
    fallback: { operands: [56, 7], operators: ['÷'], grouped: false },
  },
  {
    // All four operations: two-digit × one-digit, two-digit-quotient ÷ one-digit,
    // three-digit ± two-digit.
    level: 6,
    timeLimitMs: 12_000,
    templates: level6Specs.map((spec) => template(25, spec)),
    fallback: { operands: [47, 6], operators: ['×'], grouped: false },
  },
  {
    // Mostly two-step with one-digit parts: (a + b) × c, a × b + c, a + b - c.
    level: 7,
    timeLimitMs: 14_000,
    templates: withReview([
      [27, {
        id: 'grouped-add-mul-1d', operators: ['+', '×'], grouped: true,
        operands: [range(2, 9), range(2, 9), range(2, 9)], intermediate: range(4, 18), answer: range(8, 162),
      }],
      [27, {
        id: 'mul-add-1d', operators: ['×', '+'], grouped: false,
        operands: [range(2, 9), range(2, 9), range(2, 9)], intermediate: range(4, 81), answer: range(6, 90),
      }],
      [26, {
        id: 'add-sub-1d', operators: ['+', '-'], grouped: false,
        operands: [range(2, 9), range(2, 9), range(2, 9)], intermediate: range(4, 18), answer: range(1, 16),
        constraints: ['no-cancellation'],
      }],
    ], level7ReviewSpecs),
    fallback: { operands: [4, 5, 6], operators: ['+', '×'], grouped: true },
  },
  {
    // Mostly two-step with two-digit ± parts and one-digit × and ÷ parts:
    // (a - b) × c, (a + b) ÷ c, a × b - c.
    level: 8,
    timeLimitMs: 15_000,
    templates: withReview([
      [27, {
        id: 'grouped-sub-mul-2d', operators: ['-', '×'], grouped: true,
        operands: [range(11, 99), range(10, 97), range(2, 9)], intermediate: range(2, 19), answer: range(4, 171),
      }],
      [27, {
        id: 'grouped-add-div-2d', operators: ['+', '÷'], grouped: true,
        operands: [range(10, 99), range(10, 99), range(2, 9)], intermediate: range(20, 198), answer: range(3, 99),
      }],
      [26, {
        id: 'mul-sub-2d', operators: ['×', '-'], grouped: false,
        operands: [range(2, 9), range(2, 9), range(10, 79)], intermediate: range(12, 81), answer: range(1, 71),
      }],
    ], level8ReviewSpecs),
    fallback: { operands: [54, 46, 7], operators: ['-', '×'], grouped: true },
  },
  {
    // Mostly two-step with a two-digit × one-digit part; answers up to 500.
    level: 9,
    timeLimitMs: 16_000,
    templates: withReview([
      [20, {
        id: 'mul-2d1d-add', operators: ['×', '+'], grouped: false,
        operands: [range(11, 99), range(2, 9), range(10, 99)], intermediate: range(22, 490), answer: range(32, 500),
      }],
      [20, {
        id: 'mul-2d1d-sub', operators: ['×', '-'], grouped: false,
        operands: [range(11, 99), range(2, 9), range(10, 99)], intermediate: range(22, 599), answer: range(2, 500),
      }],
      [20, {
        id: 'add-mul-2d1d', operators: ['+', '×'], grouped: false,
        operands: [range(10, 99), range(11, 99), range(2, 9)], intermediate: range(22, 490), answer: range(32, 500),
      }],
      [20, {
        id: 'grouped-sub-mul-2d1d', operators: ['-', '×'], grouped: true,
        operands: [range(20, 99), range(10, 89), range(2, 9)], intermediate: range(10, 89), answer: range(20, 500),
      }],
    ], level9ReviewSpecs),
    fallback: { operands: [47, 6, 38], operators: ['×', '+'], grouped: false },
  },
  {
    // Mostly two-step with a three-digit intermediate value; answers up to 999.
    level: 10,
    timeLimitMs: 18_000,
    templates: withReview([
      [20, {
        id: 'mul-2d1d-add-3d', operators: ['×', '+'], grouped: false,
        operands: [range(12, 99), range(2, 9), range(10, 99)], intermediate: range(100, 891), answer: range(110, 999),
      }],
      [20, {
        id: 'mul-2d1d-sub-3d', operators: ['×', '-'], grouped: false,
        operands: [range(12, 99), range(2, 9), range(10, 99)], intermediate: range(100, 891), answer: range(2, 881),
      }],
      [20, {
        id: 'grouped-add-mul-3d', operators: ['+', '×'], grouped: true,
        operands: [range(50, 99), range(50, 99), range(2, 9)], intermediate: range(100, 198), answer: range(200, 999),
      }],
      [20, {
        id: 'grouped-sub-div-3d', operators: ['-', '÷'], grouped: true,
        operands: [range(110, 999), range(10, 99), range(2, 9)], intermediate: range(100, 989), answer: range(12, 494),
      }],
    ], level6Specs),
    fallback: { operands: [87, 9, 45], operators: ['×', '+'], grouped: false },
  },
] satisfies LevelParams[]);

/** The parameters of one level; throws for a level outside 1-10. */
export function levelParams(level: number): LevelParams {
  const params = Number.isInteger(level) ? LEVELS[level - 1] : undefined;
  if (!params) throw new RangeError(`Mental Math v1 has levels ${MIN_LEVEL}-${MAX_LEVEL}, got ${level}`);
  return params;
}

/** The level's per-question time limit. */
export function timeLimitFor(level: number): number {
  return levelParams(level).timeLimitMs;
}
