import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  applySession,
  canApplyToProgress,
  defineGame,
  readGameProgress,
  readGameSession,
  rebuildProgress,
  unlockedStartLevel,
  validOutcome,
  type GameDefinition,
  type GameProgress,
  type ProgressSession,
  type ServerResult,
  type SessionOutcome,
  type StoredGameSession,
} from '@nfct/shared';
import {
  at,
  endless,
  fixtureGame,
  levels,
  progressSession,
  scored,
  sessionId,
  TestTimestamp,
  unprocessedSession,
  type FixtureMetrics,
} from './fixtures';

type FixtureDefinition = GameDefinition<{ level: number; correct: boolean; rtMs: number }, FixtureMetrics>;
type StepResult = 'invalid' | 'flagged' | { score: number; correct?: number; peakLevel?: number };

interface Step {
  id: number;
  session?: Partial<ProgressSession>;
  result: StepResult;
}

const v2Game = defineGame({ ...fixtureGame, gameVersion: 2 });

function sessionOf({ id, session = {} }: Step): ProgressSession {
  return progressSession({ endedAt: at(id), ...session });
}

function outcomeOf(step: Step, definition: FixtureDefinition): SessionOutcome {
  if (step.result === 'invalid' || step.result === 'flagged') return { validity: step.result };
  const { modeId, startLevel } = sessionOf(step);
  const { score, correct, peakLevel = startLevel } = step.result;
  return validOutcome(definition, { modeId, startLevel }, scored(score, { correct, peakLevel }));
}

function apply(progress: GameProgress | null, step: Step, definition: FixtureDefinition = fixtureGame) {
  return applySession(progress, {
    definition,
    sessionId: sessionId(step.id),
    session: sessionOf(step),
    outcome: outcomeOf(step, definition),
    appliedAt: at(step.id + 0.5),
  });
}

function replay(steps: readonly Step[], from: GameProgress | null = null, definition?: FixtureDefinition) {
  return steps.reduce<GameProgress | null>((progress, step) => apply(progress, step, definition), from);
}

/** Progress without its write time, to compare aggregates reached at different moments. */
function content(progress: GameProgress | null) {
  if (progress === null) return null;
  const { updatedAt: _updatedAt, ...rest } = progress;
  return rest;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function buildHistory(): Step[] {
  return [
    { id: 1, session: { startLevel: 1 }, result: { score: 300, correct: 14, peakLevel: 4 } },
    { id: 2, session: { startLevel: 3 }, result: { score: 250, correct: 9, peakLevel: 5 } },
    { id: 3, session: { startLevel: 1 }, result: { score: 280, correct: 16, peakLevel: 3 } },
    { id: 4, session: { startLevel: 3 }, result: 'flagged' },
    { id: 5, session: { startLevel: 2, status: 'abandoned', activeDurationMs: 5_000 }, result: { score: 40, correct: 1 } },
    { id: 6, session: { startLevel: 1 }, result: 'invalid' },
  ];
}

describe('applySession', () => {
  afterEach(() => vi.useRealTimers());

  it('creates progress from the first valid session', () => {
    const progress = apply(null, { id: 1, session: { startLevel: 1 }, result: { score: 300, correct: 14, peakLevel: 4 } });

    expect(progress).toEqual({
      schemaVersion: 1,
      aggregateVersion: 1,
      updatedAt: at(1.5),
      gameId: 'fixture-game',
      gameVersion: 1,
      sessionsCompleted: 1,
      activeMs: 60_000,
      lastPlayedAt: at(1),
      bestPeakLevel: { endless: 4 },
      unlocked: { endless: 3 },
      bests: {
        'endless:1': {
          score: { value: 300, sessionId: sessionId(1), achievedAt: at(1) },
          correct: { value: 14, sessionId: sessionId(1), achievedAt: at(1) },
          peakLevel: { value: 4, sessionId: sessionId(1), achievedAt: at(1) },
        },
      },
      bestsArchive: {},
    });
    expect(readGameProgress(progress)).toEqual(progress);
  });

  it('keeps bests separate for each record key', () => {
    const progress = replay([
      { id: 1, session: { startLevel: 1 }, result: { score: 300, correct: 14, peakLevel: 4 } },
      { id: 2, session: { startLevel: 3 }, result: { score: 250, correct: 9, peakLevel: 5 } },
      { id: 3, session: { startLevel: 1 }, result: { score: 280, correct: 16, peakLevel: 3 } },
      { id: 4, session: { startLevel: 3 }, result: { score: 400, correct: 8, peakLevel: 6 } },
    ])!;

    expect(Object.keys(progress.bests).sort()).toEqual(['endless:1', 'endless:3']);
    expect(progress.bests['endless:1']).toEqual({
      score: { value: 300, sessionId: sessionId(1), achievedAt: at(1) },
      correct: { value: 16, sessionId: sessionId(3), achievedAt: at(3) },
      peakLevel: { value: 4, sessionId: sessionId(1), achievedAt: at(1) },
    });
    expect(progress.bests['endless:3']).toEqual({
      score: { value: 400, sessionId: sessionId(4), achievedAt: at(4) },
      correct: { value: 9, sessionId: sessionId(2), achievedAt: at(2) },
      peakLevel: { value: 6, sessionId: sessionId(4), achievedAt: at(4) },
    });
  });

  it('takes the best peak level across every start level', () => {
    const progress = replay([
      { id: 1, session: { startLevel: 1 }, result: { score: 300, peakLevel: 4 } },
      { id: 2, session: { startLevel: 3 }, result: { score: 250, peakLevel: 6 } },
      { id: 3, session: { startLevel: 5 }, result: { score: 100, peakLevel: 5 } },
    ])!;

    expect(progress.bestPeakLevel).toEqual({ endless: 6 });
    expect(progress.unlocked).toEqual({ endless: 5 });
    expect(unlockedStartLevel(endless, progress)).toBe(5);
  });

  it('lets a valid completed session set records and unlocks', () => {
    const before = replay([{ id: 1, result: { score: 50, correct: 3, peakLevel: 2 } }])!;
    const after = apply(before, { id: 2, session: { startLevel: 1 }, result: { score: 900, correct: 30, peakLevel: 7 } })!;

    expect(after.bests['endless:1']?.score).toEqual({ value: 900, sessionId: sessionId(2), achievedAt: at(2) });
    expect(after.bestPeakLevel).toEqual({ endless: 7 });
    expect(after.unlocked).toEqual({ endless: 6 });
  });

  describe('trusted peak level', () => {
    it('ignores a client-claimed peak: only the peak replayed from the trials counts', () => {
      // The client claims level 8, but its trials never go past level 2.
      const trials = [{ level: 1, correct: true, rtMs: 900 }, { level: 2, correct: false, rtMs: 1_100 }];
      const session = readGameSession({ ...unprocessedSession(), startLevel: 1, peakLevel: 8, trials });
      const trusted = fixtureGame.score(trials, { modeId: session.modeId, startLevel: session.startLevel });
      const progress = applySession(null, {
        definition: fixtureGame,
        sessionId: sessionId(1),
        session,
        outcome: validOutcome(fixtureGame, session, trusted),
        appliedAt: at(3),
      })!;

      expect(session.peakLevel).toBe(8);
      expect(trusted.peakLevel).toBe(2);
      expect(progress.bestPeakLevel).toEqual({ endless: 2 });
      expect(progress.bests['endless:1']?.peakLevel?.value).toBe(2);
      expect(unlockedStartLevel(endless, progress)).toBe(1);
    });

    it('refuses a trusted peak outside the mode', () => {
      expect(() => apply(null, { id: 1, session: { startLevel: 1 }, result: { score: 1, peakLevel: 9 } }))
        .toThrow(/peak level 9/);
      expect(() => apply(null, { id: 1, session: { startLevel: 3 }, result: { score: 1, peakLevel: 2 } }))
        .toThrow(/peak level 2/);
    });
  });

  it('counts a flagged session in totals without setting records or unlocks', () => {
    const before = replay([{ id: 1, result: { score: 50, correct: 3, peakLevel: 2 } }])!;
    const after = apply(before, { id: 2, result: 'flagged' })!;

    expect(after.bests).toEqual(before.bests);
    expect(after.bestPeakLevel).toEqual(before.bestPeakLevel);
    expect(after.unlocked).toEqual(before.unlocked);
    expect(after.sessionsCompleted).toBe(2);
    expect(after.activeMs).toBe(120_000);
    expect(after.lastPlayedAt).toEqual(at(2));
  });

  it('creates progress with totals only from a first flagged session', () => {
    const progress = apply(null, { id: 1, result: 'flagged' })!;

    expect(progress.sessionsCompleted).toBe(1);
    expect(progress.bests).toEqual({});
    expect(progress.bestPeakLevel).toEqual({});
    expect(progress.unlocked).toEqual({});
    expect(unlockedStartLevel(endless, progress)).toBe(1);
  });

  it('counts an invalid session nowhere', () => {
    const before = replay([{ id: 1, result: { score: 50, correct: 3, peakLevel: 2 } }])!;

    expect(apply(before, { id: 2, result: 'invalid' })).toBe(before);
    expect(apply(null, { id: 2, result: 'invalid' })).toBeNull();
  });

  it('adds an abandoned session\'s active time without counting it as completed or setting records', () => {
    const before = replay([{ id: 1, result: { score: 50, correct: 3, peakLevel: 2 } }])!;
    const after = apply(before, {
      id: 2,
      session: { status: 'abandoned', activeDurationMs: 5_000 },
      result: { score: 900, correct: 30, peakLevel: 7 },
    })!;

    expect(after.sessionsCompleted).toBe(1);
    expect(after.activeMs).toBe(65_000);
    expect(after.bests).toEqual(before.bests);
    expect(after.bestPeakLevel).toEqual(before.bestPeakLevel);
  });

  describe('record ties', () => {
    const tied: Step[] = [
      { id: 7, session: { endedAt: at(10) }, result: { score: 100, correct: 5, peakLevel: 3 } },
      { id: 3, session: { endedAt: at(10) }, result: { score: 100, correct: 5, peakLevel: 3 } },
      { id: 5, session: { endedAt: at(12) }, result: { score: 100, correct: 5, peakLevel: 3 } },
    ];

    it('gives an equal record to the earliest achievement, then the lowest session ID, in any order', () => {
      const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]].map((order) => order.map((index) => tied[index]!));
      const results = orders.map((steps) => content(replay(steps)));

      for (const result of results) expect(result).toEqual(results[0]);
      expect(results[0]?.bests['endless:1']?.score).toEqual({ value: 100, sessionId: sessionId(3), achievedAt: at(10) });
    });
  });

  describe('game version transitions', () => {
    it('archives the current record set when a newer version is played', () => {
      const v1 = replay([{ id: 1, result: { score: 300, correct: 14, peakLevel: 4 } }])!;
      const progress = apply(v1, { id: 2, session: { gameVersion: 2 }, result: { score: 100, correct: 4 } }, v2Game)!;

      expect(progress.gameVersion).toBe(2);
      expect(progress.bestsArchive).toEqual({ 1: v1.bests });
      expect(progress.bests['endless:1']?.score?.value).toBe(100);
    });

    it('files a late session of an earlier version in that version\'s archived set', () => {
      const v2 = replay([
        { id: 1, result: { score: 300, correct: 14, peakLevel: 4 } },
        { id: 2, session: { gameVersion: 2 }, result: { score: 100, correct: 4 } },
      ], null, v2Game)!;
      const progress = apply(v2, { id: 3, session: { gameVersion: 1 }, result: { score: 500, correct: 20, peakLevel: 5 } }, v2Game)!;

      expect(progress.bests).toEqual(v2.bests);
      expect(progress.bestsArchive['1']?.['endless:1']?.score).toEqual({ value: 500, sessionId: sessionId(3), achievedAt: at(3) });
      expect(progress.sessionsCompleted).toBe(3);
    });

    it('keeps earned unlocks across a version bump', () => {
      const v1 = replay([{ id: 1, result: { score: 300, peakLevel: 6 } }])!;
      const progress = apply(v1, { id: 2, session: { gameVersion: 2 }, result: { score: 10, peakLevel: 1 } }, v2Game)!;

      expect(progress.bestPeakLevel).toEqual({ endless: 6 });
      expect(unlockedStartLevel(v2Game.modes[0]!, progress)).toBe(5);
    });

    it('clamps earned unlocks to the new version\'s levels', () => {
      const shorter = defineGame({
        ...fixtureGame,
        gameVersion: 2,
        modes: [{ ...endless, levels: levels(5) }, fixtureGame.modes[1]!],
      });
      const v1 = replay([{ id: 1, result: { score: 300, peakLevel: 7 } }])!;

      expect(unlockedStartLevel(endless, v1)).toBe(6);
      expect(unlockedStartLevel(shorter.modes[0]!, v1)).toBe(5);
    });
  });

  describe('rebuild', () => {
    const processedAt = at(100);

    function resultFor(step: Step, definition: FixtureDefinition): ServerResult {
      const outcome = outcomeOf(step, definition);
      if (outcome.validity === 'invalid') {
        return { processedAt, scoringVersion: 1, validity: 'invalid', reasons: ['schema-invalid'] };
      }
      const trusted = {
        processedAt,
        scoringVersion: 1,
        score: 0,
        accuracy: null,
        responseTime: null,
        peakLevel: sessionOf(step).startLevel,
        metrics: {},
        performanceIndex: null,
        performanceIndexVersion: null,
        domainContributions: fixtureGame.domainWeights,
      };
      if (outcome.validity === 'flagged') return { ...trusted, validity: 'flagged', reasons: ['rt-below-floor'] };
      return {
        ...trusted,
        validity: 'valid',
        reasons: [],
        peakLevel: outcome.peakLevel,
        recordKey: outcome.recordKey,
        recordValues: { ...outcome.recordValues },
        personalBest: false,
        unlocked: [],
      };
    }

    function stored(step: Step, definition: FixtureDefinition, processed = true): StoredGameSession {
      const { gameVersion, modeId, startLevel, status, activeDurationMs, endedAt } = sessionOf(step);
      const startedAt = new TestTimestamp(endedAt.seconds - 30);
      const raw = { ...unprocessedSession(), gameVersion, modeId, startLevel, peakLevel: startLevel, status, activeDurationMs, startedAt, endedAt };
      return {
        id: sessionId(step.id),
        session: readGameSession(processed ? { ...raw, result: resultFor(step, definition) } : raw),
      };
    }

    // Processed live: v1 sessions under v1, then v2 under v2. Session 5 is a
    // v1 session played before session 4 but delivered after it.
    const live: [Step, FixtureDefinition][] = [
      [{ id: 1, result: { score: 300, correct: 14, peakLevel: 6 } }, fixtureGame],
      [{ id: 2, session: { startLevel: 3 }, result: { score: 250, correct: 9, peakLevel: 5 } }, fixtureGame],
      [{ id: 3, result: 'flagged' }, fixtureGame],
      [{ id: 5, session: { gameVersion: 2, endedAt: at(4.5) }, result: { score: 90, correct: 4, peakLevel: 2 } }, v2Game],
      [{ id: 4, result: { score: 350, correct: 12, peakLevel: 4 } }, v2Game],
      [{ id: 6, session: { gameVersion: 2 }, result: 'invalid' }, v2Game],
    ];

    it('replays stored results to the same progress as live processing', () => {
      const liveProgress = live.reduce<GameProgress | null>((progress, [step, definition]) => apply(progress, step, definition), null);
      const rebuilt = rebuildProgress(v2Game, live.map(([step, definition]) => stored(step, definition)), at(200));

      expect(content(rebuilt)).toEqual(content(liveProgress));
      expect(rebuilt?.bestsArchive['1']?.['endless:1']?.score?.value).toBe(350);
      expect(rebuilt?.bests['endless:1']?.score?.value).toBe(90);
      expect(unlockedStartLevel(v2Game.modes[0]!, rebuilt)).toBe(5);
    });

    it('never revalidates or rescores old sessions with the current definition', () => {
      const v3 = defineGame({
        ...fixtureGame,
        gameVersion: 3,
        trialSchema: z.strictObject({ level: z.int(), correct: z.boolean(), rtMs: z.int(), hint: z.string() }),
        recordKey: ({ modeId, startLevel }) => `v3:${modeId}:${startLevel}`,
        recordMetrics: ['score'],
        score: () => { throw new Error('rebuild must not rescore'); },
      });
      const rebuilt = rebuildProgress(v3, live.map(([step, definition]) => stored(step, definition)), at(200))!;

      expect(Object.keys(rebuilt.bestsArchive['1'] ?? {}).sort()).toEqual(['endless:1', 'endless:3']);
      expect(rebuilt.bestsArchive['1']?.['endless:1']?.correct?.value).toBe(14);
    });

    it('skips sessions that have not been processed yet', () => {
      const sessions = [stored(live[0]![0], fixtureGame), stored({ id: 9, result: { score: 999, peakLevel: 8 } }, fixtureGame, false)];
      const rebuilt = rebuildProgress(fixtureGame, sessions, at(200))!;

      expect(rebuilt.sessionsCompleted).toBe(1);
      expect(rebuilt.bestPeakLevel).toEqual({ endless: 6 });
    });
  });

  it('is deterministic: the same history gives the same progress, whatever the clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = replay(buildHistory());
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'));
    const second = replay(buildHistory());

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('never mutates the progress or session it is given', () => {
    const midway = replay(buildHistory().slice(0, 3))!;
    const snapshot = JSON.stringify(midway);
    const rest = deepFreeze(buildHistory().slice(3));

    const frozen = replay(rest, deepFreeze(midway));

    expect(JSON.stringify(midway)).toBe(snapshot);
    expect(frozen).toEqual(replay(buildHistory()));
  });

  it('re-applies additive totals when the same session is applied twice, so callers must apply exactly once', () => {
    const step: Step = { id: 1, session: { activeDurationMs: 60_000 }, result: { score: 300, correct: 14, peakLevel: 4 } };
    const once = apply(null, step)!;
    const twice = apply(once, step)!;

    expect(twice.sessionsCompleted).toBe(2);
    expect(twice.activeMs).toBe(120_000);
    // Max-based fields are unchanged by the repeat; only the totals double.
    expect(twice.bests).toEqual(once.bests);
    expect(twice.bestPeakLevel).toEqual(once.bestPeakLevel);
    expect(twice.unlocked).toEqual(once.unlocked);
    expect(twice.lastPlayedAt).toEqual(once.lastPlayedAt);
  });

  it('declines progress maintained by another reducer or a newer game version', () => {
    const progress = replay([{ id: 1, result: { score: 10, peakLevel: 2 } }])!;
    const step: Step = { id: 2, result: { score: 20, peakLevel: 3 } };

    for (const other of [{ ...progress, aggregateVersion: 2 }, { ...progress, gameVersion: 3 }]) {
      expect(canApplyToProgress(other, fixtureGame)).toBe(false);
      expect(() => apply(other, step)).toThrow(/rebuild it from sessions/);
    }
    expect(canApplyToProgress(progress, fixtureGame)).toBe(true);
    expect(canApplyToProgress(null, fixtureGame)).toBe(true);
  });

  it('refuses a session that does not belong to the game', () => {
    const result = { score: 1 };
    expect(() => apply(null, { id: 1, session: { gameId: 'other-game' }, result })).toThrow(/other-game/);
    expect(() => apply(null, { id: 1, session: { modeId: 'blitz' }, result })).toThrow(/unknown mode/);
    expect(() => apply(null, { id: 1, session: { gameVersion: 2 }, result })).toThrow(/game version/);
  });
});
