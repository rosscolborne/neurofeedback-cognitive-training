import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../types';
import {
  computeActiveStreak,
  filterSessionsByPeriod,
  generateTimeInZoneChart,
  getEarnedBadgeIds,
  getSessionPresentationState,
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

  it('distinguishes loading, failed, empty, and populated session states', () => {
    expect(getSessionPresentationState('loading', 0)).toBe('loading');
    expect(getSessionPresentationState('error', 0)).toBe('error');
    expect(getSessionPresentationState('ready', 0)).toBe('empty');
    expect(getSessionPresentationState('ready', 1)).toBe('data');
  });
});
