import React, { useMemo } from 'react';
import { Calculator, ChevronRight, Flame, Play } from 'lucide-react';
import { mentalMath, type LocalDate, type StatsSummary } from '@nfct/shared';
import { gameSessionRepository, profileRepository, statsRepository } from '../repositories';
import type { GameSessionRepository } from '../repositories/gameSessionRepository';
import { HistoryItem } from '../games/mentalMath/MentalMathProgress';
import { formatPlayTime, historyRow, isTimed90, type HistoryRow } from '../games/mentalMath/progressSummary';
import {
  achievementLists,
  daysText,
  formatLocalDate,
  goalProgress,
  streakNudge,
  streakStrip,
  streakView,
  type PlayerZone,
  type StreakNudge,
  type StreakView,
} from './overviewModel';
import { AchievementRow, GoalMeter, StreakStrip } from './OverviewParts';
import { browserOverviewClock, useRecentRuns, usePlayerOverview, type OverviewClock, type OverviewSources, type PlayerOverview } from './usePlayerOverview';
import '../games/mentalMath/mentalMath.css';
import './overview.css';

// Home's game content (NFCT-13 part 2): play first, then the streak and this
// week, recent achievements and recent runs, all from the player's own
// server-maintained aggregates. EEG plays no part in any of it.

/** Recent runs shown on Home. */
export const HOME_RECENT_RUNS = 3;

export interface HomeOverviewSources extends OverviewSources {
  readonly gameSessions: Pick<GameSessionRepository, 'subscribeToGameSessionHistory'>;
}

const defaultSources: HomeOverviewSources = { stats: statsRepository, profile: profileRepository, gameSessions: gameSessionRepository };

export interface HomeOverviewProps {
  /** The signed-in player: every read is keyed by it. */
  readonly playerId: string;
  /** Opens Mental Math's start-level picker. */
  readonly onPlay: () => void;
  /** Opens the Progress tab. */
  readonly onOpenProgress: () => void;
  /** Opens Mental Math's records and run history. */
  readonly onOpenGameProgress: () => void;
  readonly sources?: HomeOverviewSources;
  readonly clock?: OverviewClock;
}

/**
 * What Home can say about the player's stats:
 * - 'stats': a readable summary;
 * - 'new': no summary and no runs: nothing to show yet;
 * - 'catching-up': runs, but no summary yet (runs scored before streaks existed: the next run rebuilds it);
 * - 'offline': runs, and no summary in this device's cache;
 * - 'unavailable': the summary could not be read or shown.
 */
type StatsPhase = 'loading' | 'stats' | 'new' | 'catching-up' | 'offline' | 'unavailable';

function statsPhase(overview: PlayerOverview, runs: readonly HistoryRow[] | null): StatsPhase {
  const { summary } = overview;
  if (summary.status === 'loading' || runs === null || overview.todayState === 'loading') return 'loading';
  if (summary.status === 'unavailable') return 'unavailable';
  const read = summary.value;
  if (read.status === 'readable') return 'stats';
  if (read.status === 'unreadable') return 'unavailable';
  if (runs.length === 0) return 'new';
  return read.fromCache ? 'offline' : 'catching-up';
}

const INTRO = 'A 90-second arithmetic run that adapts as you play.';

function heroText(phase: StatsPhase, nudge: StreakNudge, view: StreakView | null): string {
  if (phase === 'new') return `${INTRO} Finish your first run to start a streak and earn your first achievement.`;
  if (phase !== 'stats') return INTRO;
  switch (nudge) {
    case 'start': return `${INTRO} Finish a run to start your streak.`;
    case 'keep': return view?.kind === 'status' ? `Play today to keep your ${view.status.current}-day streak going.` : INTRO;
    case 'trained-today': return 'You’ve trained today. Play again to chase a new best.';
    case 'restart': return 'Play today to start a new streak.';
    default: return INTRO;
  }
}

function zoneText(zone: PlayerZone): string {
  return zone.source === 'profile' ? `your profile’s time zone (${zone.zone})` : `this device’s time zone (${zone.zone})`;
}

const StreakCard: React.FC<{
  readonly phase: StatsPhase;
  readonly overview: PlayerOverview;
  readonly summary: StatsSummary | null;
  readonly view: StreakView | null;
  readonly checking: boolean;
}> = ({ phase, overview, summary, view, checking }) => {
  const { today, goal, days } = overview;
  const alive = view?.kind === 'status' && view.status.alive;
  const current = view?.kind === 'status' ? view.status.current : view?.kind === 'none' ? 0 : null;
  const longest = summary?.streak.longest ?? 0;
  const weekDays = days.status === 'ready' ? days.value.days : null;
  const goalNow = today !== null && weekDays !== null ? goalProgress(goal, weekDays, today) : null;
  const weekTotals = useMemo(() => weekDays?.reduce(
    (sum, day) => ({ runs: sum.runs + day.sessionsCompleted, activeMs: sum.activeMs + day.activeMs }),
    { runs: 0, activeMs: 0 },
  ) ?? null, [weekDays]);

  let caption: string;
  if (phase === 'loading') caption = 'Loading your streak…';
  else if (phase === 'unavailable') caption = 'Your streak couldn’t be loaded right now.';
  else if (phase === 'offline') caption = 'Your streak will show when you’re back online.';
  else if (phase === 'catching-up') caption = checking
    ? 'Your latest run is still being checked. Your streak and achievements update once it’s confirmed.'
    : 'Your streak and achievements catch up after your next finished run.';
  else if (view?.kind === 'today-unknown') caption = `Longest: ${daysText(view.longest)}. Your current streak can’t be shown because ${zoneText(overview.zone)} isn’t recognised.`;
  else if (view?.kind === 'status' && !view.status.alive) caption = `Last trained ${formatLocalDate(view.status.lastActiveDate!, today)}. Longest: ${daysText(longest)}.`;
  else if (view?.kind === 'status') {
    const { current: days, trainedToday } = view.status;
    const longestText = longest > days ? ` Longest: ${daysText(longest)}.` : '';
    caption = trainedToday ? `Come back tomorrow to make it ${daysText(days + 1)}.${longestText}` : `Last trained yesterday.${longestText}`;
  }
  else caption = 'A streak counts the days in a row you finish a run.';

  return (
    <section className="ov-card" aria-labelledby="ov-streak-title" data-overview="streak-card">
      <h2 id="ov-streak-title" className="ov-card-title">Your streak</h2>
      <div className="ov-streak-main" data-alive={alive}>
        <span className="ov-streak-icon" aria-hidden="true"><Flame size={24} /></span>
        <span className="ov-streak-figure">
          <span className="ov-streak-value" data-overview="streak">{current === null ? '—' : current}</span>
          <span className="ov-streak-unit">{current === 1 ? 'training day in a row' : 'training days in a row'}</span>
        </span>
      </div>
      <p className="ov-help" data-overview="streak-caption">{caption}</p>
      {phase === 'stats' && checking && (
        <p className="ov-status" role="status">Your latest run is still being checked. Your streak updates once it’s confirmed.</p>
      )}
      {phase === 'stats' && today !== null && summary && <StreakStrip days={streakStrip(summary.streak, today)} />}
      {phase === 'stats' && today !== null && (
        <div className="ov-divider" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p className="ov-help" data-overview="week-summary">
            {weekTotals === null ? (days.status === 'unavailable' ? 'This week’s activity couldn’t be loaded.' : 'Loading this week…')
              : weekTotals.runs === 0 && weekTotals.activeMs === 0 ? 'No runs yet this week.'
                : `This week: ${weekTotals.runs === 1 ? '1 finished run' : `${weekTotals.runs} finished runs`} · ${formatPlayTime(weekTotals.activeMs)} played`}
          </p>
          {goalNow && <GoalMeter progress={goalNow} />}
        </div>
      )}
    </section>
  );
};

export const HomeOverview: React.FC<HomeOverviewProps> = ({
  playerId,
  onPlay,
  onOpenProgress,
  onOpenGameProgress,
  sources = defaultSources,
  clock = browserOverviewClock,
}) => {
  const overview = usePlayerOverview(playerId, sources, 'week', clock);
  const recent = useRecentRuns(playerId, sources.gameSessions, mentalMath.GAME_ID, HOME_RECENT_RUNS);
  const rows = useMemo(
    () => (recent.status === 'ready' ? recent.value.entries.filter(isTimed90).map(historyRow) : recent.status === 'unavailable' ? [] : null),
    [recent],
  );
  const phase = statsPhase(overview, rows);
  const summary = overview.summary.status === 'ready' && overview.summary.value.status === 'readable' ? overview.summary.value.data : null;
  const view = summary ? streakView(summary.streak, overview.today) : null;
  const nudge = view ? streakNudge(view) : null;
  // A run this device saved that trusted scoring has not confirmed yet: the streak may be about to change.
  const checking = rows?.some((row) => row.state === 'on-device' || row.state === 'checking' || row.state === 'delayed') ?? false;
  const lists = useMemo(
    () => (overview.achievements.status === 'ready' ? achievementLists(overview.achievements.value.achievements) : null),
    [overview.achievements],
  );
  const shownAchievements = lists ? [...lists.earned.slice(0, 2), ...lists.notYet.slice(0, 1)] : [];
  const today: LocalDate | null = overview.today;

  return (
    <div className="ov-stack" data-overview="home">
      <section className="ov-card ov-hero" aria-labelledby="ov-play-title">
        <div className="ov-hero-top">
          <span className="ov-hero-icon" aria-hidden="true"><Calculator size={22} /></span>
          <div>
            <p className="ov-eyebrow">{phase === 'new' ? 'Start here' : 'Play now'}</p>
            <h2 id="ov-play-title" className="ov-hero-title font-display">Mental Math</h2>
          </div>
        </div>
        <p className="ov-hero-text" data-overview="hero-text">{heroText(phase, nudge, view)}</p>
        <button type="button" className="btn btn-primary ov-play" onClick={onPlay}>
          <Play size={18} fill="currentColor" aria-hidden="true" /> Play Mental Math
        </button>
      </section>

      {phase !== 'new' && (
        <StreakCard phase={phase} overview={overview} summary={summary} view={view} checking={checking} />
      )}

      {phase === 'stats' && (
        <section className="ov-card" aria-labelledby="ov-home-achievements-title" data-overview="home-achievements">
          <div className="ov-card-head">
            <h2 id="ov-home-achievements-title" className="ov-card-title">Achievements</h2>
            <button type="button" className="btn btn-ghost mm-link" onClick={onOpenProgress} aria-label="See all achievements">
              See all <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          {overview.achievements.status === 'loading' && <p className="ov-help">Loading your achievements…</p>}
          {overview.achievements.status === 'unavailable' && <p className="ov-help">Your achievements couldn’t be loaded right now.</p>}
          {lists && (
            <>
              <p className="ov-help" data-overview="achievement-count">{lists.earned.length} of {lists.total} earned</p>
              <ul className="ov-achievements" aria-label={lists.earned.length > 0 ? 'Recently earned, then next up' : 'Next up'}>
                {shownAchievements.map((item) => <AchievementRow key={item.definition.id} item={item} today={today} />)}
              </ul>
            </>
          )}
        </section>
      )}

      {rows !== null && rows.length > 0 && (
        <section className="ov-card" aria-labelledby="ov-recent-title" data-overview="recent-runs">
          <div className="ov-card-head">
            <h2 id="ov-recent-title" className="ov-card-title">Recent runs</h2>
            <button type="button" className="btn btn-ghost mm-link" onClick={onOpenGameProgress} aria-label="All Mental Math runs and records">
              All runs <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <ol className="mm-history" aria-label="Mental Math runs, newest first">
            {rows.map((row) => <HistoryItem key={row.id} row={row} />)}
          </ol>
        </section>
      )}
    </div>
  );
};
