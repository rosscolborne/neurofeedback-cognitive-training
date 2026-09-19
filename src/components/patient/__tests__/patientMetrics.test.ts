import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../types';
import {
  buildPatientProgressDisplayModel,
  computeActiveStreak,
  filterSessionsByPeriod,
  generateTimeInZoneChart,
  getEarnedBadgeIds,
  getSessionExportState,
  getWeeklyActivity,
  summarizeSessions,
} from '../patientMetrics';

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1', patientId: 'patient-1', patientName: 'Patient', clinicId: 'clinic-1',
  date: '2026-09-19', timestamp: Date.parse('2026-09-19T12:00:00Z'),
  protocol: 'theta-beta-ratio', experience: 'skyline-drift', durationSeconds: 600,
  timeInZonePercent: 50, averageCoherence: null, peakFocusScore: 0,
  averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
  timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0,
  ...overrides,
});

describe('patient metrics', () => {
  it('returns honest empty summaries and charts', () => {
    expect(summarizeSessions([])).toEqual({
      sessions: [], measuredSessions: [], sessionCount: 0, totalDurationSeconds: 0,
      averageTimeInZonePercent: null,
    });
    expect(generateTimeInZoneChart([], 360, 120)).toEqual({ line: '', area: '', labels: [], points: [] });
    expect(computeActiveStreak([], Date.parse('2026-09-19T12:00:00Z'), 'UTC')).toBe(0);
  });

  it('preserves legitimate zero measurements', () => {
    const sessions = [session({ timeInZonePercent: 0, durationSeconds: 0 })];
    const summary = summarizeSessions(sessions);
    expect(summary.averageTimeInZonePercent).toBe(0);
    expect(summary.totalDurationSeconds).toBe(0);
    expect(summary.measuredSessions).toHaveLength(1);
    expect(generateTimeInZoneChart(sessions, 360, 120).line).not.toBe('');
    expect(generateTimeInZoneChart(sessions, 360, 120).points).toHaveLength(1);
  });

  it('does not substitute malformed or partial legacy values', () => {
    const partial = session({ timeInZonePercent: undefined as unknown as number, durationSeconds: Number.NaN });
    const invalidDate = session({ id: 'invalid-date', timestamp: 0 });
    expect(summarizeSessions([partial]).averageTimeInZonePercent).toBeNull();
    expect(summarizeSessions([partial]).totalDurationSeconds).toBe(0);
    expect(filterSessionsByPeriod([partial, invalidDate], 'all', Date.parse('2026-09-20T00:00:00Z'))).toEqual([partial]);
  });

  it('filters mixed dates using exact rolling interval boundaries and excludes future sessions', () => {
    const now = Date.parse('2026-09-19T12:00:00Z');
    const sessions = [
      session({ id: 'boundary', timestamp: now - 7 * 86_400_000 }),
      session({ id: 'old', timestamp: now - 7 * 86_400_000 - 1 }),
      session({ id: 'future', timestamp: now + 1 }),
    ];
    expect(filterSessionsByPeriod(sessions, 'week', now).map(item => item.id)).toEqual(['boundary']);
  });

  it('computes streaks and weekly activity in the supplied timezone', () => {
    const now = Date.parse('2026-09-19T03:30:00Z'); // Sep 19 UTC, Sep 18 in Toronto
    const sessions = [
      session({ id: 'a', timestamp: Date.parse('2026-09-19T02:30:00Z') }), // Sep 18 Toronto
      session({ id: 'b', timestamp: Date.parse('2026-09-18T02:30:00Z') }), // Sep 17 Toronto
    ];
    expect(computeActiveStreak(sessions, now, 'America/Toronto')).toBe(2);
    const activity = getWeeklyActivity(sessions, now, 'America/Toronto');
    expect(activity.find(day => day.isToday)?.label).toBe('Fri');
    expect(activity.filter(day => day.completed)).toHaveLength(2);
  });

  it('awards only badges whose stated condition has direct session evidence', () => {
    const sessions = Array.from({ length: 7 }, (_, index) => session({
      id: `day-${index}`,
      timestamp: Date.parse(`2026-09-${String(10 + index).padStart(2, '0')}T12:00:00Z`),
      timeInZonePercent: index === 6 ? 80 : 40,
    }));
    expect(getEarnedBadgeIds(sessions, 'UTC')).toEqual(new Set(['first-light', 'steady-state', 'deep-focus']));
    expect(getEarnedBadgeIds([], 'UTC').size).toBe(0);
  });

  it('keeps unsupported badge proxies and near misses locked', () => {
    const proxySessions = Array.from({ length: 6 }, (_, index) => session({
      id: `proxy-${index}`,
      timestamp: Date.parse(`2026-09-${String(10 + index).padStart(2, '0')}T12:00:00Z`),
      protocol: 'alpha-enhancement',
      experience: 'tidal-garden',
      durationSeconds: 1_800,
      timeInZonePercent: index === 0 ? 79 : 100,
    }));
    proxySessions.push(session({
      id: 'deep-focus-near-miss',
      timestamp: Date.parse('2026-09-15T18:00:00Z'),
      protocol: 'theta-beta-ratio',
      timeInZonePercent: 79,
    }));
    const earned = getEarnedBadgeIds(proxySessions, 'UTC');
    expect(earned.has('steady-state')).toBe(false);
    expect(earned.has('deep-focus')).toBe(false);
    expect(earned.has('still-waters')).toBe(false);
    expect(earned.has('garden-keeper')).toBe(false);
    expect(earned.has('skyline-explorer')).toBe(false);
  });

  it('withholds all evidence conclusions while loading', () => {
    const model = buildPatientProgressDisplayModel('loading', [], {
      period: 'week', nowMs: Date.parse('2026-09-19T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 300, chartHeight: 40,
    });
    expect(model.presentation).toBe('loading');
    expect(model.summary).toBeNull();
    expect(model.weeklyActivity).toBeNull();
    expect(model.activeStreak).toBeNull();
    expect(model.chart).toBeNull();
    expect(model.earnedBadgeIds).toBeNull();
  });

  it('represents a resolved empty read as negative evidence', () => {
    const model = buildPatientProgressDisplayModel('ready', [], {
      period: 'month', nowMs: Date.parse('2026-09-19T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 360, chartHeight: 120,
    });
    expect(model.presentation).toBe('empty');
    expect(model.summary?.sessionCount).toBe(0);
    expect(model.summary?.averageTimeInZonePercent).toBeNull();
    expect(model.weeklyActivity).toHaveLength(7);
    expect(model.weeklyActivity?.every(day => !day.completed)).toBe(true);
    expect(model.chart?.points).toEqual([]);
    expect(model.earnedBadgeIds).toEqual(new Set());
  });

  it('withholds all evidence conclusions after a rejected read', () => {
    const model = buildPatientProgressDisplayModel('error', [], {
      period: 'all', nowMs: Date.parse('2026-09-19T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 360, chartHeight: 120,
    });
    expect(model.presentation).toBe('error');
    expect(model.summary).toBeNull();
    expect(model.weeklyActivity).toBeNull();
    expect(model.chart).toBeNull();
    expect(model.earnedBadgeIds).toBeNull();
  });

  it('preserves valid zero in the complete populated display model', () => {
    const model = buildPatientProgressDisplayModel('ready', [session({ timeInZonePercent: 0 })], {
      period: 'all', nowMs: Date.parse('2026-09-20T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 360, chartHeight: 120,
    });
    expect(model.presentation).toBe('data');
    expect(model.summary?.averageTimeInZonePercent).toBe(0);
    expect(model.chart?.points).toHaveLength(1);
  });

  it('represents one session as a point without inventing a trend', () => {
    const model = buildPatientProgressDisplayModel('ready', [session()], {
      period: 'all', nowMs: Date.parse('2026-09-20T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 360, chartHeight: 120,
    });
    expect(model.chart?.points).toHaveLength(1);
    expect(model.chart?.line.startsWith('M ')).toBe(true);
    expect(model.chart?.line.includes(' L ')).toBe(false);
  });

  it('exposes badge evidence only after a resolved qualifying read', () => {
    const qualifying = Array.from({ length: 7 }, (_, index) => session({
      id: `qualifying-${index}`,
      timestamp: Date.parse(`2026-09-${String(10 + index).padStart(2, '0')}T12:00:00Z`),
      timeInZonePercent: index === 6 ? 80 : 50,
    }));
    const model = buildPatientProgressDisplayModel('ready', qualifying, {
      period: 'all', nowMs: Date.parse('2026-09-20T12:00:00Z'), timeZone: 'UTC',
      chartWidth: 360, chartHeight: 120,
    });
    expect(model.earnedBadgeIds).toEqual(new Set(['first-light', 'steady-state', 'deep-focus']));
  });

  it('enables export only for resolved validated session data', () => {
    expect(getSessionExportState('loading')).toBe('loading');
    expect(getSessionExportState('error')).toBe('unavailable');
    expect(getSessionExportState('empty')).toBe('empty');
    expect(getSessionExportState('data')).toBe('ready');

    const nowMs = Date.parse('2026-09-20T12:00:00Z');
    const valid = session({ id: 'valid' });
    const invalid = session({ id: 'invalid', timestamp: 0 });
    const model = buildPatientProgressDisplayModel('ready', [invalid, valid], {
      period: 'all', nowMs, timeZone: 'UTC', chartWidth: 360, chartHeight: 120,
    });
    expect(getSessionExportState(model.presentation)).toBe('ready');
    expect(model.validSessions.map(item => item.id)).toEqual(['valid']);
  });
});
