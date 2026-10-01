import {
  ACHIEVEMENT_CATALOGUE,
  datesIn,
  daysBetween,
  localDateIn,
  localDateOrdinal,
  monthContaining,
  streakStatus,
  summarizeActivity,
  trainingDatesIn,
  weekContaining,
  weekdayOf,
  weeklyGoalProgress,
  type Achievement,
  type AchievementDefinition,
  type ActivityTotals,
  type DailyStats,
  type LocalDate,
  type LocalDateRange,
  type StreakState,
  type StreakStatus,
  type UserProfile,
  type WeeklyGoal,
  type WeeklyGoalProgress,
} from '@nfct/shared';
import type { DocumentRead } from '../firestore/reads';

// Home and Progress around game performance (NFCT-13 part 2), as pure view
// models over the server-maintained aggregates: the stats summary (streak,
// all-time totals), at most 31 dailyStats documents (week and month activity,
// weekly goal) and the achievement documents, with titles and descriptions
// from the code catalogue. Nothing here reads EEG.
//
// Two different day counts, kept apart in every label:
// - the streak counts *training days*: days with a valid, finished run whose
//   date the server verified (stats/summary.streak; liveness from
//   streakStatus, never the stored `current`);
// - the week and month views and the weekly goal count *active days*: days
//   with a finished run in dailyStats, flagged runs included.
// An active day can therefore exist without a training day (a flagged run, or
// one uploaded more than a day late).

/** Weeks start on Monday (ISO 8601), as the shared week and weekly-goal helpers do by default. */
export const WEEK_STARTS_ON = 1;

export type PlayerZoneSource = 'profile' | 'device';

export interface PlayerZone {
  readonly zone: string;
  readonly source: PlayerZoneSource;
}

/**
 * The zone "today" is read in. The consumer profile's time zone when the
 * player has one; otherwise this device's zone, which is the zone the games
 * stamp each session's local date in. Accounts created by the inherited
 * sign-up have no consumer profile yet, so for them it is always the device.
 */
export function playerZone(profile: DocumentRead<UserProfile> | null, deviceZone: string): PlayerZone {
  return profile?.status === 'readable'
    ? { zone: profile.data.preferences.timezone, source: 'profile' }
    : { zone: deviceZone, source: 'device' };
}

/** The player's weekly goal: only a readable consumer profile can hold one. */
export function playerWeeklyGoal(profile: DocumentRead<UserProfile> | null): WeeklyGoal | null {
  return profile?.status === 'readable' ? profile.data.preferences.weeklyGoal : null;
}

/** Today in the player's zone, or null when this runtime does not know the zone. */
export function playerToday(zone: PlayerZone, nowMs: number): LocalDate | null {
  return localDateIn(zone.zone, nowMs);
}

export type StreakView =
  /** No training day yet. */
  | { readonly kind: 'none' }
  /** Training days exist, but today is unknown (the zone is not a real time zone): only the longest streak is certain. */
  | { readonly kind: 'today-unknown'; readonly longest: number; readonly lastActiveDate: LocalDate }
  | { readonly kind: 'status'; readonly status: StreakStatus };

export function streakView(streak: StreakState, today: LocalDate | null): StreakView {
  if (streak.lastActiveDate === null) return { kind: 'none' };
  if (today === null) return { kind: 'today-unknown', longest: streak.longest, lastActiveDate: streak.lastActiveDate };
  return { kind: 'status', status: streakStatus(streak, today) };
}

export type StreakNudge =
  | 'start'
  /** Alive, today not trained yet: playing today extends it. */
  | 'keep'
  | 'trained-today'
  /** Broken after a missed day. */
  | 'restart'
  | null;

/** What playing now does for the streak. Null when today is unknown. */
export function streakNudge(view: StreakView): StreakNudge {
  if (view.kind === 'none') return 'start';
  if (view.kind === 'today-unknown') return null;
  const { status } = view;
  if (status.trainedToday) return 'trained-today';
  if (status.alive) return 'keep';
  return 'restart';
}

const DAY_MS = 86_400_000;

/** A local date as a UTC instant, so formatting it never shifts it into another day. */
function dateOf(date: LocalDate): Date {
  return new Date(localDateOrdinal(date) * DAY_MS);
}

export function weekdayLabel(date: LocalDate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(dateOf(date));
}

/** "Mon 28 Sep" style, in the reader's locale; the year only when it is not `today`'s. */
export function formatLocalDate(date: LocalDate, today: LocalDate | null, locale?: string): string {
  const sameYear = today !== null && today.slice(0, 4) === date.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(dateOf(date));
}

export function daysText(count: number): string {
  return count === 1 ? '1 day' : `${count} days`;
}

export function dayOfMonth(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

export interface StreakStripDay {
  readonly date: LocalDate;
  readonly label: string;
  /** A training day: a day the streak counts. */
  readonly trained: boolean;
  readonly isToday: boolean;
  readonly isFuture: boolean;
}

/** This week's days with the streak's training days marked. */
export function streakStrip(streak: StreakState, today: LocalDate, locale?: string): StreakStripDay[] {
  const week = weekContaining(today, WEEK_STARTS_ON);
  const trained = new Set(trainingDatesIn(streak, week));
  return datesIn(week).map((date) => ({
    date,
    label: weekdayLabel(date, locale),
    trained: trained.has(date),
    isToday: date === today,
    isFuture: daysBetween(today, date) > 0,
  }));
}

export type ActivityPeriod = 'week' | 'month';

/** The dailyStats range a period reads: this week or this calendar month (at most 31 days). */
export function periodRange(period: ActivityPeriod, today: LocalDate): LocalDateRange {
  return period === 'week' ? weekContaining(today, WEEK_STARTS_ON) : monthContaining(today);
}

export interface ActivityDay {
  readonly date: LocalDate;
  readonly dayOfMonth: number;
  readonly sessionsCompleted: number;
  /** Runs played, finished or not. */
  readonly sessions: number;
  readonly activeMs: number;
  /** An active day: at least one finished run. */
  readonly active: boolean;
  readonly isToday: boolean;
  readonly isFuture: boolean;
}

export interface ActivityView {
  readonly range: LocalDateRange;
  readonly days: readonly ActivityDay[];
  readonly totals: ActivityTotals;
  /** Empty calendar cells before the first day, so each weekday keeps its column. */
  readonly leadingBlanks: number;
}

export function activityView(documents: readonly DailyStats[], range: LocalDateRange, today: LocalDate): ActivityView {
  const { days, totals } = summarizeActivity(documents, range);
  return {
    range,
    totals,
    leadingBlanks: (weekdayOf(range.from) - WEEK_STARTS_ON + 7) % 7,
    days: days.map((day) => ({
      date: day.date,
      dayOfMonth: dayOfMonth(day.date),
      sessionsCompleted: day.sessionsCompleted,
      sessions: day.sessions,
      activeMs: day.activeMs,
      active: day.sessionsCompleted > 0,
      isToday: day.date === today,
      isFuture: daysBetween(today, day.date) > 0,
    })),
  };
}

/** This week's progress toward the goal; null when no goal is set. */
export function goalProgress(goal: WeeklyGoal | null, documents: readonly DailyStats[], today: LocalDate): WeeklyGoalProgress | null {
  return weeklyGoalProgress(goal, documents, weekContaining(today, WEEK_STARTS_ON));
}

const GOAL_UNITS: Record<WeeklyGoal['kind'], { one: string; many: string }> = {
  sessions: { one: 'finished run', many: 'finished runs' },
  minutes: { one: 'minute played', many: 'minutes played' },
  activeDays: { one: 'active day', many: 'active days' },
};

/** "3 of 5 finished runs", or "6 finished runs (goal 5)" once past it. Active days are days with a finished run, not streak days. */
export function goalText(progress: WeeklyGoalProgress): string {
  const unit = GOAL_UNITS[progress.kind];
  const units = (count: number) => (count === 1 ? unit.one : unit.many);
  return progress.value > progress.target
    ? `${progress.value} ${units(progress.value)} (goal ${progress.target})`
    : `${progress.value} of ${progress.target} ${units(progress.target)}`;
}

export interface AchievementItem {
  readonly definition: AchievementDefinition;
  /** The earned document, or null when not earned yet. */
  readonly earned: Achievement | null;
}

export interface AchievementLists {
  /** Most recently earned first. */
  readonly earned: readonly AchievementItem[];
  /** Not earned yet, in catalogue order (the display order). */
  readonly notYet: readonly AchievementItem[];
  readonly total: number;
}

/**
 * The catalogue split into earned and not-yet-earned. An earned document this
 * build has no catalogue entry for (a newer catalogue's) is left out: it has
 * no title to show.
 */
export function achievementLists(documents: readonly Achievement[]): AchievementLists {
  const byId = new Map(documents.map((achievement) => [achievement.achievementId, achievement]));
  const order = new Map(documents.map((achievement, index) => [achievement.achievementId, index]));
  const items = ACHIEVEMENT_CATALOGUE.map((definition): AchievementItem => ({ definition, earned: byId.get(definition.id) ?? null }));
  const earned = items.filter((item) => item.earned !== null)
    // Documents arrive in the order they were earned; newest first here.
    .sort((a, b) => (order.get(b.definition.id) ?? 0) - (order.get(a.definition.id) ?? 0));
  return { earned, notYet: items.filter((item) => item.earned === null), total: ACHIEVEMENT_CATALOGUE.length };
}
