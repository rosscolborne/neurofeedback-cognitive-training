import React, { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { addDays, type LocalDate } from '@nfct/shared';
import { profileRepository, statsRepository } from '../repositories';
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
import { browserOverviewClock, usePlayerOverview, type OverviewClock, type OverviewSources } from './usePlayerOverview';
import '../games/mentalMath/mentalMath.css';
import './overview.css';

// Progress's game performance (NFCT-13 part 2), ahead of the optional
// neurofeedback history: all-time figures and the streak (stats/summary), the
// games (per-game progress, NFCT-22), this week's or this month's activity
// from at most 31 dailyStats documents, and every achievement in the
// catalogue, earned or not yet. Nothing here is EEG-derived, and no domain
// index is shown (NFCT-26).

const defaultSources: OverviewSources = { stats: statsRepository, profile: profileRepository };

const numberFormat = new Intl.NumberFormat();

export interface ProgressOverviewProps {
  readonly playerId: string;
  /** Opens Mental Math's start-level picker. */
  readonly onPlay: () => void;
  /** The per-game entries (Mental Math's progress card). */
  readonly games: React.ReactNode;
  readonly sources?: OverviewSources;
  readonly clock?: OverviewClock;
}

function dayLabel(day: ActivityDay, today: LocalDate): string {
  const when = `${formatLocalDate(day.date, today)}${day.isToday ? ' (today)' : ''}`;
  if (day.isFuture) return `${when}: still to come`;
  if (day.sessions === 0) return `${when}: no runs`;
  const finished = day.sessionsCompleted === 1 ? '1 finished run' : `${day.sessionsCompleted} finished runs`;
  return `${when}: ${finished}, ${formatPlayTime(day.activeMs)} played`;
}

export const ProgressOverview: React.FC<ProgressOverviewProps> = ({
  playerId,
  onPlay,
  games,
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
  // No summary from the server: no run has counted yet (a missing summary served from this device's cache may only mean offline).
  const noRunsYet = summaryRead?.status === 'missing' && !summaryRead.fromCache;
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
          <button type="button" className="btn btn-primary" onClick={onPlay}>
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
            <p className="ov-help">
              {summaryState.status === 'loading' || todayState === 'loading' ? 'Loading your progress…'
                : summaryRead?.status === 'missing' ? 'Your progress will show when you’re back online.'
                  : 'Your progress couldn’t be loaded right now.'}
            </p>
          )}
          {view?.kind === 'today-unknown' && (
            <p className="ov-help">{`Your current streak can’t be shown because your time zone (${overview.zone.zone}) isn’t recognised.`}</p>
          )}
          <p className="ov-help">A streak counts training days in a row: days with a finished run that the server has checked.</p>
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
        {todayState === 'unknown-zone' ? (
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
        <h2 id="ov-achievements-title" className="ov-card-title">Achievements</h2>
        {achievements.status === 'loading' && <p className="ov-help">Loading your achievements…</p>}
        {achievements.status === 'unavailable' && <p className="ov-help">Your achievements couldn’t be loaded right now.</p>}
        {lists && (
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
