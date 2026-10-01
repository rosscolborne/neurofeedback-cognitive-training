import type { StreakRun, StreakState } from '../schemas/stats';
import { daysBetween, localDateFromOrdinal, localDateOrdinal, type LocalDate, type LocalDateRange } from './localDate';

// Streaks over training days (NFCT-13). The stored state is the set of
// training days as maximal runs of consecutive local dates, so adding a day
// is a set union: the result is the same whatever order sessions are
// processed in, and a session that arrives late (offline, re-driven) fills
// its gap exactly. `current`, `longest` and `lastActiveDate` are derived from
// the runs; whether the current streak is still alive depends on "today" in
// the player's zone, so streakStatus decides it when the summary is read.
//
// Reference logic: computeActiveStreak in src/components/patient/patientMetrics.ts
// (consecutive local days ending today or yesterday; several sessions on one
// day count once), re-typed over local dates.

export const EMPTY_STREAK: StreakState = Object.freeze({ runs: [], current: 0, longest: 0, lastActiveDate: null });

function runLength({ start, end }: StreakRun): number {
  return daysBetween(start, end) + 1;
}

/** The streak state of `runs` (ordered, disjoint, separated by gaps). */
export function streakFromRuns(runs: readonly StreakRun[]): StreakState {
  const last = runs.at(-1);
  return {
    runs: runs.map(({ start, end }) => ({ start, end })),
    current: last ? runLength(last) : 0,
    longest: runs.reduce((longest, run) => Math.max(longest, runLength(run)), 0),
    lastActiveDate: last?.end ?? null,
  };
}

/** Adds one training day. Idempotent: a day already in a run changes nothing. */
export function addTrainingDay(streak: StreakState, date: LocalDate): StreakState {
  const day = localDateOrdinal(date);
  const spans = streak.runs.map(({ start, end }) => [localDateOrdinal(start), localDateOrdinal(end)] as [number, number]);
  const merged: [number, number][] = [];
  let pending: [number, number] = [day, day];
  let placed = false;
  for (const span of spans) {
    if (span[1] < pending[0] - 1) {
      merged.push(span); // entirely before, with a gap
    } else if (span[0] > pending[1] + 1) {
      if (!placed) merged.push(pending);
      placed = true;
      merged.push(span); // entirely after, with a gap
    } else {
      pending = [Math.min(pending[0], span[0]), Math.max(pending[1], span[1])]; // touches or overlaps: merge
    }
  }
  if (!placed) merged.push(pending);
  return streakFromRuns(merged.map(([start, end]) => ({ start: localDateFromOrdinal(start), end: localDateFromOrdinal(end) })));
}

export type StreakStatus = {
  /** Days in the streak as of `today`: 0 once it is broken. */
  readonly current: number;
  readonly longest: number;
  readonly lastActiveDate: LocalDate | null;
  /** The latest training day is today or yesterday (or later, for a session dated in a zone ahead of today's). */
  readonly alive: boolean;
  /** Today is already a training day. Alive but not played today: playing today extends the streak, missing it ends it. */
  readonly trainedToday: boolean;
};

/**
 * Whether the stored streak is still alive on `today` (the local date in the
 * player's zone; see localDateIn). It is alive while the latest training day
 * is today or yesterday; after a missed day its current length is 0.
 */
export function streakStatus(streak: StreakState, today: LocalDate): StreakStatus {
  const { lastActiveDate, longest } = streak;
  if (lastActiveDate === null) return { current: 0, longest, lastActiveDate, alive: false, trainedToday: false };
  const sinceLast = daysBetween(lastActiveDate, today);
  const alive = sinceLast <= 1;
  const trainedToday = trainingDatesIn(streak, { from: today, to: today }).length === 1;
  return { current: alive ? streak.current : 0, longest, lastActiveDate, alive, trainedToday };
}

/** The training days within a range, in order: for calendar and week views. */
export function trainingDatesIn(streak: StreakState, range: LocalDateRange): LocalDate[] {
  const from = localDateOrdinal(range.from);
  const to = localDateOrdinal(range.to);
  const dates: LocalDate[] = [];
  for (const run of streak.runs) {
    const start = Math.max(from, localDateOrdinal(run.start));
    const end = Math.min(to, localDateOrdinal(run.end));
    for (let day = start; day <= end; day += 1) dates.push(localDateFromOrdinal(day));
  }
  return dates;
}
