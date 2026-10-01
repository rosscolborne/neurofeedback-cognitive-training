import { describe, expect, it } from 'vitest';
import {
  applySession,
  gameSessionSchemaFor,
  mentalMath,
  mentalMathV1 as mm,
  readGameSessionFor,
  unlockedStartLevel,
  validOutcome,
} from '@nfct/shared';
import { at } from '../../../__tests__/fixtures';
import { correct, play, storedMentalMathSession, timeout, wrong } from './helpers';

const mode = mm.definition.modes[0]!;

describe('Mental Math v1 definition', () => {
  it('is the frozen gameVersion 1 / scoringVersion 1 catalogue entry', () => {
    expect(mm.definition).toMatchObject({
      id: 'mental-math',
      gameVersion: 1,
      scoringVersion: 1,
      domainWeights: { math: 0.7, 'processing-speed': 0.2, memory: 0.1 },
      limits: { maxTrials: 400, minActiveMs: 0, maxActiveMs: 91_000, minPlausibleRtMs: 250 },
      recordMetrics: ['score', 'correct', 'peakLevel'],
    });
    expect(mm.definition.domainWeights).not.toHaveProperty('reasoning');
    expect(mm.definition.performanceIndex).toBeUndefined();
    expect(mentalMath.definition).toBe(mm.definition); // the current version is v1
  });

  it('has one adaptive 90 s mode, timed-90, with levels 1-10 starting from level 1', () => {
    expect(mm.definition.modes).toHaveLength(1);
    expect(mode).toMatchObject({ id: 'timed-90', adaptive: true, runDurationMs: 90_000, initiallyUnlockedStartLevel: 1 });
    expect(mode.levels.map((level) => level.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(mode.levels.map((level) => (level.params as mm.LevelParams).timeLimitMs))
      .toEqual([8_000, 8_000, 10_000, 10_000, 10_000, 12_000, 14_000, 15_000, 16_000, 18_000]);
  });

  it('keys records by mode and start level, so different start levels never compete', () => {
    expect(mm.definition.recordKey({ modeId: 'timed-90', startLevel: 1 })).toBe('timed-90:1');
    expect(mm.definition.recordKey({ modeId: 'timed-90', startLevel: 10 })).toBe('timed-90:10');
  });

  it('keeps its level data immutable at runtime', () => {
    expect(Object.isFrozen(mm.LEVELS)).toBe(true);
    expect(Object.isFrozen(mm.LEVELS[6]!.templates[0]!.operands)).toBe(true);
  });
});

describe('timed-90 unlock policy (through the shared unlockedStartLevel)', () => {
  const unlocked = (bestPeakLevel: number | undefined) =>
    unlockedStartLevel(mode, bestPeakLevel === undefined ? null : { bestPeakLevel: { 'timed-90': bestPeakLevel } });

  it('opens only level 1 with no progress, or no entry for the mode', () => {
    expect(unlocked(undefined)).toBe(1);
    expect(unlockedStartLevel(mode, { bestPeakLevel: {} })).toBe(1);
    expect(unlockedStartLevel(mode, { bestPeakLevel: { endless: 9 } })).toBe(1);
  });

  it('unlocks up to bestPeakLevel - 1, and level 10 once it has actually been reached', () => {
    expect(unlocked(1)).toBe(1); // policy 0, clamped to the initial level
    expect(unlocked(2)).toBe(1);
    expect(unlocked(3)).toBe(2);
    expect(unlocked(9)).toBe(8);
    expect(unlocked(10)).toBe(10);
    expect(unlocked(12)).toBe(10); // a later version's higher peak still clamps to this mode
  });

  it('matches the ADR-001 formula for every peak', () => {
    for (let bestPeakLevel = 1; bestPeakLevel <= 50; bestPeakLevel += 1) {
      expect(mm.unlockPolicy({ bestPeakLevel, maxLevel: 10 })).toBe(bestPeakLevel >= 10 ? 10 : bestPeakLevel - 1);
    }
  });
});

describe('trusted peak level', () => {
  it('ignores a client peakLevel that disagrees with the trials', () => {
    const seed = 77;
    const { run } = play(seed, 2, [correct(), correct(), correct(), correct(), wrong(), timeout()]);
    const stored = { ...storedMentalMathSession(seed, run), peakLevel: 10 };
    const session = readGameSessionFor(mm.definition, stored);
    const scored = mm.definition.score(session.trials, session);

    expect(session.peakLevel).toBe(10);
    expect(scored.peakLevel).toBe(3);
    expect(mm.checkSession(session).reasons).toEqual(['peak-level-mismatch']);
    const progress = applySession(null, {
      definition: mm.definition,
      sessionId: 'session-00000001',
      session,
      outcome: validOutcome(mm.definition, session, scored),
      appliedAt: at(5),
    });
    expect(progress?.bestPeakLevel).toEqual({ 'timed-90': 3 });
    expect(progress?.unlocked).toEqual({ 'timed-90': 2 });
    expect(progress?.bests['timed-90:2']?.peakLevel?.value).toBe(3);
  });
});

describe('with the shared session schema', () => {
  it('accepts a session played by the run reducer, trials and metrics included', () => {
    const seed = 4_242;
    const { run } = play(seed, 1, [correct(), correct(), correct(), wrong(), timeout(), correct()]);
    const stored = storedMentalMathSession(seed, run);

    expect(gameSessionSchemaFor(mm.definition).parse(stored)).toEqual(stored);
  });

  it('rejects malformed trials and metrics as a schema failure', () => {
    const seed = 4_242;
    const { run } = play(seed, 1, [correct(), wrong()]);
    const stored = storedMentalMathSession(seed, run);
    const trial = run.trials[0]!;
    const schema = gameSessionSchemaFor(mm.definition);
    const withTrial = (change: Record<string, unknown>) => ({ ...stored, trials: [{ ...trial, ...change }] });

    for (const change of [
      { level: 11 },
      { level: 0 },
      { operands: [4] },
      { operands: [4, 5, 6, 7], operators: ['+', '+', '+'] },
      { operands: [0, 5] },
      { operators: ['+', '+'] }, // one too many for two operands
      { operators: ['−'] }, // U+2212 is not the stored minus
      { operators: ['x'] },
      { grouped: true }, // two operands cannot be grouped
      { expected: 0 },
      { response: -1 },
      { response: 1.5 },
      { rtMs: -1 },
      { shownAtMs: 1.5 },
      { hint: 'x' },
    ]) {
      expect(schema.safeParse(withTrial(change)).success).toBe(false);
    }
    expect(schema.safeParse({ ...stored, trials: Array.from({ length: 401 }, () => trial) }).success).toBe(false);
    const summary = stored.summary as { metrics: Record<string, unknown> };
    expect(schema.safeParse({ ...stored, summary: { ...summary, metrics: { ...summary.metrics, livesLost: 0 } } }).success).toBe(false);
    expect(schema.safeParse({ ...stored, summary: { ...summary, metrics: { ...summary.metrics, finalLevel: 11 } } }).success).toBe(false);
  });
});
