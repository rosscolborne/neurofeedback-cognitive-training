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

export function formatAppointmentDateTime(startsAtMillis: number, timezone: string): string {
  if (!Number.isFinite(startsAtMillis) || !isValidTimezone(timezone)) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startsAtMillis);
}
