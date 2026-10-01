import type { UserProfile } from '../schemas/profile';
import type { DailyStats } from '../schemas/stats';
import { datesIn, type LocalDate, type LocalDateRange } from './localDate';

// Week, month and weekly-goal views (NFCT-13), computed when they are read
// from at most 31 dailyStats documents and the profile's weeklyGoal (design
// sections F and G). Nothing here is stored. Pure: no clock; the caller
// passes "today" (localDateIn(profile timezone, now)).
//
// The weekly goal measures time played, so it counts what dailyStats counts:
// every counted session, flagged ones included (flagged sessions count toward
// time played; invalid ones count nowhere):
// - 'sessions': completed sessions in the week;
// - 'minutes': whole minutes of active play, abandoned runs included;
// - 'activeDays': days of the week with at least one completed session.
// The streak is stricter (valid runs with a verified date only): see
// shared/stats/reducer.ts.

export type WeeklyGoal = NonNullable<UserProfile['preferences']['weeklyGoal']>;

export type DayActivity = {
  readonly date: LocalDate;
  readonly sessions: number;
  readonly sessionsCompleted: number;
  readonly activeMs: number;
  /** gameId -> that game's counts on the day. */
  readonly games: DailyStats['games'];
};

export type ActivityTotals = {
  readonly sessions: number;
  readonly sessionsCompleted: number;
  readonly activeMs: number;
  /** Days with at least one completed session. */
  readonly activeDays: number;
};

export type ActivitySummary = {
  /** Every date of the range, in order; a date with no document has zeros. */
  readonly days: DayActivity[];
  readonly totals: ActivityTotals;
};

/**
 * Lays the dailyStats documents out over every date of `range`, with zeros
 * for dates without one, and totals them. Documents outside the range are
 * ignored.
 */
export function summarizeActivity(documents: readonly DailyStats[], range: LocalDateRange): ActivitySummary {
  const byDate = new Map(documents.map((day) => [day.date, day]));
  const days = datesIn(range).map((date): DayActivity => {
    const day = byDate.get(date);
    return day
      ? { date, sessions: day.sessions, sessionsCompleted: day.sessionsCompleted, activeMs: day.activeMs, games: day.games }
      : { date, sessions: 0, sessionsCompleted: 0, activeMs: 0, games: {} };
  });
  const totals = days.reduce<ActivityTotals>((sum, day) => ({
    sessions: sum.sessions + day.sessions,
    sessionsCompleted: sum.sessionsCompleted + day.sessionsCompleted,
    activeMs: sum.activeMs + day.activeMs,
    activeDays: sum.activeDays + (day.sessionsCompleted > 0 ? 1 : 0),
  }), { sessions: 0, sessionsCompleted: 0, activeMs: 0, activeDays: 0 });
  return { days, totals };
}

export type WeeklyGoalProgress = {
  readonly kind: WeeklyGoal['kind'];
  readonly target: number;
  /** Progress toward the target in the goal's own unit. */
  readonly value: number;
  readonly met: boolean;
  /** value / target, capped at 1. */
  readonly fraction: number;
};

/**
 * Progress toward the profile's weekly goal over one week's dailyStats
 * (`week`: weekContaining(today)). Null when the player has set no goal.
 */
export function weeklyGoalProgress(
  goal: WeeklyGoal | null,
  documents: readonly DailyStats[],
  week: LocalDateRange,
): WeeklyGoalProgress | null {
  if (goal === null) return null;
  const { totals } = summarizeActivity(documents, week);
  const value = goal.kind === 'sessions' ? totals.sessionsCompleted
    : goal.kind === 'minutes' ? Math.floor(totals.activeMs / 60_000)
      : totals.activeDays;
  return { kind: goal.kind, target: goal.target, value, met: value >= goal.target, fraction: Math.min(1, value / goal.target) };
}
