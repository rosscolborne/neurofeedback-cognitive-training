import type { SessionRecord } from '../../types';

export type ProgressPeriod = 'week' | 'month' | 'all';

export interface WeeklyActivityDay {
  label: string;
  dayOrdinal: number;
  isToday: boolean;
  completed: boolean;
}

export interface PatientProgressSummary {
  sessions: SessionRecord[];
  measuredSessions: SessionRecord[];
  sessionCount: number;
  totalDurationSeconds: number;
  averageTimeInZonePercent: number | null;
}

export interface ProgressChart {
  line: string;
  area: string;
  labels: string[];
  points: Array<{ x: number; y: number }>;
}

export type SessionLoadStatus = 'loading' | 'ready' | 'error';
export type SessionPresentationState = 'loading' | 'error' | 'empty' | 'data';
export type SessionExportState = 'loading' | 'unavailable' | 'empty' | 'ready';

export interface PatientProgressDisplayModel {
  presentation: SessionPresentationState;
  validSessions: SessionRecord[];
  periodSessions: SessionRecord[];
  summary: PatientProgressSummary | null;
  weeklyActivity: WeeklyActivityDay[] | null;
  activeStreak: number | null;
  chart: ProgressChart | null;
  earnedBadgeIds: Set<string> | null;
}

export interface PatientProgressDisplayOptions {
  period: ProgressPeriod;
  nowMs?: number;
  timeZone?: string;
  chartWidth: number;
  chartHeight: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = (timeZone?: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getSessionTimestamp(session: Partial<SessionRecord>): number | null {
  return typeof session.timestamp === 'number' && Number.isFinite(session.timestamp) && session.timestamp > 0
    ? session.timestamp
    : null;
}

export function getTimeInZonePercent(session: Partial<SessionRecord>): number | null {
  const value = session.timeInZonePercent;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function getDurationSeconds(session: Partial<SessionRecord>): number | null {
  const value = session.durationSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function localDayOrdinal(timestamp: number, timeZone?: string): number | null {
  if (!Number.isFinite(timestamp)) return null;
  try {
    const parts = dateFormatter(timeZone).formatToParts(new Date(timestamp));
    const year = Number(parts.find(part => part.type === 'year')?.value);
    const month = Number(parts.find(part => part.type === 'month')?.value);
    const day = Number(parts.find(part => part.type === 'day')?.value);
    if (![year, month, day].every(Number.isFinite)) return null;
    return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
  } catch {
    return null;
  }
}

export function filterSessionsByPeriod(
  sessions: SessionRecord[],
  period: ProgressPeriod,
  nowMs = Date.now(),
): SessionRecord[] {
  const cutoff = period === 'week'
    ? nowMs - 7 * DAY_MS
    : period === 'month'
      ? nowMs - 30 * DAY_MS
      : Number.NEGATIVE_INFINITY;

  return sessions
    .filter(session => {
      const timestamp = getSessionTimestamp(session);
      return timestamp != null && timestamp >= cutoff && timestamp <= nowMs;
    })
    .sort((a, b) => (getSessionTimestamp(a) ?? 0) - (getSessionTimestamp(b) ?? 0));
}

export function summarizeSessions(sessions: SessionRecord[]): PatientProgressSummary {
  const measuredSessions = sessions.filter(session => getTimeInZonePercent(session) != null);
  const totalDurationSeconds = sessions.reduce(
    (total, session) => total + (getDurationSeconds(session) ?? 0),
    0,
  );
  const averageTimeInZonePercent = measuredSessions.length === 0
    ? null
    : Math.round(
        measuredSessions.reduce((total, session) => total + (getTimeInZonePercent(session) ?? 0), 0)
          / measuredSessions.length,
      );

  return {
    sessions,
    measuredSessions,
    sessionCount: sessions.length,
    totalDurationSeconds,
    averageTimeInZonePercent,
  };
}

export function getSessionPresentationState(
  status: SessionLoadStatus,
  sessionCount: number,
): SessionPresentationState {
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'error';
  return sessionCount > 0 ? 'data' : 'empty';
}

export function getSessionExportState(presentation: SessionPresentationState): SessionExportState {
  if (presentation === 'loading') return 'loading';
  if (presentation === 'error') return 'unavailable';
  if (presentation === 'empty') return 'empty';
  return 'ready';
}

/**
 * Complete evidence-state boundary for patient progress UI. Until a read
 * resolves successfully, evidence-derived fields are null rather than empty so
 * the UI cannot imply that activity, measurements, or awards are absent.
 */
export function buildPatientProgressDisplayModel(
  status: SessionLoadStatus,
  sessions: SessionRecord[],
  options: PatientProgressDisplayOptions,
): PatientProgressDisplayModel {
  if (status !== 'ready') {
    return {
      presentation: status,
      validSessions: [],
      periodSessions: [],
      summary: null,
      weeklyActivity: null,
      activeStreak: null,
      chart: null,
      earnedBadgeIds: null,
    };
  }

  const nowMs = options.nowMs ?? Date.now();
  const validSessions = filterSessionsByPeriod(sessions, 'all', nowMs);
  const periodSessions = filterSessionsByPeriod(validSessions, options.period, nowMs);
  return {
    presentation: getSessionPresentationState('ready', validSessions.length),
    validSessions,
    periodSessions,
    summary: summarizeSessions(periodSessions),
    weeklyActivity: getWeeklyActivity(validSessions, nowMs, options.timeZone),
    activeStreak: computeActiveStreak(validSessions, nowMs, options.timeZone),
    chart: generateTimeInZoneChart(
      periodSessions,
      options.chartWidth,
      options.chartHeight,
      options.timeZone,
    ),
    earnedBadgeIds: getEarnedBadgeIds(validSessions, options.timeZone),
  };
}

/**
 * Product rule: an active streak is one or more consecutive local calendar days
 * ending today or yesterday. Multiple sessions on one day count once.
 */
export function computeActiveStreak(
  sessions: SessionRecord[],
  nowMs = Date.now(),
  timeZone?: string,
): number {
  const today = localDayOrdinal(nowMs, timeZone);
  if (today == null) return 0;
  const days = [...new Set(
    sessions
      .map(session => getSessionTimestamp(session))
      .filter((timestamp): timestamp is number => timestamp != null && timestamp <= nowMs)
      .map(timestamp => localDayOrdinal(timestamp, timeZone))
      .filter((day): day is number => day != null),
  )].sort((a, b) => b - a);

  if (days.length === 0 || days[0] < today - 1) return 0;
  let streak = 1;
  for (let index = 1; index < days.length && days[index] === days[index - 1] - 1; index += 1) {
    streak += 1;
  }
  return streak;
}

export function getWeeklyActivity(
  sessions: SessionRecord[],
  nowMs = Date.now(),
  timeZone?: string,
): WeeklyActivityDay[] {
  const today = localDayOrdinal(nowMs, timeZone);
  if (today == null) return [];
  const todayWeekday = new Date(today * DAY_MS).getUTCDay();
  const weekStart = today - todayWeekday;
  const completedDays = new Set(
    sessions
      .map(session => getSessionTimestamp(session))
      .filter((timestamp): timestamp is number => timestamp != null && timestamp <= nowMs)
      .map(timestamp => localDayOrdinal(timestamp, timeZone))
      .filter((day): day is number => day != null && day >= weekStart && day <= today),
  );

  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => {
    const dayOrdinal = weekStart + index;
    return {
      label,
      dayOrdinal,
      isToday: dayOrdinal === today,
      completed: completedDays.has(dayOrdinal),
    };
  });
}

export function generateTimeInZoneChart(
  sessions: SessionRecord[],
  width: number,
  height: number,
  timeZone?: string,
): ProgressChart {
  const measured = sessions.filter(session => getTimeInZonePercent(session) != null);
  if (measured.length === 0) return { line: '', area: '', labels: [], points: [] };
  const scores = measured.map(session => getTimeInZonePercent(session) as number);
  const minimum = Math.max(0, Math.min(...scores) - 10);
  const maximum = Math.min(100, Math.max(...scores) + 10);
  const range = Math.max(1, maximum - minimum);
  const padding = { left: 20, right: 10, top: 20, bottom: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = measured.map((session, index) => {
    const value = getTimeInZonePercent(session) as number;
    return {
      x: padding.left + (measured.length === 1 ? chartWidth / 2 : (index / (measured.length - 1)) * chartWidth),
      y: padding.top + chartHeight - ((value - minimum) / range) * chartHeight,
    };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${points.at(-1)?.x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
  const labelCount = Math.min(4, measured.length);
  const labels = Array.from({ length: labelCount }, (_, index) => {
    const sessionIndex = Math.floor(index * (measured.length - 1) / Math.max(1, labelCount - 1));
    const timestamp = getSessionTimestamp(measured[sessionIndex]) as number;
    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  });
  return { line, area, labels, points };
}

function hasSevenDayRun(sessions: SessionRecord[], timeZone?: string): boolean {
  const days = [...new Set(
    sessions
      .map(session => getSessionTimestamp(session))
      .filter((timestamp): timestamp is number => timestamp != null)
      .map(timestamp => localDayOrdinal(timestamp, timeZone))
      .filter((day): day is number => day != null),
  )].sort((a, b) => a - b);
  let run = days.length > 0 ? 1 : 0;
  for (let index = 1; index < days.length; index += 1) {
    run = days[index] === days[index - 1] + 1 ? run + 1 : 1;
    if (run >= 7) return true;
  }
  return run >= 7;
}

/** Badge definitions are static content; awards are recomputed from qualifying sessions. */
export function getEarnedBadgeIds(sessions: SessionRecord[], timeZone?: string): Set<string> {
  const earned = new Set<string>();
  if (sessions.some(session => getSessionTimestamp(session) != null)) earned.add('first-light');
  if (hasSevenDayRun(sessions, timeZone)) earned.add('steady-state');
  if (sessions.some(session => session.protocol === 'theta-beta-ratio' && (getTimeInZonePercent(session) ?? -1) >= 80)) {
    earned.add('deep-focus');
  }
  // Sessions do not persist alpha-dominance duration, garden stage evidence, or
  // visited skyline biomes. Their corresponding badges therefore remain locked.
  return earned;
}
