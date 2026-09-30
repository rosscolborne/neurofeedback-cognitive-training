import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPLIED_SESSION_LEDGER_SIZE,
  applySession,
  defineGame,
  readGameProgress,
  unlockedStartLevel,
  type GameProgress,
  type ProgressSession,
  type SessionOutcome,
} from '@nfct/shared';
import {
  at,
  endless,
  fixtureGame,
  flagged,
  invalid,
  progressSession,
  sessionId,
  valid,
  type FixtureMetrics,
} from './fixtures';

interface Step {
  id: number;
  session?: Partial<ProgressSession>;
  outcome: SessionOutcome<FixtureMetrics>;
}

function apply(progress: GameProgress | null, { id, session = {}, outcome }: Step, definition = fixtureGame) {
  return applySession(progress, {
    definition,
    sessionId: sessionId(id),
    session: progressSession({ endedAt: at(id), ...session }),
    outcome,
    appliedAt: at(id + 0.5),
  });
}

function replay(steps: readonly Step[], from: GameProgress | null = null): GameProgress | null {
  return steps.reduce<GameProgress | null>((progress, step) => apply(progress, step), from);
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
    { id: 1, session: { startLevel: 1, peakLevel: 4 }, outcome: valid(300, 14) },
    { id: 2, session: { startLevel: 3, peakLevel: 5 }, outcome: valid(250, 9) },
    { id: 3, session: { startLevel: 1, peakLevel: 3 }, outcome: valid(280, 16) },
    { id: 4, session: { startLevel: 3, peakLevel: 8 }, outcome: flagged },
    { id: 5, session: { startLevel: 2, peakLevel: 2, status: 'abandoned', activeDurationMs: 5_000 }, outcome: valid(40, 1) },
    { id: 6, session: { startLevel: 1, peakLevel: 1 }, outcome: invalid },
  ];
}
const history = buildHistory();

describe('applySession', () => {
  afterEach(() => vi.useRealTimers());

  it('creates progress from the first valid session', () => {
    const progress = apply(null, { id: 1, session: { startLevel: 1, peakLevel: 4 }, outcome: valid(300, 14) });

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
      appliedSessionIds: [sessionId(1)],
    });
    expect(readGameProgress(progress)).toEqual(progress);
  });

  it('keeps bests separate for each record key', () => {
    const progress = replay([
      { id: 1, session: { startLevel: 1, peakLevel: 4 }, outcome: valid(300, 14) },
      { id: 2, session: { startLevel: 3, peakLevel: 5 }, outcome: valid(250, 9) },
      { id: 3, session: { startLevel: 1, peakLevel: 3 }, outcome: valid(280, 16) },
      { id: 4, session: { startLevel: 3, peakLevel: 6 }, outcome: valid(400, 8) },
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

  it('keeps the earlier record on a tie', () => {
    const progress = replay([
      { id: 1, outcome: valid(100, 5) },
      { id: 2, outcome: valid(100, 5) },
    ])!;

    expect(progress.bests['endless:1']?.score?.sessionId).toBe(sessionId(1));
  });

  it('takes the best peak level across every start level', () => {
    const progress = replay([
      { id: 1, session: { startLevel: 1, peakLevel: 4 }, outcome: valid(300) },
      { id: 2, session: { startLevel: 3, peakLevel: 6 }, outcome: valid(250) },
      { id: 3, session: { startLevel: 5, peakLevel: 5 }, outcome: valid(100) },
    ])!;

    expect(progress.bestPeakLevel).toEqual({ endless: 6 });
    expect(progress.unlocked).toEqual({ endless: 5 });
    expect(unlockedStartLevel(endless, progress)).toBe(5);
  });

  it('lets a valid completed session set records and unlocks', () => {
    const before = replay([{ id: 1, session: { peakLevel: 2 }, outcome: valid(50, 3) }])!;
    const after = apply(before, { id: 2, session: { startLevel: 1, peakLevel: 7 }, outcome: valid(900, 30) })!;

    expect(after.bests['endless:1']?.score).toEqual({ value: 900, sessionId: sessionId(2), achievedAt: at(2) });
    expect(after.bestPeakLevel).toEqual({ endless: 7 });
    expect(after.unlocked).toEqual({ endless: 6 });
  });

  it('counts a flagged session in totals without setting records or unlocks', () => {
    const before = replay([{ id: 1, session: { peakLevel: 2 }, outcome: valid(50, 3) }])!;
    const after = apply(before, { id: 2, session: { startLevel: 1, peakLevel: 8 }, outcome: flagged })!;

    expect(after.bests).toEqual(before.bests);
    expect(after.bestPeakLevel).toEqual(before.bestPeakLevel);
    expect(after.unlocked).toEqual(before.unlocked);
    expect(after.sessionsCompleted).toBe(2);
    expect(after.activeMs).toBe(120_000);
    expect(after.lastPlayedAt).toEqual(at(2));
    expect(after.appliedSessionIds).toEqual([sessionId(1), sessionId(2)]);
  });

  it('creates progress with totals only from a first flagged session', () => {
    const progress = apply(null, { id: 1, session: { peakLevel: 8 }, outcome: flagged })!;

    expect(progress.sessionsCompleted).toBe(1);
    expect(progress.bests).toEqual({});
    expect(progress.bestPeakLevel).toEqual({});
    expect(progress.unlocked).toEqual({});
    expect(unlockedStartLevel(endless, progress)).toBe(1);
  });

  it('counts an invalid session nowhere', () => {
    const before = replay([{ id: 1, session: { peakLevel: 2 }, outcome: valid(50, 3) }])!;

    expect(apply(before, { id: 2, session: { peakLevel: 8 }, outcome: invalid })).toBe(before);
    expect(apply(null, { id: 2, session: { peakLevel: 8 }, outcome: invalid })).toBeNull();
  });

  it('adds an abandoned session\'s active time without counting it as completed or setting records', () => {
    const before = replay([{ id: 1, session: { peakLevel: 2 }, outcome: valid(50, 3) }])!;
    const after = apply(before, {
      id: 2,
      session: { peakLevel: 7, status: 'abandoned', activeDurationMs: 5_000 },
      outcome: valid(900, 30),
    })!;

    expect(after.sessionsCompleted).toBe(1);
    expect(after.activeMs).toBe(65_000);
    expect(after.bests).toEqual(before.bests);
    expect(after.bestPeakLevel).toEqual(before.bestPeakLevel);
  });

  it('sets no records from a session of an earlier game version', () => {
    const v2 = defineGame({ ...fixtureGame, gameVersion: 2 });
    const progress = applySession(null, {
      definition: v2,
      sessionId: sessionId(1),
      session: progressSession({ gameVersion: 1, peakLevel: 6 }),
      outcome: valid(500, 20),
      appliedAt: at(1),
    })!;

    expect(progress.sessionsCompleted).toBe(1);
    expect(progress.bests).toEqual({});
    expect(progress.bestPeakLevel).toEqual({});
  });

  it('archives the previous record set when the game version changes', () => {
    const v1 = replay([{ id: 1, outcome: valid(300, 14) }])!;
    const v2 = defineGame({ ...fixtureGame, gameVersion: 2 });
    const progress = applySession(v1, {
      definition: v2,
      sessionId: sessionId(2),
      session: progressSession({ gameVersion: 2, endedAt: at(2) }),
      outcome: valid(100, 4),
      appliedAt: at(2),
    })!;

    expect(progress.gameVersion).toBe(2);
    expect(progress.bestsArchive).toEqual({ 1: v1.bests });
    expect(progress.bests['endless:1']?.score?.value).toBe(100);
  });

  it('is deterministic and never mutates its inputs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = replay(deepFreeze(buildHistory()));
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'));
    const midway = deepFreeze(replay(buildHistory().slice(0, 3)));
    const second = replay(buildHistory().slice(3), midway);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('is idempotent: re-applying a session changes nothing', () => {
    const once = replay(history)!;

    for (const step of history) {
      expect(apply(once, step)).toBe(once);
    }
    expect(replay([...history, ...history])).toEqual(once);
    expect(replay([history[0]!, history[0]!, history[1]!, history[0]!])).toEqual(replay(history.slice(0, 2)));
  });

  it('remembers only the most recent applied sessions', () => {
    const steps = Array.from({ length: APPLIED_SESSION_LEDGER_SIZE + 5 }, (_, index) => ({
      id: index + 1,
      outcome: valid(index),
    }));
    const progress = replay(steps)!;

    expect(progress.appliedSessionIds).toHaveLength(APPLIED_SESSION_LEDGER_SIZE);
    expect(progress.appliedSessionIds[0]).toBe(sessionId(6));
    expect(progress.appliedSessionIds.at(-1)).toBe(sessionId(APPLIED_SESSION_LEDGER_SIZE + 5));
    expect(progress.sessionsCompleted).toBe(APPLIED_SESSION_LEDGER_SIZE + 5);
  });

  it('refuses a session that does not belong to the game', () => {
    expect(() => apply(null, { id: 1, session: { gameId: 'other-game' }, outcome: valid(1) })).toThrow(/other-game/);
    expect(() => apply(null, { id: 1, session: { modeId: 'blitz' }, outcome: valid(1) })).toThrow(/unknown mode/);
    expect(() => apply(null, { id: 1, session: { gameVersion: 2 }, outcome: valid(1) })).toThrow(/game version/);
  });
});
