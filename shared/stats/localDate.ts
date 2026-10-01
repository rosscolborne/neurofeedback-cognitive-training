import { localDateSchema } from '../primitives';
import { calendarDayIn } from '../processing/clock';

// Calendar arithmetic on local dates ('YYYY-MM-DD' in the player's zone). A
// local date is already a day in the player's zone, so arithmetic on it is
// plain calendar arithmetic in UTC: no daylight-saving or time-zone offset can
// change it. Only "what is today" needs a zone (localDateIn).

/** 'YYYY-MM-DD', a real calendar date in the player's zone. */
export type LocalDate = string;

const DAY_MS = 86_400_000;

/** Throws unless `value` is a real 'YYYY-MM-DD' calendar date. */
export function assertLocalDate(value: string): LocalDate {
  if (!localDateSchema.safeParse(value).success) throw new Error(`Not a local date: ${JSON.stringify(value)}`);
  return value;
}

/** Days since 1970-01-01 of a local date. Consecutive dates differ by exactly 1. */
export function localDateOrdinal(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** The local date `ordinal` days after 1970-01-01. */
export function localDateFromOrdinal(ordinal: number): LocalDate {
  if (!Number.isInteger(ordinal)) throw new Error(`Not a day ordinal: ${ordinal}`);
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return localDateFromOrdinal(localDateOrdinal(date) + days);
}

/** `to` minus `from`, in days. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return localDateOrdinal(to) - localDateOrdinal(from);
}

/**
 * The local date of the instant `ms` in an IANA time zone: "today" for the
 * player when `ms` is now. Null when the zone is unknown to this runtime.
 */
export function localDateIn(timezone: string, ms: number): LocalDate | null {
  const ordinal = calendarDayIn(timezone, ms);
  return ordinal === null ? null : localDateFromOrdinal(ordinal);
}

/** An inclusive range of local dates. */
export type LocalDateRange = { readonly from: LocalDate; readonly to: LocalDate };

/** The most days one dailyStats read covers (design section G: a month at most). */
export const MAX_DAILY_STATS_RANGE_DAYS = 31;

/** Throws unless the range is ordered and covers at most MAX_DAILY_STATS_RANGE_DAYS days. */
export function assertDailyStatsRange(range: LocalDateRange): LocalDateRange {
  assertLocalDate(range.from);
  assertLocalDate(range.to);
  const days = daysBetween(range.from, range.to) + 1;
  if (days < 1 || days > MAX_DAILY_STATS_RANGE_DAYS) {
    throw new Error(`A daily stats range covers 1 to ${MAX_DAILY_STATS_RANGE_DAYS} days, not ${range.from}..${range.to}`);
  }
  return range;
}

/** Every date of the range, in order. */
export function datesIn(range: LocalDateRange): LocalDate[] {
  const from = localDateOrdinal(range.from);
  const count = Math.max(0, localDateOrdinal(range.to) - from + 1);
  return Array.from({ length: count }, (_, index) => localDateFromOrdinal(from + index));
}

/** 0 = Sunday ... 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function weekdayOf(date: LocalDate): Weekday {
  return new Date(localDateOrdinal(date) * DAY_MS).getUTCDay() as Weekday;
}

/**
 * The 7-day week containing `date`. Weeks start on Monday (ISO 8601) unless
 * `weekStartsOn` says otherwise (0 = Sunday).
 */
export function weekContaining(date: LocalDate, weekStartsOn: Weekday = 1): LocalDateRange {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7;
  const from = addDays(date, -offset);
  return { from, to: addDays(from, 6) };
}

/** The calendar month containing `date` (28 to 31 days). */
export function monthContaining(date: LocalDate): LocalDateRange {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const first = Date.UTC(year, month - 1, 1) / DAY_MS;
  const next = Date.UTC(year, month, 1) / DAY_MS;
  return { from: localDateFromOrdinal(first), to: localDateFromOrdinal(next - 1) };
}
