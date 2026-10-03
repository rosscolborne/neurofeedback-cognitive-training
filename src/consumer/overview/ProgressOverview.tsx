import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { addDays, mentalMath, type LocalDate } from '@nfct/shared';
import { gameSessionRepository, profileRepository, statsRepository } from '../repositories';
import { formatPlayTime } from '../games/mentalMath/progressSummary';
import {
  achievementLists,
  daysText,
  activityView,
  formatLocalDate,
  goalProgress,
  streakView,
  weekdayLabel,
  type ActivityDay,
  type ActivityPeriod,
} from './overviewModel';
import { AchievementRow, GoalMeter } from './OverviewParts';
import {
  browserOverviewClock,
  statsPhase,
  usePlayerOverview,
  useRecentRuns,
  type OverviewClock,
  type OverviewSources,
  type StatsPhase,
} from './usePlayerOverview';
import '../games/mentalMath/mentalMath.css';
import './overview.css';

// Progress's game performance (NFCT-13 part 2): all-time figures and the streak (stats/summary), the
// games (per-game progress, NFCT-22), this week's or this month's activity
// from at most 31 dailyStats documents, and every achievement in the
// catalogue, earned or not yet. Nothing here is EEG-derived, and no domain
// index is shown (NFCT-26).

const defaultSources: OverviewSources = { stats: statsRepository, profile: profileRepository, gameSessions: gameSessionRepository };

const numberFormat = new Intl.NumberFormat();

export interface ProgressOverviewProps {
  readonly playerId: string;
  /** Opens Mental Math's start-level picker. */
  readonly onPlay: () => void;
  /** The per-game entries (Mental Math's progress card). */
  readonly games: React.ReactNode;
  /** A section to scroll to and focus once the screen has loaded (Home's "See all achievements"). */
  readonly focusSection?: 'achievements' | null;
  /** Called once `focusSection` has been focused. */
  readonly onSectionFocused?: () => void;
  readonly sources?: OverviewSources;
  readonly clock?: OverviewClock;
}

/** Runs read to tell a new player from one whose stats are not ready yet (the same check as Home's). */
const NEWEST_RUNS = 3;

/**
 * What a section says instead of figures that would mislead: zeros and "not
 * earned yet" for a player whose runs the aggregates do not include yet.
 * Null when the section can show its own data.
 */
function pendingNote(phase: StatsPhase, section: 'figures' | 'activity' | 'achievements'): string | null {
  const subject = section === 'figures' ? 'Your streak and all-time figures' : section === 'activity' ? 'Your activity' : 'Your achievements';
  switch (phase) {
    case 'loading': return null;
    case 'offline': return `${subject} will show when you’re back online.`;
    // A run whose result is still pending: the section shows its loading line and updates when the result lands.
    case 'checking': return null;
    case 'catching-up': return `${subject} ${section === 'activity' ? 'catches' : 'catch'} up after your next finished run.`;
    case 'unavailable': return `${subject} couldn’t be loaded right now.`;
    default: return null;
  }
}

function dayLabel(day: ActivityDay, today: LocalDate): string {
  const when = `${formatLocalDate(day.date, today)}${day.isToday ? ' (today)' : ''}`;
  if (day.isFuture) return `${when}: still to come`;
  if (day.sessions === 0) return `${when}: no runs`;
  const finished = day.sessionsCompleted === 1 ? '1 finished run' : `${day.sessionsCompleted} finished runs`;
  return `${when}: ${finished}, ${formatPlayTime(day.activeMs)} played`;
}

/** The empty state's Play button, which gets focus back when the game closes (NFCT-52). */
export const PROGRESS_PLAY_BUTTON_ID = 'ov-progress-play';

export const ProgressOverview: React.FC<ProgressOverviewProps> = ({
  playerId,
  onPlay,
  games,
  focusSection = null,
  onSectionFocused,
  sources = defaultSources,
  clock = browserOverviewClock,
}) => {
  const [period, setPeriod] = useState<ActivityPeriod>('week');
  const overview = usePlayerOverview(playerId, sources, period, clock);
  const { today, todayState, summary: summaryState, days, achievements, range, goal } = overview;
  const summaryRead = summaryState.status === 'ready' ? summaryState.value : null;
  // The figures wait for today, so the current streak is never shown in the wrong zone first.
  const summary = summaryRead?.status === 'readable' && todayState !== 'loading' ? summaryRead.data : null;
  const view = summary ? streakView(summary.streak, today) : null;
  const activity = useMemo(
    () => (days.status === 'ready' && today !== null && range !== null ? activityView(days.value.days, range, today) : null),
    [days, today, range],
  );
  const goalNow = period === 'week' && activity !== null && today !== null && days.status === 'ready'
    ? goalProgress(goal, days.value.days, today) : null;
  const lists = useMemo(
    () => (achievements.status === 'ready' ? achievementLists(achievements.value.achievements) : null),
    [achievements],
  );
  // Whether the player has played at all: a missing summary alone does not say (runs scored before the
  // aggregates existed have none until the next run rebuilds it, and offline it may just not be cached).
  const newest = useRecentRuns(playerId, sources.gameSessions, mentalMath.GAME_ID, NEWEST_RUNS);
  const phase = statsPhase(overview, newest, clock.isOnline());
  const noRunsYet = phase === 'new';
  // The activity and achievements show their own data only once the stats are known to include every
  // run; until then each says why it has nothing to show.
  const showsData = phase === 'stats' || phase === 'new';
  // Focused only once everything above it has loaded, so the section does not move after the scroll.
  const achievementsHeading = useRef<HTMLHeadingElement>(null);
  const settled = phase !== 'loading' && (!showsData
    || (achievements.status !== 'loading' && (todayState === 'unknown-zone' || days.status !== 'loading')));
  useEffect(() => {
    if (focusSection !== 'achievements' || !settled) return;
    achievementsHeading.current?.scrollIntoView({ block: 'start' });
    achievementsHeading.current?.focus({ preventScroll: true });
    onSectionFocused?.();
  }, [focusSection, settled, onSectionFocused]);

  const weekdayHeader = useMemo(() => (range ? Array.from({ length: 7 }, (_, index) => {
    const first = activity ? addDays(range.from, -activity.leadingBlanks) : range.from;
    return weekdayLabel(addDays(first, index));
  }) : []), [range, activity]);

  return (
    <div className="ov-stack" data-overview="progress">
      {noRunsYet ? (
        <section className="ov-card ov-empty" aria-labelledby="ov-progress-empty-title" data-overview="progress-empty">
          <h2 id="ov-progress-empty-title" className="ov-card-title">No runs yet</h2>
          <p className="ov-help">Play Mental Math to start your streak, fill in your activity and earn achievements.</p>
          <button id={PROGRESS_PLAY_BUTTON_ID} type="button" className="btn btn-primary" onClick={onPlay}>
            <Play size={18} fill="currentColor" aria-hidden="true" /> Play Mental Math
          </button>
        </section>
      ) : (
        <section className="ov-card" aria-labelledby="ov-alltime-title" data-overview="all-time">
          <h2 id="ov-alltime-title" className="ov-card-title">All time</h2>
          {summary ? (
            <dl className="ov-kpis">
              <div>
                <dt>Current streak</dt>
                <dd data-overview="current-streak">{view?.kind === 'status' ? daysText(view.status.current) : view?.kind === 'none' ? daysText(0) : '—'}</dd>
              </div>
              <div>
                <dt>Longest streak</dt>
                <dd data-overview="longest-streak">{daysText(summary.streak.longest)}</dd>
              </div>
              <div>
                <dt>Runs finished</dt>
                <dd data-overview="runs-finished">{numberFormat.format(summary.sessionsCompleted)}</dd>
              </div>
              <div>
                <dt>Time played</dt>
                <dd data-overview="time-played">{formatPlayTime(summary.activeMs)}</dd>
              </div>
            </dl>
          ) : (
            <p className="ov-help" data-overview="all-time-note">{pendingNote(phase, 'figures') ?? 'Loading your progress…'}</p>
          )}
          {view?.kind === 'today-unknown' && (
            <p className="ov-help">{`Your current streak can’t be shown because your time zone (${overview.zone.zone}) isn’t recognised.`}</p>
          )}
          <p className="ov-help">A streak counts training days in a row: days with at least one finished run.</p>
        </section>
      )}

      {games}

      <section className="ov-card" aria-labelledby="ov-activity-title" data-overview="activity">
        <h2 id="ov-activity-title" className="ov-card-title">Activity</h2>
        <div className="ov-segmented" role="group" aria-label="Activity period">
          {(['week', 'month'] as const).map((value) => (
            <button key={value} type="button" className="ov-segment" aria-pressed={period === value} onClick={() => setPeriod(value)}>
              {value === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
        {!showsData ? (
          <p className="ov-help" data-overview="activity-note">{pendingNote(phase, 'activity') ?? 'Loading your activity…'}</p>
        ) : todayState === 'unknown-zone' ? (
          <p className="ov-help">{`Your activity can’t be shown because your time zone (${overview.zone.zone}) isn’t recognised.`}</p>
        ) : activity === null || today === null ? (
          <p className="ov-help">{days.status === 'unavailable' ? 'Your activity couldn’t be loaded right now.' : 'Loading your activity…'}</p>
        ) : (
          <>
            {activity.totals.sessions === 0 ? (
              <p className="ov-help" data-overview="activity-totals">{period === 'week' ? 'No runs yet this week.' : 'No runs yet this month.'}</p>
            ) : (
              <dl className="ov-totals" data-overview="activity-totals">
                <div><dt>Finished runs</dt><dd data-overview="period-runs">{numberFormat.format(activity.totals.sessionsCompleted)}</dd></div>
                <div><dt>Time played</dt><dd data-overview="period-time">{formatPlayTime(activity.totals.activeMs)}</dd></div>
                <div><dt>Active days</dt><dd data-overview="period-active-days">{activity.totals.activeDays}</dd></div>
              </dl>
            )}
            <div>
              <div className="ov-cal-head" aria-hidden="true">
                {weekdayHeader.map((label) => <span key={label}>{label}</span>)}
              </div>
              <ol className="ov-cal" aria-label={period === 'week' ? 'This week, day by day' : 'This month, day by day'} style={{ marginTop: 'var(--space-1)' }}>
                {Array.from({ length: activity.leadingBlanks }, (_, index) => <li key={`blank-${index}`} aria-hidden="true" />)}
                {activity.days.map((day) => {
                  const label = dayLabel(day, today);
                  return (
                    <li
                      key={day.date}
                      className="ov-cal-day"
                      data-active={day.active}
                      data-today={day.isToday}
                      data-future={day.isFuture}
                      data-date={day.date}
                      title={label}
                    >
                      <span aria-hidden="true">{day.dayOfMonth}</span>
                      <span className="mm-visually-hidden">{label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <p className="ov-help">Highlighted days are active days: days with at least one finished run.</p>
            {goalNow && <GoalMeter progress={goalNow} />}
          </>
        )}
      </section>

      <section className="ov-card" aria-labelledby="ov-achievements-title" data-overview="achievements">
        <h2 id="ov-achievements-title" ref={achievementsHeading} tabIndex={-1} className="ov-card-title ov-scroll-target">Achievements</h2>
        {!showsData && <p className="ov-help" data-overview="achievements-note">{pendingNote(phase, 'achievements') ?? 'Loading your achievements…'}</p>}
        {showsData && achievements.status === 'loading' && <p className="ov-help">Loading your achievements…</p>}
        {showsData && achievements.status === 'unavailable' && <p className="ov-help">Your achievements couldn’t be loaded right now.</p>}
        {showsData && lists && (
          <>
            <p className="ov-help" data-overview="achievement-count">{lists.earned.length} of {lists.total} earned</p>
            {lists.earned.length > 0 && (
              <>
                <h3 className="ov-subheading">Earned</h3>
                <ul className="ov-achievements" aria-label="Earned achievements, newest first">
                  {lists.earned.map((item) => <AchievementRow key={item.definition.id} item={item} today={today} />)}
                </ul>
              </>
            )}
            {lists.notYet.length > 0 && (
              <>
                <h3 className="ov-subheading">Not earned yet</h3>
                <ul className="ov-achievements" aria-label="Achievements not earned yet">
                  {lists.notYet.map((item) => <AchievementRow key={item.definition.id} item={item} today={today} showStatus={false} />)}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
};
