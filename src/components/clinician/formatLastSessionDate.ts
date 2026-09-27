/** Render a stored session instant in the viewer's local calendar date. */
export const formatLastSessionDate = (value?: string, timeZone?: string, locale?: string): string => {
  if (!value) return 'No recorded session';
  // Stored session dates are instants. Reject ambiguous or malformed legacy strings.
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return 'Date unavailable';
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDay.getUTCFullYear() !== Number(year) || calendarDay.getUTCMonth() + 1 !== Number(month) || calendarDay.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || (offsetHour && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return 'Date unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(date);
};
