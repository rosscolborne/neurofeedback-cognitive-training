import { describe, expect, it } from 'vitest';
import { mentalMathV1 as mm } from '@nfct/shared';
import { correct, pause, play, timeout, wrong } from './helpers';

// Freeze tests for gameVersion 1 / scoringVersion 1. They fail if v1 behaviour
// drifts in any way: the levels, the PRNG, the seed derivation, the generator,
// the staircase, the run rules or the scoring. Before the first external beta
// the provisional parameters may still be tuned at version 1, updating these
// values deliberately; after launch a failure here means the change belongs
// in a new gameVersion (or scoringVersion) instead.

/** FNV-1a (32-bit) of a string, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const render = (question: mm.Question) => `${mm.formatQuestion(question)} = ${question.expected}`;

describe('Mental Math v1 golden values', () => {
  it('keeps the level parameters', () => {
    expect(fnv1a(JSON.stringify(mm.LEVELS))).toBe('6fdf6b12');
  });

  it('keeps every v1 constant, bound and tolerance', () => {
    expect({
      GAME_ID: mm.GAME_ID,
      GAME_VERSION: mm.GAME_VERSION,
      SCORING_VERSION: mm.SCORING_VERSION,
      MODE_ID: mm.MODE_ID,
      RUN_DURATION_MS: mm.RUN_DURATION_MS,
      MIN_LEVEL: mm.MIN_LEVEL,
      MAX_LEVEL: mm.MAX_LEVEL,
      LEVEL_UP_STREAK: mm.LEVEL_UP_STREAK,
      MAX_TRIALS: mm.MAX_TRIALS,
      MAX_RESPONSE: mm.MAX_RESPONSE,
      MIN_PLAUSIBLE_RT_MS: mm.MIN_PLAUSIBLE_RT_MS,
      TWO_STEP_WEIGHT: mm.TWO_STEP_WEIGHT,
      ONE_STEP_REVIEW_WEIGHT: mm.ONE_STEP_REVIEW_WEIGHT,
      QUESTION_VARIANTS: mm.QUESTION_VARIANTS,
      MAX_DRAWS_PER_QUESTION: mm.MAX_DRAWS_PER_QUESTION,
      MAX_RANDOM_SPAN: mm.MAX_RANDOM_SPAN,
      MAX_FAST_RESPONSE_PERCENT: mm.MAX_FAST_RESPONSE_PERCENT,
      TIMING_TOLERANCE_MS: mm.TIMING_TOLERANCE_MS,
      ACTIVE_DURATION_TOLERANCE_MS: mm.ACTIVE_DURATION_TOLERANCE_MS,
      OPERATORS: mm.OPERATORS,
      limits: mm.definition.limits,
    }).toEqual({
      GAME_ID: 'mental-math',
      GAME_VERSION: 1,
      SCORING_VERSION: 1,
      MODE_ID: 'timed-90',
      RUN_DURATION_MS: 90_000,
      MIN_LEVEL: 1,
      MAX_LEVEL: 10,
      LEVEL_UP_STREAK: 3,
      MAX_TRIALS: 400,
      MAX_RESPONSE: 999_999,
      MIN_PLAUSIBLE_RT_MS: 250,
      TWO_STEP_WEIGHT: 80,
      ONE_STEP_REVIEW_WEIGHT: 20,
      QUESTION_VARIANTS: 16,
      MAX_DRAWS_PER_QUESTION: 64,
      MAX_RANDOM_SPAN: 2_097_152,
      MAX_FAST_RESPONSE_PERCENT: 20,
      TIMING_TOLERANCE_MS: 50,
      ACTIVE_DURATION_TOLERANCE_MS: 1_000,
      OPERATORS: ['+', '-', '×', '÷'],
      limits: { maxTrials: 400, minActiveMs: 0, maxActiveMs: 91_000, minPlausibleRtMs: 250 },
    });
  });

  it('keeps the trial and metrics schema bounds', () => {
    const baseTrial = {
      level: 1, operands: [7, 5], operators: ['+'], grouped: false, expected: 12, response: 12,
      correct: true, timedOut: false, shownAtMs: 0, rtMs: 1_000, timeLimitMs: 8_000,
    };
    const baseMetrics = {
      correct: 0, attempted: 0, timedOut: 0, longestStreak: 0, finalLevel: 1, difficultyPoints: 0, speedBonusPoints: 0,
    };
    const accepted = (schema: typeof mm.trialSchema | typeof mm.metricsSchema, base: object, cases: Record<string, readonly unknown[]>) =>
      Object.fromEntries(Object.entries(cases).map(([field, values]) => [
        field,
        values.map((value) => {
          const candidate = field === 'operand' ? { ...base, operands: [value, 5] } : { ...base, [field]: value };
          return schema.safeParse(candidate).success;
        }),
      ]));

    expect(accepted(mm.trialSchema, baseTrial, {
      level: [0, 1, 10, 11, 1.5],
      operand: [0, 1, 9_999, 10_000, 2.5],
      expected: [0, 1, 999_999, 1_000_000, 1.5],
      response: [-1, 0, 999_999, 1_000_000, 1.5, null],
      shownAtMs: [-1, 0, 3_600_000, 3_600_001, 0.5],
      rtMs: [-1, 0, 60_000, 60_001, 0.5],
      timeLimitMs: [0, 1, 60_000, 60_001, 0.5],
    })).toEqual({
      level: [false, true, true, false, false],
      operand: [false, true, true, false, false],
      expected: [false, true, true, false, false],
      response: [false, true, true, false, false, true],
      shownAtMs: [false, true, true, false, false],
      rtMs: [false, true, true, false, false],
      timeLimitMs: [false, true, true, false, false],
    });
    expect(accepted(mm.metricsSchema, baseMetrics, {
      correct: [-1, 0, 400, 401],
      attempted: [-1, 0, 400, 401],
      timedOut: [-1, 0, 400, 401],
      longestStreak: [-1, 0, 400, 401],
      finalLevel: [0, 1, 10, 11],
      difficultyPoints: [-1, 0, 110_000, 110_001],
      speedBonusPoints: [-1, 0, 110_000, 110_001],
    })).toEqual({
      correct: [false, true, true, false],
      attempted: [false, true, true, false],
      timedOut: [false, true, true, false],
      longestStreak: [false, true, true, false],
      finalLevel: [false, true, true, false],
      difficultyPoints: [false, true, true, false],
      speedBonusPoints: [false, true, true, false],
    });
  });

  it('keeps the questions of seed 42, positions 0-4, at every level', () => {
    const questions = mm.LEVELS.map(({ level }) => [0, 1, 2, 3, 4].map((position) => render(mm.questionAt(42, position, 0, level))));

    expect(questions).toEqual([
      ['9 + 10 = 19', '7 - 6 = 1', '8 - 4 = 4', '7 + 8 = 15', '6 + 10 = 16'],
      ['6 + 64 = 70', '97 - 3 = 94', '20 - 3 = 17', '57 + 8 = 65', '86 + 4 = 90'],
      ['65 + 65 = 130', '40 - 35 = 5', '97 - 39 = 58', '58 + 87 = 145', '88 + 35 = 123'],
      ['6 × 6 = 36', '40 - 35 = 5', '97 - 39 = 58', '6 × 8 = 48', '8 × 4 = 32'],
      ['36 ÷ 6 = 6', '4 × 12 = 48', '3 × 3 = 9', '48 ÷ 6 = 8', '32 ÷ 8 = 4'],
      ['120 ÷ 6 = 20', '977 - 26 = 951', '191 - 25 = 166', '58 × 8 = 464', '88 × 4 = 352'],
      ['6 × 6 + 5 = 41', '3 × 9 = 27', '3 × 3 = 9', '(6 + 8) × 4 = 56', '(8 + 4) × 8 = 96'],
      ['(64 + 68) ÷ 6 = 22', '99 ÷ 3 = 33', '26 × 3 = 78', '(74 - 57) × 4 = 68', '(93 - 86) × 8 = 56'],
      ['65 × 6 - 52 = 338', '498 - 26 = 472', '168 + 24 = 192', '58 × 8 + 19 = 483', '88 × 4 + 84 = 436'],
      ['66 × 6 - 52 = 344', '977 - 26 = 951', '254 + 24 = 278', '59 × 8 + 40 = 512', '88 × 4 + 84 = 436'],
    ]);
  });

  it('keeps the variants that replace discarded questions', () => {
    expect([0, 1, 2, 3].map((variant) => render(mm.questionAt(0xdead_beef, 0, variant, 7))))
      .toEqual(['(9 + 8) × 4 = 68', '8 + 6 - 9 = 5', '7 × 8 + 3 = 59', '8 + 8 - 2 = 14']);
  });

  it('keeps 24,000 questions: 3 seeds × 10 levels × 50 positions × 16 variants', () => {
    const lines: string[] = [];
    for (const seed of [0, 42, 0xffff_ffff]) {
      for (const { level } of mm.LEVELS) {
        for (let position = 0; position < 50; position += 1) {
          for (let variant = 0; variant < mm.QUESTION_VARIANTS; variant += 1) {
            const question = mm.questionAt(seed, position, variant, level);
            lines.push(`${mm.formatQuestion(question)}=${question.expected}`);
          }
        }
      }
    }
    expect(lines).toHaveLength(24_000);
    expect(fnv1a(lines.join('\n'))).toBe('01f26ab2');
  });

  it('keeps a scripted run: its trials and its score', () => {
    const { run } = play(20_260_930, 1, [
      correct(1_500), correct(2_200), pause(400), correct(1_800), correct(3_300), wrong(2_500), correct(900),
      timeout(), correct(4_100), correct(2_000), correct(2_600), pause(50), correct(3_000), wrong(5_000), correct(1_200),
    ]);

    expect(run.trials.map((trial) => `${trial.level}: ${mm.formatQuestion(trial)} = ${trial.expected} -> ${trial.response} @${trial.shownAtMs}+${trial.rtMs}`))
      .toEqual([
        '1: 16 - 12 = 4 -> 4 @0+1500',
        '1: 16 - 11 = 5 -> 5 @1500+2200',
        '1: 6 - 2 = 4 -> 4 @4100+1800',
        '2: 19 - 5 = 14 -> 14 @5900+3300',
        '2: 54 + 3 = 57 -> 58 @9200+2500',
        '1: 9 - 8 = 1 -> 1 @11700+900',
        '1: 2 + 1 = 3 -> null @12600+8000',
        '1: 19 - 14 = 5 -> 5 @20600+4100',
        '1: 3 + 15 = 18 -> 18 @24700+2000',
        '1: 4 + 9 = 13 -> 13 @26700+2600',
        '2: 54 + 8 = 62 -> 62 @29350+3000',
        '2: 87 - 5 = 82 -> 83 @32350+5000',
        '1: 15 - 10 = 5 -> 5 @37350+1200',
      ]);
    expect(fnv1a(JSON.stringify(run.trials))).toBe('37fcd85c');
    // 70 + 68 + 69 + 97 + 0 + 72 + 0 + 62 + 69 + 67 + 98 + 0 + 71
    expect(mm.score(run.trials, { modeId: mm.MODE_ID, startLevel: 1 })).toEqual({
      score: 743,
      accuracy: 10 / 13,
      responseTime: { medianMs: 2_500, meanMs: 38_100 / 13, p90Ms: 5_000 },
      peakLevel: 2,
      metrics: {
        correct: 10,
        attempted: 13,
        timedOut: 1,
        longestStreak: 4,
        finalLevel: 1,
        difficultyPoints: 550,
        speedBonusPoints: 193,
      },
    });
  });
});
