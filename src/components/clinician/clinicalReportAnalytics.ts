import type { ClientProfile, SessionRecord } from '../../types';

export type ClinicalReportRange = '30d' | '90d' | 'ytd';

export interface ReportInterval {
  range: ClinicalReportRange;
  label: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  dayCount: number;
  timeZone: string;
}

export interface CoveredMetric {
  value: number | null;
  recordedSessions: number;
  eligibleSessions: number;
}

export interface PatientReportRow {
  client: ClientProfile;
  sessions: SessionRecord[];
  sessionCount: number;
  durationMinutes: number | null;
  averageInZonePercent: number | null;
  inZoneRecordedSessions: number;
  expectedSessions: number | null;
  adherencePercent: number | null;
  deviceRecordedSessions: number;
}

export interface ClinicalReportAnalytics {
  interval: ReportInterval;
  clients: ClientProfile[];
  sessions: SessionRecord[];
  patientRows: PatientReportRow[];
  totalSessions: number;
  totalDurationMinutes: number | null;
  averageDurationMinutes: CoveredMetric;
  averageInZonePercent: CoveredMetric;
  adherencePercent: number | null;
  expectedSessions: number | null;
  deviceCoverage: CoveredMetric;
  deviceModels: Array<{ model: string; sessions: number }>;
  timeInZoneTrend: {
    firstAverage: number;
    recentAverage: number;
    change: number;
    recordedSessions: number;
  } | null;
}

const DAY_MS = 86_400_000;

function numeric(value: unknown, min: number, max = Number.POSITIVE_INFINITY): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function zonedDateParts(timestamp: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function timeZoneOffsetAt(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const representedAsUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return representedAsUtc - timestamp;
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day);
  let result = target - timeZoneOffsetAt(target, timeZone);
  // Re-evaluate at the candidate instant so DST changes near the target date are respected.
  result = target - timeZoneOffsetAt(result, timeZone);
  return result;
}

function dateLabel(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function createReportInterval(
  range: ClinicalReportRange,
  nowMs = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): ReportInterval {
  if (!Number.isFinite(nowMs)) throw new Error('A valid report end time is required.');
  const today = zonedDateParts(nowMs, timeZone);
  const todayOrdinal = Date.UTC(today.year, today.month - 1, today.day) / DAY_MS;
  const requestedDays = range === '30d' ? 30 : range === '90d' ? 90 : null;
  const startCalendar = requestedDays == null
    ? { year: today.year, month: 1, day: 1 }
    : (() => {
        const date = new Date((todayOrdinal - (requestedDays - 1)) * DAY_MS);
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
      })();
  const startMs = zonedMidnightUtc(startCalendar.year, startCalendar.month, startCalendar.day, timeZone);
  const startOrdinal = Date.UTC(startCalendar.year, startCalendar.month - 1, startCalendar.day) / DAY_MS;
  const dayCount = todayOrdinal - startOrdinal + 1;
  const label = range === '30d' ? 'Last 30 days' : range === '90d' ? 'Last 90 days' : 'Year to date';

  return {
    range,
    label,
    startMs,
    endMs: nowMs,
    startLabel: dateLabel(startMs, timeZone),
    endLabel: dateLabel(nowMs, timeZone),
    dayCount,
    timeZone,
  };
}

export function filterSessionsForReport(
  sessions: SessionRecord[],
  interval: ReportInterval,
  patientIds?: Set<string>,
): SessionRecord[] {
  return sessions
    .filter(session => {
      const timestamp = numeric(session.timestamp, 1);
      return timestamp != null
        && timestamp >= interval.startMs
        && timestamp <= interval.endMs
        && (!patientIds || patientIds.has(session.patientId));
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundedAverage(values: number[], precision = 0): number | null {
  const result = average(values);
  if (result == null) return null;
  const factor = 10 ** precision;
  return Math.round(result * factor) / factor;
}

function expectedSessions(client: ClientProfile, interval: ReportInterval): number | null {
  const weekly = numeric(client.prescribedSessionsPerWeek, 0);
  return weekly == null ? null : Math.round((weekly * interval.dayCount / 7) * 10) / 10;
}

function buildPatientRow(
  client: ClientProfile,
  sessions: SessionRecord[],
  interval: ReportInterval,
): PatientReportRow {
  const durations = sessions
    .map(session => numeric(session.durationSeconds, 0))
    .filter((value): value is number => value != null);
  const inZone = sessions
    .map(session => numeric(session.timeInZonePercent, 0, 100))
    .filter((value): value is number => value != null);
  const expected = expectedSessions(client, interval);
  return {
    client,
    sessions,
    sessionCount: sessions.length,
    durationMinutes: durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / 60),
    averageInZonePercent: roundedAverage(inZone),
    inZoneRecordedSessions: inZone.length,
    expectedSessions: expected,
    adherencePercent: expected == null || expected === 0
      ? null
      : Math.min(100, Math.round((sessions.length / expected) * 100)),
    deviceRecordedSessions: sessions.filter(session => Boolean(session.device?.model?.trim())).length,
  };
}

export function buildClinicalReportAnalytics(
  clients: ClientProfile[],
  allSessions: SessionRecord[],
  interval: ReportInterval,
): ClinicalReportAnalytics {
  const clientIds = new Set(clients.map(client => client.id));
  const sessions = filterSessionsForReport(allSessions, interval, clientIds);
  const patientRows = clients.map(client => buildPatientRow(
    client,
    sessions.filter(session => session.patientId === client.id),
    interval,
  ));
  const durations = sessions
    .map(session => numeric(session.durationSeconds, 0))
    .filter((value): value is number => value != null);
  const inZoneSessions = sessions
    .map(session => ({ session, value: numeric(session.timeInZonePercent, 0, 100) }))
    .filter((entry): entry is { session: SessionRecord; value: number } => entry.value != null);
  const inZone = inZoneSessions.map(entry => entry.value);
  const expectedValues = patientRows
    .map(row => row.expectedSessions)
    .filter((value): value is number => value != null);
  const expectedTotal = expectedValues.length === clients.length
    ? Math.round(expectedValues.reduce((a, b) => a + b, 0) * 10) / 10
    : null;
  const deviceSessions = sessions.filter(session => Boolean(session.device?.model?.trim()));
  const modelCounts = new Map<string, number>();
  deviceSessions.forEach(session => {
    const model = session.device?.model?.trim();
    if (model) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
  });
  const half = Math.floor(inZone.length / 2);
  const first = half > 0 ? roundedAverage(inZone.slice(0, half)) : null;
  const recent = half > 0 ? roundedAverage(inZone.slice(inZone.length - half)) : null;

  return {
    interval,
    clients,
    sessions,
    patientRows,
    totalSessions: sessions.length,
    totalDurationMinutes: durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / 60),
    averageDurationMinutes: {
      value: roundedAverage(durations.map(seconds => seconds / 60), 1),
      recordedSessions: durations.length,
      eligibleSessions: sessions.length,
    },
    averageInZonePercent: {
      value: roundedAverage(inZone),
      recordedSessions: inZone.length,
      eligibleSessions: sessions.length,
    },
    expectedSessions: expectedTotal,
    adherencePercent: expectedTotal == null || expectedTotal === 0
      ? null
      : Math.min(100, Math.round((sessions.length / expectedTotal) * 100)),
    deviceCoverage: {
      value: sessions.length === 0 ? null : Math.round((deviceSessions.length / sessions.length) * 100),
      recordedSessions: deviceSessions.length,
      eligibleSessions: sessions.length,
    },
    deviceModels: [...modelCounts.entries()]
      .map(([model, count]) => ({ model, sessions: count }))
      .sort((a, b) => a.model.localeCompare(b.model)),
    timeInZoneTrend: first == null || recent == null
      ? null
      : { firstAverage: first, recentAverage: recent, change: recent - first, recordedSessions: inZone.length },
  };
}

export function formatMetric(value: number | null, suffix = ''): string {
  return value == null ? 'Unavailable' : `${value}${suffix}`;
}
