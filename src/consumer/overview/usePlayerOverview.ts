import { useEffect, useMemo, useState } from 'react';
import type { LocalDate, LocalDateRange, StatsSummary, UserProfile, WeeklyGoal } from '@nfct/shared';
import type { DocumentRead } from '../firestore/reads';
import { subscribeWithRetry } from '../firestore/retryingSubscription';
import type { GameSessionHistoryPage, GameSessionRepository } from '../repositories/gameSessionRepository';
import type { ProfileRepository } from '../repositories/profileRepository';
import type { AchievementsRead, DailyStatsRead, StatsRepository } from '../repositories/statsRepository';
import { deviceTimezone } from '../games/common/sessionEnvironment';
import { historyRow, isTimed90, type HistoryRow } from '../games/mentalMath/progressSummary';
import { periodRange, playerToday, playerWeeklyGoal, playerZone, type ActivityPeriod, type PlayerZone } from './overviewModel';

// The reads behind Home and Progress (NFCT-13 part 2): live subscriptions to
// the player's own server-maintained aggregates, one read of the profile (time
// zone and weekly goal) and, for Home, the newest runs. Every read is keyed by
// the player, so a stale value is never shown for another account.

export type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'unavailable' };

const LOADING: Loaded<never> = { status: 'loading' };

export interface OverviewSources {
  readonly stats: Pick<StatsRepository, 'subscribeToSummary' | 'subscribeToDailyStats' | 'subscribeToAchievements'>;
  readonly profile: Pick<ProfileRepository, 'getProfile'>;
  /** The newest runs: whether the player has played at all, and Home's recent runs. */
  readonly gameSessions: Pick<GameSessionRepository, 'subscribeToGameSessionHistory'>;
}

export interface OverviewClock {
  /** Wall-clock milliseconds. */
  readonly now: () => number;
  /** This device's IANA time zone. */
  readonly deviceZone: () => string;
  /** Calls `listener` whenever the app comes back to the foreground; returns the unsubscribe. */
  readonly onForeground: (listener: () => void) => () => void;
  /** Whether the device reports a network connection (a hint: it can be online and still unable to reach the server). */
  readonly isOnline: () => boolean;
}

export const browserOverviewClock: OverviewClock = {
  now: () => Date.now(),
  deviceZone: deviceTimezone,
  onForeground: (listener) => {
    // No document outside a browser (server rendering, unit tests): there is no foreground to follow.
    if (typeof document === 'undefined') return () => {};
    const onVisible = () => { if (document.visibilityState === 'visible') listener(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  },
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
};

type Keyed<T> = { readonly key: string; readonly value: Loaded<T> };

/**
 * A subscription's latest value for `key`: loading until the subscription for
 * that key has answered, unavailable after a failure until it recovers (it
 * re-subscribes with backoff; a synchronous refusal, such as signed out, stays
 * unavailable).
 */
function useKeyedSubscription<T>(
  key: string | null,
  subscribe: (onNext: (value: T) => void, onError: (error: Error) => void) => () => void,
): Loaded<T> {
  const [state, setState] = useState<Keyed<T> | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    return subscribeWithRetry(
      subscribe,
      (value) => setState({ key, value: { status: 'ready', value } }),
      () => setState({ key, value: { status: 'unavailable' } }),
    );
    // Deliberately keyed: `subscribe` is rebuilt every render, and the key names everything it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key !== null && state?.key === key ? state.value : LOADING;
}

// One profile read per player and repository: it only supplies the time zone
// and the weekly goal. Failed reads are not kept, so the next screen tries
// again.
const profileReads = new WeakMap<object, Map<string, Promise<DocumentRead<UserProfile>>>>();

function readProfileOnce(profile: OverviewSources['profile'], playerId: string): Promise<DocumentRead<UserProfile>> {
  let reads = profileReads.get(profile);
  if (!reads) {
    reads = new Map();
    profileReads.set(profile, reads);
  }
  const cached = reads.get(playerId);
  if (cached) return cached;
  const read = profile.getProfile();
  reads.set(playerId, read);
  read.catch(() => { reads.delete(playerId); });
  return read;
}

function useProfile(profile: OverviewSources['profile'], playerId: string): Loaded<DocumentRead<UserProfile>> {
  const [state, setState] = useState<Keyed<DocumentRead<UserProfile>> | null>(null);
  useEffect(() => {
    let active = true;
    readProfileOnce(profile, playerId).then(
      (value) => { if (active) setState({ key: playerId, value: { status: 'ready', value } }); },
      () => { if (active) setState({ key: playerId, value: { status: 'unavailable' } }); },
    );
    return () => { active = false; };
  }, [profile, playerId]);
  return state?.key === playerId ? state.value : LOADING;
}

/** Wall-clock time, refreshed each minute and when the app comes back to the foreground, so "today" moves at midnight. */
function useNow(clock: OverviewClock): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const tick = () => setNow(clock.now());
    const interval = setInterval(tick, 60_000);
    const stopForeground = clock.onForeground(tick);
    return () => {
      clearInterval(interval);
      stopForeground();
    };
  }, [clock]);
  return now;
}

export interface PlayerOverview {
  readonly zone: PlayerZone;
  /**
   * Whether today is known yet: 'loading' until the profile read has answered
   * (the zone and goal are then final); 'unknown-zone' when the zone is not one
   * this runtime knows, so the streak's liveness and the calendar views
   * cannot be shown.
   */
  readonly todayState: 'loading' | 'known' | 'unknown-zone';
  /** Today in the player's zone; null unless todayState is 'known'. */
  readonly today: LocalDate | null;
  readonly goal: WeeklyGoal | null;
  readonly summary: Loaded<DocumentRead<StatsSummary>>;
  readonly achievements: Loaded<AchievementsRead>;
  /** The activity period's range, or null while today is unknown. */
  readonly range: LocalDateRange | null;
  readonly days: Loaded<DailyStatsRead>;
}

export function usePlayerOverview(
  playerId: string,
  sources: OverviewSources,
  period: ActivityPeriod,
  clock: OverviewClock = browserOverviewClock,
): PlayerOverview {
  const now = useNow(clock);
  const profile = useProfile(sources.profile, playerId);
  const profileRead = profile.status === 'ready' ? profile.value : null;
  const zone = useMemo(() => playerZone(profileRead, clock.deviceZone()), [profileRead, clock]);
  // Today waits for the profile, so a player with a profile zone never sees a day from the device's zone first.
  const profileSettled = profile.status !== 'loading';
  const today = profileSettled ? playerToday(zone, now) : null;
  const range = today === null ? null : periodRange(period, today);
  const rangeKey = range === null ? null : `${range.from}..${range.to}`;
  const { stats } = sources;

  const summary = useKeyedSubscription<DocumentRead<StatsSummary>>(`${playerId}:summary`, (onNext, onError) =>
    stats.subscribeToSummary(onNext, onError));
  const achievements = useKeyedSubscription<AchievementsRead>(`${playerId}:achievements`, (onNext, onError) =>
    stats.subscribeToAchievements(onNext, onError));
  const days = useKeyedSubscription<DailyStatsRead>(rangeKey === null ? null : `${playerId}:days:${rangeKey}`, (onNext, onError) =>
    stats.subscribeToDailyStats(range!, onNext, onError));

  return {
    zone,
    today,
    goal: playerWeeklyGoal(profileRead),
    todayState: !profileSettled ? 'loading' : today === null ? 'unknown-zone' : 'known',
    summary,
    achievements,
    range,
    days,
  };
}

/** The newest runs of a game, or of every game when `gameId` is null, live (Home's recent activity; whether the player has played). */
export function useRecentRuns(
  playerId: string,
  gameSessions: Pick<GameSessionRepository, 'subscribeToGameSessionHistory'>,
  gameId: string | null,
  pageSize: number,
): Loaded<GameSessionHistoryPage> {
  return useKeyedSubscription<GameSessionHistoryPage>(`${playerId}:runs:${gameId ?? '*'}:${pageSize}`, (onNext, onError) =>
    gameSessions.subscribeToGameSessionHistory(gameId === null ? { pageSize } : { gameId, pageSize }, onNext, onError));
}

/**
 * What the screens can say about the player's stats, before any figure is shown:
 * - 'stats': a readable summary;
 * - 'new': the server has no summary and the player has no runs of any game;
 * - 'checking': no summary yet, and a run trusted scoring has not confirmed, briefly (see PENDING_RESULT_GRACE_MS);
 * - 'delayed': no summary yet, and a run has waited for its result past that grace, or scoring has recorded a delay:
 *   the result may be a long way off (on a backend without trusted scoring, it never comes), so this is not loading;
 * - 'catching-up': no summary, though every run is confirmed: none counted (only invalid runs), so the next counted run starts them;
 * - 'offline': no summary in this device's cache and no connection, so nothing can be said yet;
 * - 'unavailable': the summary or the runs could not be read.
 * A summary missing from the cache while the device reports a connection is still loading: the
 * server's answer usually follows at once, and a player is never told they are offline, or new, in between.
 */
export type StatsPhase = 'loading' | 'stats' | 'new' | 'checking' | 'delayed' | 'catching-up' | 'offline' | 'unavailable';

/**
 * How long the stats show as loading while a run waits for its result (NFCT-83).
 * Trusted scoring usually answers within seconds; past this the screens say the
 * figures are not ready instead of loading indefinitely.
 */
export const PENDING_RESULT_GRACE_MS = 20_000;

/** A run trusted scoring has not confirmed yet: the stats may be about to change. */
function awaitsResult(row: HistoryRow): boolean {
  return row.state === 'on-device' || row.state === 'checking' || row.state === 'delayed';
}

/**
 * When the stats stop showing as loading for the runs still waiting for a
 * result: the grace after the oldest of them ended, or after the screen opened
 * if that is sooner, so a device clock behind the run's never holds the wait
 * open. Null when no run is waiting.
 */
export function pendingDeadline(rows: readonly HistoryRow[], openedAtMs: number): number | null {
  const waiting = rows.filter(awaitsResult);
  if (waiting.length === 0) return null;
  return Math.min(openedAtMs, ...waiting.map((row) => row.endedAtMs)) + PENDING_RESULT_GRACE_MS;
}

/** The Mental Math rows of a page of runs, or null while it loads; a page that failed is null too (see statsPhase). */
export function runRows(runs: Loaded<GameSessionHistoryPage>): HistoryRow[] | null {
  return runs.status === 'ready' ? runs.value.entries.filter(isTimed90).map(historyRow) : null;
}

/** The rows of a page of runs of every game (NFCT-93), or null while it loads or after it failed. */
export function playedRows(runs: Loaded<GameSessionHistoryPage>): HistoryRow[] | null {
  return runs.status === 'ready' ? runs.value.entries.map(historyRow) : null;
}

/** `runs`: the newest runs of every game (useRecentRuns with no game). */
export function statsPhase(
  overview: Pick<PlayerOverview, 'summary' | 'todayState'>,
  runs: Loaded<GameSessionHistoryPage>,
  online: boolean,
  nowMs: number,
  openedAtMs: number,
): StatsPhase {
  const { summary, todayState } = overview;
  if (summary.status === 'loading' || todayState === 'loading') return 'loading';
  if (summary.status === 'unavailable') return 'unavailable';
  const read = summary.value;
  if (read.status === 'readable') return 'stats';
  if (read.status === 'unreadable') return 'unavailable';
  // No summary. Offline or unreadable runs first: neither says whether the player is new.
  if (read.fromCache) return online ? 'loading' : 'offline';
  if (runs.status === 'loading') return 'loading';
  if (runs.status === 'unavailable') return 'unavailable';
  // A run of any game means the player has played (NFCT-93).
  const rows = playedRows(runs)!;
  if (rows.length === 0) return 'new';
  if (rows.some((row) => row.state === 'delayed')) return 'delayed';
  const deadline = pendingDeadline(rows, openedAtMs);
  if (deadline === null) return 'catching-up';
  return nowMs >= deadline ? 'delayed' : 'checking';
}

/** statsPhase for a screen, which moves from 'checking' to 'delayed' by itself when the grace runs out. */
export function useStatsPhase(
  overview: Pick<PlayerOverview, 'summary' | 'todayState'>,
  runs: Loaded<GameSessionHistoryPage>,
  clock: OverviewClock,
): StatsPhase {
  const [openedAtMs] = useState(() => clock.now());
  const [nowMs, setNowMs] = useState(openedAtMs);
  const rows = playedRows(runs);
  const deadline = rows === null ? null : pendingDeadline(rows, openedAtMs);
  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setTimeout(() => setNowMs(Math.max(clock.now(), deadline)), Math.max(0, deadline - clock.now()));
    return () => clearTimeout(timer);
  }, [deadline, clock]);
  return statsPhase(overview, runs, clock.isOnline(), nowMs, openedAtMs);
}
