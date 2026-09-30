import type { FirestoreTimestamp } from '../primitives';
import { serverReason, type ReasonEntry } from './reasons';

// Trusted scoring's clock diagnostics (NFCT-19). Every one is a diagnostic:
// recorded on the result, never changing validity. Device clocks drift, jump
// and are adjusted by users and by network time sync, and sessions played
// offline legitimately arrive late, so none of these proves a session was
// forged. The rules already refuse what is clearly impossible on create
// (`startedAt < endedAt <= request.time + 5 min`, `createdAt == request.time`),
// and the session schema refuses `endedAt <= startedAt`. Stage 2 (streaks)
// may decide that `local-date-mismatch` excludes a session from streaks.

export const CLOCK_TOLERANCES = Object.freeze({
  /** How far the device's endedAt may run ahead of the server's createdAt (the rules allow 5 minutes). */
  deviceAheadMs: 60_000,
  /** How long after it ended a session may reach the server before it is noted as a late upload. */
  lateUploadMs: 7 * 24 * 60 * 60 * 1_000,
  /** Rounding slack when comparing the wall-clock span with the active time. */
  wallClockSlackMs: 1_000,
  /** How many calendar days localDate may be from endedAt's date in the session's zone. */
  localDateDays: 1,
});

export type ClockFacts = {
  readonly startedAt: FirestoreTimestamp;
  readonly endedAt: FirestoreTimestamp;
  /** Server clock (the rules force request.time). */
  readonly createdAt: FirestoreTimestamp;
  readonly activeDurationMs: number;
  readonly localDate: string;
  readonly timezone: string;
};

const DAY_MS = 86_400_000;

/** The calendar day (days since the epoch) of `ms` in `timezone`, or null if the zone is unknown. */
export function calendarDayIn(timezone: string, ms: number): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(ms);
  } catch (error) {
    // An unknown IANA zone is a RangeError; anything else is unexpected.
    if (error instanceof RangeError) return null;
    throw error;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const [year, month, day] = [part('year'), part('month'), part('day')];
  if (![year, month, day].every(Number.isInteger)) throw new Error(`Cannot read a date in time zone '${timezone}'`);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** The calendar day (days since the epoch) of a 'YYYY-MM-DD' date. */
function calendarDayOf(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** The clock diagnostics of one session, in a fixed order. */
export function clockDiagnostics(facts: ClockFacts): ReasonEntry[] {
  const reasons: ReasonEntry[] = [];
  const endedMs = facts.endedAt.toMillis();
  const createdMs = facts.createdAt.toMillis();

  if (endedMs - createdMs > CLOCK_TOLERANCES.deviceAheadMs) reasons.push(serverReason('device-clock-ahead'));
  if (createdMs - endedMs > CLOCK_TOLERANCES.lateUploadMs) reasons.push(serverReason('late-upload'));
  if (endedMs - facts.startedAt.toMillis() + CLOCK_TOLERANCES.wallClockSlackMs < facts.activeDurationMs) {
    reasons.push(serverReason('wall-clock-short'));
  }

  const endedDay = calendarDayIn(facts.timezone, endedMs);
  if (endedDay === null) {
    reasons.push(serverReason('unknown-timezone'));
  } else if (Math.abs(calendarDayOf(facts.localDate) - endedDay) > CLOCK_TOLERANCES.localDateDays) {
    reasons.push(serverReason('local-date-mismatch'));
  }
  return reasons;
}
