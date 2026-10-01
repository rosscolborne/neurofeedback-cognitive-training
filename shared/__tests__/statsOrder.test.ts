import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATALOGUE,
  applyCountedSession,
  applyValidUpgrade,
  compareTimestamps,
  countsInStats,
  decideSession,
  evaluateSession,
  GAME_MODULE_REGISTRY,
  mentalMathV1 as mm,
  readSessionAggregateFields,
  rebuildStats,
  upgradeBlocker,
  upgradeScanLevels,
  upgradeSession,
  type DailyStats,
  type FirestoreTimestamp,
  type GameProgress,
  type ServerResult,
  type SessionEvaluation,
  type StatsSummary,
} from '@nfct/shared';
import { TestTimestamp } from './fixtures';
import { mentalMathSession } from './processingFixtures';

// Order independence of the stats (NFCT-13). Trusted scoring processes a
// user's sessions in whatever order they arrive, and upgrades a session
// flagged start-level-locked once progress unlocks its level. This drives the
// real pure decisions as the Cloud Function sequences them, with the stats
// reducers applied exactly where the function applies them (a processed
// session counted with its result; each upgrade's valid-only effects), over
// random sessions spread across days, in random orders. Whatever the order,
// the summary, the days and the achievements earned must be the same, and
// equal a rebuild from the stored final results.

const ts = (ms: number) => new TestTimestamp(Math.floor(ms / 1_000), (ms % 1_000) * 1_000_000);
const T0 = 1_790_000_000_000;
const DAY_MS = 86_400_000;
const UID = 'player-1';

function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    shuffle: <T>(items: readonly T[]) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
      }
      return copy;
    },
  };
}

type Doc = { readonly id: string; readonly raw: Record<string, unknown>; readonly evaluation: SessionEvaluation };

/** Sessions over about two weeks: valid, start-level-locked, too fast (flagged), abandoned, tampered (invalid) and uploaded days late. */
function randomSessions(random: ReturnType<typeof prng>): Doc[] {
  const count = random.int(4, 12);
  const slots = random.shuffle(Array.from({ length: 14 * 4 }, (_, index) => index)).slice(0, count);
  return slots.map((slot, index) => {
    const startLevel = random.next() < 0.5 ? 1 : random.int(2, 6);
    const kind = random.next();
    const endedAtMs = T0 + Math.floor(slot / 4) * DAY_MS + (slot % 4) * 3 * 60 * 60_000;
    const raw = mentalMathSession({
      uid: UID,
      seed: random.int(0, 0xffff_ffff),
      startLevel,
      targetPeak: random.int(startLevel, Math.min(10, startLevel + 5)),
      endedAtMs,
      status: kind < 0.1 ? 'abandoned' : 'completed',
      rtMs: kind >= 0.1 && kind < 0.2 ? 200 : 1_300,
      // Uploaded three days after it was played: 'local-date-mismatch', so it is no training day.
      createdAt: kind >= 0.3 && kind < 0.4 ? ts(endedAtMs + 3 * DAY_MS) : undefined,
    }, ts);
    const tampered = kind >= 0.2 && kind < 0.3 ? { ...raw, seed: ((raw.seed as number) + 1) >>> 0 } : raw;
    const id = `session-${String(index).padStart(8, '0')}`;
    return { id, raw: tampered, evaluation: evaluateSession(tampered, { uid: UID, sessionId: id }) };
  });
}

type Earned = { readonly achievementId: string; readonly sessionId: string };

/**
 * Processes every session in `order` as the Cloud Function does, with the
 * stats beside progress. `transactionBudget` bounds how many upgrades the
 * processing transaction makes; past it the post-commit reconcile (no budget)
 * finishes them in its own commits, each with its own stats update.
 */
function processInOrder(docs: readonly Doc[], order: readonly number[], transactionBudget = Infinity) {
  const results = new Map<string, ServerResult>();
  let progress: GameProgress | null = null;
  let summary: StatsSummary | null = null;
  const days = new Map<string, DailyStats>();
  const earned: Earned[] = [];
  const validWhenEarned: boolean[] = [];
  let clock = T0 + 30 * DAY_MS;
  const byId = [...docs].sort((a, b) => (a.id < b.id ? -1 : 1));
  const fieldsOf = (doc: Doc) => readSessionAggregateFields({ ...doc.raw, result: results.get(doc.id) });

  /** Upgrades to a fixpoint, at most `budget` sessions; each upgrade adds its valid-only effects to the stats. */
  const upgradePass = (budget: number, upgradedAt: TestTimestamp): boolean => {
    let scannedUpTo = upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, null).from - 1;
    let upgrades = 0;
    for (;;) {
      const { to } = upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, progress);
      if (to <= scannedUpTo) return true;
      const candidates = byId.filter((doc) => results.get(doc.id)?.validity === 'flagged'
        && (doc.raw.startLevel as number) > scannedUpTo && (doc.raw.startLevel as number) <= to
        && upgradeBlocker(fieldsOf(doc), progress, GAME_MODULE_REGISTRY) === null)
        .sort((a, b) => (a.raw.startLevel as number) - (b.raw.startLevel as number));
      scannedUpTo = to;
      for (const doc of candidates) {
        if (upgrades >= budget) return false;
        const fields = fieldsOf(doc);
        const upgraded = upgradeSession(fields, progress!, { sessionId: doc.id, upgradedAt, registry: GAME_MODULE_REGISTRY });
        if (upgraded === null) continue;
        results.set(doc.id, upgraded.result);
        progress = upgraded.progress;
        upgrades += 1;
        const update = applyValidUpgrade(summary!, { sessionId: doc.id, session: fields, result: upgraded.result, appliedAt: upgradedAt });
        summary = update.summary;
        earned.push(...update.earned);
        validWhenEarned.push(...update.earned.map(() => upgraded.result.validity === 'valid'));
      }
    }
  };

  for (const index of order) {
    const doc = docs[index]!;
    if (doc.evaluation.kind === 'unsupported') throw new Error('every generated session is supported');
    const processedAt = ts(clock += 1_000);
    const decision = decideSession(doc.evaluation, progress, { sessionId: doc.id, processedAt, registry: GAME_MODULE_REGISTRY });
    results.set(doc.id, decision.result);
    progress = decision.progress;
    // The processing commit: the session counted (invalid counts nowhere), then the upgrades it unlocks.
    if (countsInStats(decision.result)) {
      const fields = fieldsOf(doc);
      const update = applyCountedSession(summary, days.get(fields.localDate) ?? null, { sessionId: doc.id, session: fields, result: decision.result, appliedAt: processedAt });
      summary = update.summary;
      days.set(fields.localDate, update.day);
      earned.push(...update.earned);
      validWhenEarned.push(...update.earned.map(() => decision.result.validity === 'valid'));
    }
    if (!decision.unlockRaised) continue;
    if (!upgradePass(transactionBudget, processedAt)) upgradePass(Infinity, ts(clock += 1_000)); // the post-commit reconcile
  }
  return { results, summary, days, earned, validWhenEarned };
}

function summaryContent(summary: StatsSummary | null) {
  if (summary === null) return null;
  const { updatedAt: _updatedAt, achievements, ...rest } = summary;
  return { ...rest, achievements: [...achievements].sort() };
}

function daysContent(days: Iterable<DailyStats>) {
  return [...days].map(({ updatedAt: _updatedAt, ...rest }) => rest).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The stats from first principles, over the final results: an oracle that
 * shares no code with the reducers (no countsInStats, isTrainingDay, streak
 * runs or achievement criteria helpers), only the catalogue's thresholds.
 */
function oracle(docs: readonly Doc[], results: ReadonlyMap<string, ServerResult>) {
  const sessions = docs.flatMap((doc) => {
    const result = results.get(doc.id);
    if (result === undefined || result.validity === 'invalid') return [];
    return [{
      gameId: doc.raw.gameId as string,
      status: doc.raw.status as string,
      activeMs: doc.raw.activeDurationMs as number,
      endedAt: doc.raw.endedAt as FirestoreTimestamp,
      localDate: doc.raw.localDate as string,
      result,
    }];
  });
  if (sessions.length === 0) return { summary: null, days: [] };

  const tally = (group: typeof sessions) => ({
    sessions: group.length,
    sessionsCompleted: group.filter(({ status }) => status === 'completed').length,
    activeMs: group.reduce((sum, { activeMs }) => sum + activeMs, 0),
  });
  const dates = [...new Set(sessions.map(({ localDate }) => localDate))].sort();
  const days = dates.map((date) => {
    const onDay = sessions.filter(({ localDate }) => localDate === date);
    const games = [...new Set(onDay.map(({ gameId }) => gameId))];
    return { date, ...tally(onDay), games: Object.fromEntries(games.map((gameId) => [gameId, tally(onDay.filter((entry) => entry.gameId === gameId))])) };
  });

  const validRuns = sessions.filter(({ status, result }) => result.validity === 'valid' && status === 'completed');
  const bestPeakLevel: Record<string, number> = {};
  for (const { gameId, result } of validRuns) {
    if (result.validity === 'valid') bestPeakLevel[gameId] = Math.max(bestPeakLevel[gameId] ?? 0, result.peakLevel);
  }
  const unverified = ['local-date-mismatch', 'unknown-timezone', 'reasons-truncated'];
  const ordinal = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
  const trainingDays = [...new Set(validRuns.filter(({ result }) => !result.reasons.some((code) => unverified.includes(code))).map(({ localDate }) => localDate))]
    .sort();
  const runs: { start: string; end: string }[] = [];
  for (const date of trainingDays) {
    const last = runs.at(-1);
    if (last && ordinal(date) === ordinal(last.end) + 1) last.end = date;
    else runs.push({ start: date, end: date });
  }
  const length = ({ start, end }: { start: string; end: string }) => ordinal(end) - ordinal(start) + 1;
  const streak = {
    runs,
    current: runs.length > 0 ? length(runs.at(-1)!) : 0,
    longest: Math.max(0, ...runs.map(length)),
    lastActiveDate: runs.at(-1)?.end ?? null,
  };
  const lastPlayedAt = sessions.reduce((latest, { endedAt }) => (endedAt.toMillis() > latest.toMillis() ? endedAt : latest), sessions[0]!.endedAt);
  const achievements = ACHIEVEMENT_CATALOGUE.filter(({ criterion }) => (
    criterion.kind === 'valid-runs' ? validRuns.length >= criterion.atLeast
      : criterion.kind === 'streak' ? streak.longest >= criterion.days
        : (bestPeakLevel[criterion.gameId] ?? 0) >= criterion.atLeast
  )).map(({ id }) => id).sort();
  return {
    summary: { ...tally(sessions), lastPlayedAt, validRuns: validRuns.length, bestPeakLevel, streak, achievements },
    days,
  };
}

/** The oracle's view of reducer output: the same fields, achievements as a sorted set. */
function observed(summary: StatsSummary | null, days: Iterable<DailyStats>) {
  return {
    summary: summary === null ? null : {
      sessions: summary.sessions,
      sessionsCompleted: summary.sessionsCompleted,
      activeMs: summary.activeMs,
      lastPlayedAt: summary.lastPlayedAt,
      validRuns: summary.validRuns,
      bestPeakLevel: summary.bestPeakLevel,
      streak: summary.streak,
      achievements: [...summary.achievements].sort(),
    },
    days: [...days].sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(({ date, sessions, sessionsCompleted, activeMs, games }) => ({ date, sessions, sessionsCompleted, activeMs, games })),
  };
}

describe('order-independent stats', () => {
  it('converge to the same summary, days and achievements whatever order sessions are processed in, and equal a rebuild', () => {
    const random = prng(0x5747_0013);
    let upgradesSeen = 0;
    let achievementsSeen = 0;
    let unverifiedDates = 0;
    let streaksSeen = 0;
    for (let run = 0; run < 200; run += 1) {
      const docs = randomSessions(random);
      const playOrder = [...docs.keys()].sort((a, b) => compareTimestamps(
        docs[a]!.raw.endedAt as TestTimestamp, docs[b]!.raw.endedAt as TestTimestamp,
      ));
      const reference = processInOrder(docs, playOrder);
      const stored = docs.map((doc) => ({ id: doc.id, session: readSessionAggregateFields({ ...doc.raw, result: reference.results.get(doc.id) }) }));
      const rebuilt = rebuildStats(stored, ts(T0));

      expect(summaryContent(reference.summary), `run ${run}`).toEqual(summaryContent(rebuilt.summary));
      expect(daysContent(reference.days.values()), `run ${run}`).toEqual(daysContent(rebuilt.days));
      expect(reference.earned.map(({ achievementId }) => achievementId).sort(), `run ${run}`)
        .toEqual(rebuilt.achievements.map(({ achievementId }) => achievementId).sort());

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const order = random.shuffle(playOrder);
        for (const budget of [Infinity, random.int(0, 1)]) {
          const shuffled = processInOrder(docs, order, budget);
          expect(summaryContent(shuffled.summary), `run ${run} budget ${budget}`).toEqual(summaryContent(reference.summary));
          expect(daysContent(shuffled.days.values()), `run ${run} budget ${budget}`).toEqual(daysContent(reference.days.values()));
          expect(new Set(shuffled.earned.map(({ achievementId }) => achievementId)), `run ${run}`)
            .toEqual(new Set(reference.earned.map(({ achievementId }) => achievementId)));
          // Each achievement once, always earned by a session that was valid when it earned it.
          expect(new Set(shuffled.earned.map(({ achievementId }) => achievementId)).size).toBe(shuffled.earned.length);
          expect(shuffled.validWhenEarned.every(Boolean)).toBe(true);
          upgradesSeen += [...shuffled.results.values()].filter((result) => result.reasons.includes('start-level-unlocked-later')).length;
        }
      }

      // The independent oracle: every summary field, every day and game bucket, and the achievement set.
      const expected = oracle(docs, reference.results);
      expect(observed(reference.summary, reference.days.values()), `run ${run}`).toEqual(expected);
      expect(reference.earned.map(({ achievementId }) => achievementId).sort(), `run ${run}`).toEqual(expected.summary?.achievements ?? []);
      unverifiedDates += docs.filter((doc) => {
        const result = reference.results.get(doc.id);
        return result?.validity === 'valid' && doc.raw.status === 'completed' && result.reasons.includes('local-date-mismatch');
      }).length;
      achievementsSeen += reference.earned.length;
      streaksSeen += (reference.summary?.streak.longest ?? 0) >= 3 ? 1 : 0;
    }
    // The generator really exercises upgrades, achievements, unverified dates and multi-day streaks.
    expect(upgradesSeen).toBeGreaterThan(50);
    expect(achievementsSeen).toBeGreaterThan(150);
    expect(unverifiedDates).toBeGreaterThan(20);
    expect(streaksSeen).toBeGreaterThan(10);
  });
});
