import type { AppointmentTimeDisambiguation } from './appointmentTypes';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 100) return false;
  try {
    getFormatter(timezone).format(0);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimezone(timezone) ? timezone : 'UTC';
}

function parseWallClock(localDate: string, localTime: string): WallClockParts {
  const date = DATE_PATTERN.exec(localDate);
  const time = TIME_PATTERN.exec(localTime);
  if (!date || !time) throw new Error('Enter a valid date and time');

  const parts = {
    year: Number(date[1]),
    month: Number(date[2]),
    day: Number(date[3]),
    hour: Number(time[1]),
    minute: Number(time[2]),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (
    parts.year < 2000 ||
    parts.year > 2200 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    throw new Error('Enter a valid date and time');
  }
  return parts;
}

function partsAt(instant: number, timezone: string): WallClockParts {
  const values = Object.fromEntries(
    getFormatter(timezone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameWallClock(a: WallClockParts, b: WallClockParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

export function getPossibleAppointmentInstants(localDate: string, localTime: string, timezone: string): number[] {
  const target = parseWallClock(localDate, localTime);
  if (!isValidTimezone(timezone)) throw new Error('Select a valid IANA timezone');

  const naiveUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const matches: number[] = [];
  // Every current IANA UTC offset is within this range. Minute iteration also
  // handles historical half-hour/quarter-hour offsets and both DST folds/gaps.
  for (let instant = naiveUtc - 18 * 60 * 60_000; instant <= naiveUtc + 18 * 60 * 60_000; instant += 60_000) {
    if (sameWallClock(partsAt(instant, timezone), target)) matches.push(instant);
  }
  return matches;
}

export function resolveAppointmentInstant(
  localDate: string,
  localTime: string,
  timezone: string,
  disambiguation: AppointmentTimeDisambiguation = 'reject',
): number {
  const matches = getPossibleAppointmentInstants(localDate, localTime, timezone);
  if (matches.length === 0) {
    throw new Error('That local time does not exist because the clock moves forward. Choose another time');
  }
  if (matches.length > 1) {
    if (disambiguation === 'reject') {
      throw new Error('That local time occurs twice because the clock moves back. Choose the first or second occurrence');
    }
    return disambiguation === 'earlier' ? matches[0] : matches[matches.length - 1];
  }
  return matches[0];
}

export function getLocalAppointmentParts(startsAtMillis: number, timezone: string): { date: string; time: string } {
  if (!Number.isFinite(startsAtMillis) || !isValidTimezone(timezone)) throw new Error('Appointment time is invalid');
  const parts = partsAt(startsAtMillis, timezone);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}

export function formatAppointmentDateTime(startsAtMillis: number, timezone: string): string {
  if (!Number.isFinite(startsAtMillis) || !isValidTimezone(timezone)) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startsAtMillis);
}
