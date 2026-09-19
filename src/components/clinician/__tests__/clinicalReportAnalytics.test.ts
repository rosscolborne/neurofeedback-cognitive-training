import { describe, expect, it } from 'vitest';
import type { ClientProfile, SessionRecord } from '../../../types';
import {
  buildClinicalReportAnalytics,
  createReportInterval,
  filterSessionsForReport,
} from '../clinicalReportAnalytics';

const client = (overrides: Partial<ClientProfile> = {}): ClientProfile => ({
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', avatarUrl: '',
  condition: 'Generalized Anxiety', status: 'active', assignedProtocol: 'alpha-enhancement',
  brainMaps: [], allowedExperiences: [], prescribedSessionsPerWeek: 2,
  completedSessionsCount: 99, currentStreak: 0, streakFreezeRemaining: 0,
  brainCapacityScore: 99, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 0, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [], ...overrides,
});

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1', patientId: 'patient-1', patientName: 'Patient One', clinicId: 'clinic-1',
  date: 'Sep 19, 2026', timestamp: Date.parse('2026-09-19T12:00:00Z'),
  protocol: 'alpha-enhancement', experience: 'tidal-garden', durationSeconds: 600,
  timeInZonePercent: 0, averageCoherence: null, peakFocusScore: 98,
  averageBands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
  timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0, ...overrides,
});

describe('clinical report intervals', () => {
  it('uses local calendar boundaries across a timezone offset', () => {
    const now = Date.parse('2026-09-19T02:30:00Z'); // Sep 18 in Toronto
    const interval = createReportInterval('30d', now, 'America/Toronto');
    expect(interval.startLabel).toBe('Aug 20, 2026');
    expect(interval.endLabel).toBe('Sep 18, 2026');
    expect(interval.dayCount).toBe(30);

    const atBoundary = session({ timestamp: interval.startMs });
    const before = session({ id: 'before', timestamp: interval.startMs - 1 });
    const future = session({ id: 'future', timestamp: now + 1 });
    expect(filterSessionsForReport([before, atBoundary, future], interval).map(item => item.id)).toEqual(['session-1']);
  });

  it('starts year-to-date at midnight in the selected timezone', () => {
    const interval = createReportInterval('ytd', Date.parse('2026-03-08T16:00:00Z'), 'America/Toronto');
    expect(new Date(interval.startMs).toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(interval.dayCount).toBe(67);
  });
});

describe('clinical report aggregation contracts', () => {
  it('returns unavailable measurements for an empty report without profile aggregate substitution', () => {
    const interval = createReportInterval('30d', Date.parse('2026-09-19T12:00:00Z'), 'UTC');
    const result = buildClinicalReportAnalytics([client()], [], interval);
    expect(result.totalSessions).toBe(0);
    expect(result.averageInZonePercent.value).toBeNull();
    expect(result.averageDurationMinutes.value).toBeNull();
    expect(result.deviceCoverage.value).toBeNull();
    expect(result.timeInZoneTrend).toBeNull();
    expect(result.patientRows[0].sessionCount).toBe(0);
    expect(result.patientRows[0].averageInZonePercent).toBeNull();
  });

  it('preserves zero and reports partial measurement/device coverage', () => {
    const interval = createReportInterval('30d', Date.parse('2026-09-19T12:00:00Z'), 'UTC');
    const malformed = session({ id: 'partial', timestamp: Date.parse('2026-09-18T12:00:00Z'), durationSeconds: Number.NaN, timeInZonePercent: 120 });
    const measuredZero = session({ device: { model: 'Muse S' } });
    const result = buildClinicalReportAnalytics([client()], [malformed, measuredZero], interval);
    expect(result.averageInZonePercent).toEqual({ value: 0, recordedSessions: 1, eligibleSessions: 2 });
    expect(result.averageDurationMinutes).toEqual({ value: 10, recordedSessions: 1, eligibleSessions: 2 });
    expect(result.deviceCoverage).toEqual({ value: 50, recordedSessions: 1, eligibleSessions: 2 });
    expect(result.deviceModels).toEqual([{ model: 'Muse S', sessions: 1 }]);
  });

  it('derives full aggregates, adherence, and descriptive trend only from interval sessions', () => {
    const interval = createReportInterval('30d', Date.parse('2026-09-19T12:00:00Z'), 'UTC');
    const sessions = [
      session({ id: 'a', timestamp: interval.startMs, timeInZonePercent: 20, durationSeconds: 600, device: { model: 'Muse S' } }),
      session({ id: 'b', timestamp: interval.startMs + 1, timeInZonePercent: 40, durationSeconds: 1200, device: { model: 'Muse S' } }),
      session({ id: 'c', timestamp: interval.endMs, timeInZonePercent: 60, durationSeconds: 1800, device: { model: 'Muse 2' } }),
      session({ id: 'old', timestamp: interval.startMs - 1, timeInZonePercent: 100 }),
      session({ id: 'other', patientId: 'other', timestamp: interval.endMs, timeInZonePercent: 100 }),
    ];
    const result = buildClinicalReportAnalytics([client({ prescribedSessionsPerWeek: 1 })], sessions, interval);
    expect(result.totalSessions).toBe(3);
    expect(result.totalDurationMinutes).toBe(60);
    expect(result.averageDurationMinutes.value).toBe(20);
    expect(result.averageInZonePercent.value).toBe(40);
    expect(result.expectedSessions).toBe(4.3);
    expect(result.adherencePercent).toBe(70);
    expect(result.timeInZoneTrend).toEqual({ firstAverage: 20, recentAverage: 60, change: 40, recordedSessions: 3 });
  });

  it('changes eligible totals when the selected range changes', () => {
    const now = Date.parse('2026-09-19T12:00:00Z');
    const recent = session({ id: 'recent', timestamp: now - 10 * 86_400_000 });
    const older = session({ id: 'older', timestamp: now - 60 * 86_400_000 });
    expect(buildClinicalReportAnalytics([client()], [recent, older], createReportInterval('30d', now, 'UTC')).totalSessions).toBe(1);
    expect(buildClinicalReportAnalytics([client()], [recent, older], createReportInterval('90d', now, 'UTC')).totalSessions).toBe(2);
  });
});
