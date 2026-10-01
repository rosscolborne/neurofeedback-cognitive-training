import { useEffect, useMemo, useState } from 'react';
import type { LocalDate, LocalDateRange, StatsSummary, UserProfile, WeeklyGoal } from '@nfct/shared';
import type { DocumentRead } from '../firestore/reads';
import type { GameSessionHistoryPage, GameSessionRepository } from '../repositories/gameSessionRepository';
import type { ProfileRepository } from '../repositories/profileRepository';
import type { AchievementsRead, DailyStatsRead, StatsRepository } from '../repositories/statsRepository';
import { deviceTimezone } from '../games/mentalMath/sessionDraft';
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
}

export interface OverviewClock {
  /** Wall-clock milliseconds. */
  readonly now: () => number;
  /** This device's IANA time zone. */
  readonly deviceZone: () => string;
  /** Calls `listener` whenever the app comes back to the foreground; returns the unsubscribe. */
  readonly onForeground: (listener: () => void) => () => void;
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
};

type Keyed<T> = { readonly key: string; readonly value: Loaded<T> };

/** A subscription's latest value for `key`; loading until the subscription for that key has answered. */
function useKeyedSubscription<T>(
  key: string | null,
  subscribe: (onNext: (value: T) => void, onError: () => void) => () => void,
): Loaded<T> {
  const [state, setState] = useState<Keyed<T> | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    const fail = () => setState({ key, value: { status: 'unavailable' } });
    let stop: () => void = () => {};
    try {
      stop = subscribe((value) => setState({ key, value: { status: 'ready', value } }), fail);
    } catch {
      // Not signed in, or a caller error the repository refused: nothing to show.
      fail();
    }
    return () => stop();
    // Deliberately keyed: `subscribe` is rebuilt every render, and the key names everything it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key !== null && state?.key === key ? state.value : LOADING;
}

// One profile read per player and repository: it only supplies the time zone
// and the weekly goal, and the inherited sign-up's profile documents are not
// consumer profiles, so every read of one reports it as unreadable. Failed
// reads are not kept, so the next screen tries again.
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

/** The newest runs of a game, live (Home's recent activity). */
export function useRecentRuns(
  playerId: string,
  gameSessions: Pick<GameSessionRepository, 'subscribeToGameSessionHistory'>,
  gameId: string,
  pageSize: number,
): Loaded<GameSessionHistoryPage> {
  return useKeyedSubscription<GameSessionHistoryPage>(`${playerId}:runs:${gameId}:${pageSize}`, (onNext, onError) =>
    gameSessions.subscribeToGameSessionHistory({ gameId, pageSize }, onNext, onError));
}
