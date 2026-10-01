import { describe, expect, it } from 'vitest';
import {
  addDays,
  addTrainingDay,
  assertDailyStatsRange,
  datesIn,
  daysBetween,
  EMPTY_STREAK,
  localDateFromOrdinal,
  localDateIn,
  localDateOrdinal,
  monthContaining,
  streakStatus,
  summarizeActivity,
  trainingDatesIn,
  weekContaining,
  weekdayOf,
  weeklyGoalProgress,
  type DailyStats,
  type StreakState,
} from '@nfct/shared';
import { TestTimestamp } from './fixtures';

// Local dates, streaks and the read-time week, month and weekly-goal views
// (NFCT-13). Local dates are already days in the player's zone, so arithmetic
// on them never sees daylight-saving time; only "today" needs the zone.

/** A small deterministic PRNG (mulberry32). */
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

const streakOf = (...dates: string[]) => dates.reduce(addTrainingDay, EMPTY_STREAK);

describe('local date arithmetic', () => {
  it('crosses month, leap-day and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(daysBetween('2026-12-25', '2027-01-07')).toBe(13);
    expect(localDateFromOrdinal(localDateOrdinal('1999-12-31') + 1)).toBe('2000-01-01');
  });

  it('counts every calendar day once across the daylight-saving changes (local dates have no clock)', () => {
    // America/Toronto springs forward on 2026-03-08 and falls back on 2026-11-01.
    expect(datesIn({ from: '2026-03-07', to: '2026-03-09' })).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(datesIn({ from: '2026-10-31', to: '2026-11-02' })).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it("gives today's date in the player's zone, through daylight-saving changes", () => {
    // 2026-03-08 06:59 UTC is 01:59 EST; 07:00 UTC is 03:00 EDT: the same Toronto date either side of the jump.
    expect(localDateIn('America/Toronto', Date.UTC(2026, 2, 8, 6, 59))).toBe('2026-03-08');
    expect(localDateIn('America/Toronto', Date.UTC(2026, 2, 8, 7, 0))).toBe('2026-03-08');
    // On 2026-11-01, 05:30 UTC is 01:30 EDT and 06:30 UTC is 01:30 EST (the repeated hour); the day ends at 05:00 UTC on the 2nd.
    expect(localDateIn('America/Toronto', Date.UTC(2026, 10, 1, 4, 30))).toBe('2026-11-01');
    expect(localDateIn('America/Toronto', Date.UTC(2026, 10, 1, 5, 30))).toBe('2026-11-01');
    expect(localDateIn('America/Toronto', Date.UTC(2026, 10, 1, 6, 30))).toBe('2026-11-01');
    expect(localDateIn('America/Toronto', Date.UTC(2026, 10, 2, 4, 59))).toBe('2026-11-01');
    expect(localDateIn('America/Toronto', Date.UTC(2026, 10, 2, 5, 0))).toBe('2026-11-02');
  });

  it('gives each zone its own date for one instant', () => {
    const instant = Date.UTC(2026, 11, 31, 11, 30);
    expect(localDateIn('Pacific/Kiritimati', instant)).toBe('2027-01-01'); // UTC+14
    expect(localDateIn('Asia/Kolkata', instant)).toBe('2026-12-31'); // UTC+5:30
    expect(localDateIn('Pacific/Pago_Pago', instant)).toBe('2026-12-31'); // UTC-11
    expect(localDateIn('Pacific/Pago_Pago', Date.UTC(2027, 0, 1, 10, 59))).toBe('2026-12-31');
    expect(localDateIn('Not/A_Zone', instant)).toBeNull();
  });

  it('finds the week (Monday by default, or Sunday) and the month containing a date', () => {
    expect(weekdayOf('2026-10-01')).toBe(4); // a Thursday
    expect(weekContaining('2026-10-01')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekContaining('2026-10-01', 0)).toEqual({ from: '2026-09-27', to: '2026-10-03' });
    expect(weekContaining('2026-09-28')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekContaining('2026-10-04')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(weekContaining('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(monthContaining('2028-02-14')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthContaining('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthContaining('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('bounds a daily stats read to at most 31 ordered days', () => {
    expect(assertDailyStatsRange(monthContaining('2026-10-15'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(assertDailyStatsRange({ from: '2026-10-01', to: '2026-10-01' })).toBeTruthy();
    expect(() => assertDailyStatsRange({ from: '2026-10-01', to: '2026-11-01' })).toThrow(/1 to 31 days/);
    expect(() => assertDailyStatsRange({ from: '2026-10-02', to: '2026-10-01' })).toThrow(/1 to 31 days/);
    expect(() => assertDailyStatsRange({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/Not a local date/);
  });
});

describe('streak runs', () => {
  it('counts consecutive training days, once per day, across month, year and daylight-saving boundaries', () => {
    expect(streakOf('2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-01')).toMatchObject({
      runs: [{ start: '2026-10-30', end: '2026-11-02' }], current: 4, longest: 4, lastActiveDate: '2026-11-02',
    });
    expect(streakOf('2026-12-30', '2026-12-31', '2027-01-01')).toMatchObject({ current: 3, longest: 3 });
    expect(streakOf('2028-02-28', '2028-02-29', '2028-03-01')).toMatchObject({ current: 3 });
    expect(streakOf('2026-02-28', '2026-03-01')).toMatchObject({ current: 2 });
  });

  it('keeps separate runs across a gap, and the longest one', () => {
    const streak = streakOf('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-06');
    expect(streak).toEqual({
      runs: [{ start: '2026-09-01', end: '2026-09-03' }, { start: '2026-09-05', end: '2026-09-06' }],
      current: 2, longest: 3, lastActiveDate: '2026-09-06',
    });
  });

  it('fills a gap exactly when a late session arrives for the missing day', () => {
    const before = streakOf('2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05');
    expect(before).toMatchObject({ current: 2, longest: 2 });
    expect(addTrainingDay(before, '2026-09-03')).toEqual({
      runs: [{ start: '2026-09-01', end: '2026-09-05' }], current: 5, longest: 5, lastActiveDate: '2026-09-05',
    });
    // An earlier day before the first run, and one that touches its start.
    expect(addTrainingDay(before, '2026-08-20').runs[0]).toEqual({ start: '2026-08-20', end: '2026-08-20' });
    expect(addTrainingDay(before, '2026-08-31').runs[0]).toEqual({ start: '2026-08-31', end: '2026-09-02' });
  });

  it('is the same set of runs whatever order the days arrive in (property)', () => {
    const random = prng(0x5713_a4);
    for (let run = 0; run < 300; run += 1) {
      const base = localDateOrdinal('2026-12-20');
      const days = Array.from({ length: random.int(1, 25) }, () => localDateFromOrdinal(base + random.int(0, 40)));
      const expected = streakOf(...[...days].sort());
      for (let attempt = 0; attempt < 4; attempt += 1) expect(streakOf(...random.shuffle(days))).toEqual(expected);
      // Against a brute-force count over the distinct days.
      const distinct = [...new Set(days.map(localDateOrdinal))].sort((a, b) => a - b);
      let longest = 0;
      let length = 0;
      distinct.forEach((day, index) => {
        length = index > 0 && day === distinct[index - 1]! + 1 ? length + 1 : 1;
        longest = Math.max(longest, length);
      });
      expect(expected.longest, `run ${run}`).toBe(longest);
      expect(expected.current, `run ${run}`).toBe(length);
      expect(trainingDatesIn(expected, { from: '1970-01-01', to: '2100-01-01' })).toEqual(distinct.map(localDateFromOrdinal));
    }
  });
});

describe('streak liveness, decided when read', () => {
  const streak: StreakState = streakOf('2026-09-28', '2026-09-29', '2026-09-30');

  it('is alive while the latest training day is today or yesterday', () => {
    expect(streakStatus(streak, '2026-09-30')).toEqual({
      current: 3, longest: 3, lastActiveDate: '2026-09-30', alive: true, trainedToday: true,
    });
    expect(streakStatus(streak, '2026-10-01')).toEqual({
      current: 3, longest: 3, lastActiveDate: '2026-09-30', alive: true, trainedToday: false,
    });
  });

  it('is broken once a whole day is missed, keeping the longest', () => {
    expect(streakStatus(streak, '2026-10-02')).toEqual({
      current: 0, longest: 3, lastActiveDate: '2026-09-30', alive: false, trainedToday: false,
    });
    expect(streakStatus(streak, '2027-01-15')).toMatchObject({ current: 0, alive: false });
  });

  it('crosses month and year ends, and stays alive for a session dated in a zone ahead of today', () => {
    expect(streakStatus(streakOf('2026-12-30', '2026-12-31'), '2027-01-01')).toMatchObject({ current: 2, alive: true });
    expect(streakStatus(streakOf('2026-10-01', '2026-10-02'), '2026-10-01')).toMatchObject({ current: 2, alive: true, trainedToday: true });
  });

  it('has no streak before the first training day', () => {
    expect(streakStatus(EMPTY_STREAK, '2026-10-01')).toEqual({ current: 0, longest: 0, lastActiveDate: null, alive: false, trainedToday: false });
  });

  it('lists the training days of a week for a calendar', () => {
    expect(trainingDatesIn(streakOf('2026-09-25', '2026-09-26', '2026-09-28', '2026-10-01'), weekContaining('2026-10-01')))
      .toEqual(['2026-09-28', '2026-10-01']);
  });
});

describe('week, month and weekly-goal views', () => {
  const at = new TestTimestamp(1_790_000_000);
  const day = (date: string, sessions: number, sessionsCompleted: number, activeMs: number): DailyStats => ({
    schemaVersion: 1, aggregateVersion: 1, updatedAt: at, date, sessions, sessionsCompleted, activeMs,
    games: { 'mental-math': { sessions, sessionsCompleted, activeMs } },
  });
  const week = weekContaining('2026-10-01');
  const documents = [
    day('2026-09-28', 2, 2, 180_000),
    day('2026-09-30', 1, 0, 30_000), // only an abandoned run
    day('2026-10-01', 3, 3, 270_000),
    day('2026-10-05', 9, 9, 810_000), // next week: ignored
  ];

  it('lays the days out over the whole range with zeros, and totals them', () => {
    const { days, totals } = summarizeActivity(documents, week);
    expect(days.map(({ date, sessions }) => [date, sessions])).toEqual([
      ['2026-09-28', 2], ['2026-09-29', 0], ['2026-09-30', 1], ['2026-10-01', 3], ['2026-10-02', 0], ['2026-10-03', 0], ['2026-10-04', 0],
    ]);
    expect(totals).toEqual({ sessions: 6, sessionsCompleted: 5, activeMs: 480_000, activeDays: 2 });
    expect(summarizeActivity(documents, monthContaining('2026-10-01')).days).toHaveLength(31);
  });

  it('measures each kind of weekly goal', () => {
    expect(weeklyGoalProgress({ kind: 'sessions', target: 5 }, documents, week)).toEqual({ kind: 'sessions', target: 5, value: 5, met: true, fraction: 1 });
    expect(weeklyGoalProgress({ kind: 'minutes', target: 20 }, documents, week)).toEqual({ kind: 'minutes', target: 20, value: 8, met: false, fraction: 0.4 });
    expect(weeklyGoalProgress({ kind: 'activeDays', target: 3 }, documents, week)).toMatchObject({ value: 2, met: false });
    expect(weeklyGoalProgress({ kind: 'sessions', target: 4 }, documents, week)?.fraction).toBe(1);
  });

  it('has no goal progress when the player set no goal', () => {
    expect(weeklyGoalProgress(null, documents, week)).toBeNull();
  });
});
