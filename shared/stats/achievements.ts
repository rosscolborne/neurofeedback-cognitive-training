import type { StatsSummary } from '../schemas/stats';

// The achievement catalogue (NFCT-13), v1 and provisional: a short list of
// gameplay-only goals a player can reasonably reach. Titles and descriptions
// are plain product copy for the owner to change freely; they make no
// cognitive, clinical or EEG claim. EEG is never an input.
//
// Every criterion reads only the trusted stats summary, and only its
// valid-session parts (valid runs, the streak of training days, best trusted
// peak level), so a flagged session never earns an achievement. Each
// criterion is monotone: once it holds it keeps holding as more sessions
// count. Trusted scoring checks the catalogue after every change to the
// summary and creates each achievement once, so the achievements a player
// ends up with never depend on the order sessions were processed in; only
// which session earned each one (and when) is a point-in-time fact.
//
// Changing the catalogue (a new achievement, a changed criterion or a removed
// one) changes what the stats reducer produces: bump STATS_AGGREGATE_VERSION
// (shared/schemas/stats.ts), so trusted scoring rebuilds each player's stats
// and awards the new set from their stored sessions. Copy-only changes need
// no bump: titles and descriptions are not stored. IDs are never renamed or
// reused.

export type AchievementCriterion =
  /** At least `atLeast` valid completed runs, of any game. */
  | { readonly kind: 'valid-runs'; readonly atLeast: number }
  /** A streak of at least `days` consecutive training days (the longest one counts). */
  | { readonly kind: 'streak'; readonly days: number }
  /** A trusted peak level of at least `atLeast` in a valid completed run of `gameId`. */
  | { readonly kind: 'peak-level'; readonly gameId: string; readonly atLeast: number };

export type AchievementDefinition = {
  /** Stable kebab-case ID: the document ID under users/{uid}/achievements. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly criterion: AchievementCriterion;
};

const CATALOGUE_V1: readonly AchievementDefinition[] = [
  { id: 'first-run', title: 'First run', description: 'Finish your first run.', criterion: { kind: 'valid-runs', atLeast: 1 } },
  { id: 'runs-10', title: '10 runs', description: 'Finish 10 runs.', criterion: { kind: 'valid-runs', atLeast: 10 } },
  { id: 'runs-50', title: '50 runs', description: 'Finish 50 runs.', criterion: { kind: 'valid-runs', atLeast: 50 } },
  { id: 'runs-100', title: '100 runs', description: 'Finish 100 runs.', criterion: { kind: 'valid-runs', atLeast: 100 } },
  { id: 'streak-3', title: '3-day streak', description: 'Finish a run on 3 days in a row.', criterion: { kind: 'streak', days: 3 } },
  { id: 'streak-7', title: '7-day streak', description: 'Finish a run on 7 days in a row.', criterion: { kind: 'streak', days: 7 } },
  { id: 'streak-30', title: '30-day streak', description: 'Finish a run on 30 days in a row.', criterion: { kind: 'streak', days: 30 } },
  {
    id: 'mental-math-level-5',
    title: 'Level 5',
    description: 'Reach level 5 in Mental Math.',
    criterion: { kind: 'peak-level', gameId: 'mental-math', atLeast: 5 },
  },
  {
    id: 'mental-math-level-10',
    title: 'Top level',
    description: 'Reach level 10, the top level, in Mental Math.',
    criterion: { kind: 'peak-level', gameId: 'mental-math', atLeast: 10 },
  },
];

/** Achievement catalogue v1 (provisional), frozen. The order is the display order. */
export const ACHIEVEMENT_CATALOGUE: readonly AchievementDefinition[] = Object.freeze(
  CATALOGUE_V1.map((definition) => Object.freeze({ ...definition, criterion: Object.freeze({ ...definition.criterion }) })),
);

/** The catalogue entry for an ID, or undefined for an ID this build does not know (a newer catalogue's). */
export function findAchievement(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOGUE.find((definition) => definition.id === id);
}

/** Whether the summary meets the criterion. Monotone in the summary's valid-session parts. */
export function achievementMet(
  criterion: AchievementCriterion,
  summary: Pick<StatsSummary, 'validRuns' | 'streak' | 'bestPeakLevel'>,
): boolean {
  switch (criterion.kind) {
    case 'valid-runs':
      return summary.validRuns >= criterion.atLeast;
    case 'streak':
      return summary.streak.longest >= criterion.days;
    case 'peak-level':
      return (summary.bestPeakLevel[criterion.gameId] ?? 0) >= criterion.atLeast;
  }
}

/** Catalogue entries the summary now meets that it does not list as earned yet, in catalogue order. */
export function newlyMetAchievements(summary: StatsSummary): AchievementDefinition[] {
  const earned = new Set(summary.achievements);
  return ACHIEVEMENT_CATALOGUE.filter((definition) => !earned.has(definition.id) && achievementMet(definition.criterion, summary));
}
