import { describe, expect, it } from 'vitest';
import { getLocalAppointmentParts, getPossibleAppointmentInstants, resolveAppointmentInstant } from '../appointmentTime';

describe('appointment timezone normalization', () => {
  it('round-trips an ordinary wall-clock time to one exact instant', () => {
    const instant = resolveAppointmentInstant('2026-09-19', '10:30', 'America/Toronto');
    expect(new Date(instant).toISOString()).toBe('2026-09-19T14:30:00.000Z');
    expect(getLocalAppointmentParts(instant, 'America/Toronto')).toEqual({ date: '2026-09-19', time: '10:30' });
  });

  it('rejects a nonexistent spring-forward time', () => {
    expect(getPossibleAppointmentInstants('2026-03-08', '02:30', 'America/Toronto')).toEqual([]);
    expect(() => resolveAppointmentInstant('2026-03-08', '02:30', 'America/Toronto')).toThrow(/does not exist/);
  });

  it('requires an explicit choice for a repeated fall-back time', () => {
    const possible = getPossibleAppointmentInstants('2026-11-01', '01:30', 'America/Toronto');
    expect(possible.map((value) => new Date(value).toISOString())).toEqual([
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T06:30:00.000Z',
    ]);
    expect(() => resolveAppointmentInstant('2026-11-01', '01:30', 'America/Toronto')).toThrow(/occurs twice/);
    expect(resolveAppointmentInstant('2026-11-01', '01:30', 'America/Toronto', 'earlier')).toBe(possible[0]);
    expect(resolveAppointmentInstant('2026-11-01', '01:30', 'America/Toronto', 'later')).toBe(possible[1]);
  });

  it('rejects invalid calendar values and timezone identifiers', () => {
    expect(() => resolveAppointmentInstant('2026-02-30', '10:00', 'UTC')).toThrow(/valid date/);
    expect(() => resolveAppointmentInstant('2026-02-20', '24:00', 'UTC')).toThrow(/valid date/);
    expect(() => resolveAppointmentInstant('2026-02-20', '10:00', 'Mars/Olympus')).toThrow(/IANA timezone/);
  });
});
