import React from 'react';
import { Check, Flame, Lock, TrendingUp, Trophy } from 'lucide-react';
import type { AchievementCriterion, LocalDate, WeeklyGoalProgress } from '@nfct/shared';
import { formatLocalDate, goalText, type AchievementItem, type StreakStripDay } from './overviewModel';

// Pieces Home and Progress share (NFCT-13 part 2).

const CRITERION_ICONS: Record<AchievementCriterion['kind'], typeof Trophy> = {
  'valid-runs': Trophy,
  streak: Flame,
  'peak-level': TrendingUp,
};

export const AchievementRow: React.FC<{
  readonly item: AchievementItem;
  readonly today: LocalDate | null;
  /** Off where a heading already says the item is not earned yet. Earned items always show their date. */
  readonly showStatus?: boolean;
}> = ({ item, today, showStatus = true }) => {
  const { definition, earned } = item;
  const Icon = earned ? CRITERION_ICONS[definition.criterion.kind] : Lock;
  return (
    <li className="ov-ach" data-achievement={definition.id} data-earned={earned !== null}>
      <span className="ov-ach-icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="ov-ach-text">
        <span className="ov-ach-title">{definition.title}</span>
        <span className="ov-ach-desc">{definition.description}</span>
        {(earned || showStatus) && (
          <span className="ov-ach-meta" data-achievement-status>
            {earned ? `Earned ${formatLocalDate(earned.localDate, today)}` : 'Not earned yet'}
          </span>
        )}
      </span>
    </li>
  );
};

/** This week's training days: the days the streak counts. */
export const StreakStrip: React.FC<{ readonly days: readonly StreakStripDay[] }> = ({ days }) => (
  <ol className="ov-week" aria-label="This week’s training days">
    {days.map((day) => (
      <li
        key={day.date}
        className="ov-week-day"
        data-trained={day.trained}
        data-today={day.isToday}
        data-future={day.isFuture}
        data-date={day.date}
      >
        <span className="ov-week-dot" aria-hidden="true">{day.trained ? <Check size={16} strokeWidth={3} /> : null}</span>
        <span className="ov-week-label" aria-hidden="true">{day.label}</span>
        <span className="mm-visually-hidden">
          {day.label}{day.isToday ? ' (today)' : ''}: {day.trained ? 'trained' : day.isFuture ? 'still to come' : 'not trained'}
        </span>
      </li>
    ))}
  </ol>
);

/** Progress toward the profile's weekly goal over this week's dailyStats. */
export const GoalMeter: React.FC<{ readonly progress: WeeklyGoalProgress }> = ({ progress }) => {
  const text = goalText(progress);
  return (
    <div className="ov-goal" data-overview="weekly-goal">
      <div className="ov-goal-top">
        <span className="ov-goal-label" id="ov-goal-label">Weekly goal</span>
        <span className="ov-goal-value" data-overview="weekly-goal-value">{progress.met ? `Goal met · ${text}` : text}</span>
      </div>
      <div
        className="ov-meter"
        role="progressbar"
        aria-labelledby="ov-goal-label"
        aria-valuemin={0}
        aria-valuemax={progress.target}
        aria-valuenow={Math.min(progress.value, progress.target)}
        aria-valuetext={text}
      >
        <div className="ov-meter-fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
      </div>
    </div>
  );
};
