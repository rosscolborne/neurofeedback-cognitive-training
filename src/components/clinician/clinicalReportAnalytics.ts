import type { ClientProfile, SessionRecord } from '../../types';

export type ClinicalReportRange = '30d' | '90d' | 'ytd';
export type ClinicalReportCohortFilter = 'all' | 'real' | 'demo';
export type ClinicalReportLoadState = 'loading' | 'ready' | 'error';
export type ClinicalReportExportState = 'idle' | 'exporting' | 'error';
export type ClinicalReportPresentation = 'loading' | 'error' | 'empty' | 'data';

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
  /** Persisted sessions eligible for aggregates, including intentional training Demo sessions. */
  sessions: SessionRecord[];
  /** Intentional training Demo sessions retained as an overlapping provenance subset. */
  demoSessions: SessionRecord[];
  sessionCount: number;
  demoSessionCount: number;
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
  demoSessions: SessionRecord[];
  patientRows: PatientReportRow[];
  totalSessions: number;
  demoSessionCount: number;
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

export interface ClinicalReportViewModel {
  presentation: ClinicalReportPresentation;
  loadState: ClinicalReportLoadState;
  exportState: ClinicalReportExportState;
  exportDisabled: boolean;
  retryVisible: boolean;
  exportError: string | null;
  filteredClients: ClientProfile[];
  interval: ReportInterval;
  intervalText: string;
  analytics: ClinicalReportAnalytics;
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
  demoSessions: SessionRecord[],
  interval: ReportInterval,
): PatientReportRow {
  const durations = sessions
    .map(session => numeric(session.durationSeconds, 0))
    .filter((value): value is number => value != null);
  const inZone = sessions
    .map(session => numeric(session.timeInZonePercent, 0, 100))
    .filter((value): value is number => value != null);
  const expected = client.isDemo ? null : expectedSessions(client, interval);
  return {
    client,
    sessions,
    demoSessions,
    sessionCount: sessions.length,
    demoSessionCount: demoSessions.length,
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
  options: { mode?: 'interval' | 'explicit-selection' } = {},
): ClinicalReportAnalytics {
  const clientIds = new Set(clients.map(client => client.id));
  const clientById = new Map(clients.map(client => [client.id, client]));
  const eligibleSessions = options.mode === 'explicit-selection'
    ? allSessions
        .filter(session => clientIds.has(session.patientId))
        .sort((a, b) => {
          const aTime = numeric(a.timestamp, 1) ?? Number.POSITIVE_INFINITY;
          const bTime = numeric(b.timestamp, 1) ?? Number.POSITIVE_INFINITY;
          return aTime - bTime;
        })
    : filterSessionsForReport(allSessions, interval, clientIds);
  const isSampleWorkspaceSession = (session: SessionRecord) => clientById.get(session.patientId)?.isDemo === true;
  const sessions = eligibleSessions.filter(session => !isSampleWorkspaceSession(session));
  const demoSessions = eligibleSessions.filter(session => session.isDemo === true || isSampleWorkspaceSession(session));
  const patientRows = clients.map(client => buildPatientRow(
    client,
    sessions.filter(session => session.patientId === client.id),
    demoSessions.filter(session => session.patientId === client.id),
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
  const clinicalClientCount = clients.filter(client => !client.isDemo).length;
  const expectedTotal = expectedValues.length === clinicalClientCount
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
    demoSessions,
    patientRows,
    totalSessions: sessions.length,
    demoSessionCount: demoSessions.length,
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

export function buildClinicalReportViewModel(input: {
  clients: ClientProfile[];
  sessions: SessionRecord[];
  cohortFilter: ClinicalReportCohortFilter;
  range: ClinicalReportRange;
  loadState: ClinicalReportLoadState;
  exportState?: ClinicalReportExportState;
  nowMs?: number;
  timeZone?: string;
}): ClinicalReportViewModel {
  const filteredClients = input.clients.filter(client => {
    if (input.cohortFilter === 'real') return !client.isDemo;
    if (input.cohortFilter === 'demo') return client.isDemo === true;
    return true;
  });
  const interval = createReportInterval(input.range, input.nowMs, input.timeZone);
  // Never expose stale/partial evidence while loading or after a rejected read.
  const analytics = buildClinicalReportAnalytics(
    filteredClients,
    input.loadState === 'ready' ? input.sessions : [],
    interval,
  );
  const exportState = input.exportState ?? 'idle';
  const hasActivity = analytics.totalSessions + analytics.demoSessionCount > 0;
  const presentation: ClinicalReportPresentation = input.loadState === 'loading'
    ? 'loading'
    : input.loadState === 'error'
      ? 'error'
      : hasActivity
        ? 'data'
        : 'empty';
  return {
    presentation,
    loadState: input.loadState,
    exportState,
    exportDisabled: input.loadState !== 'ready' || exportState === 'exporting',
    retryVisible: input.loadState === 'error',
    exportError: exportState === 'error' ? 'The PDF could not be created. Please try again.' : null,
    filteredClients,
    interval,
    intervalText: `${interval.startLabel} – ${interval.endLabel} (${interval.timeZone})`,
    analytics,
  };
}

export function formatMetric(value: number | null, suffix = ''): string {
  return value == null ? 'Unavailable' : `${value}${suffix}`;
}
