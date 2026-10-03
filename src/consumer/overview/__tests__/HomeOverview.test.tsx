import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeOverview } from '../HomeOverview';
import { formatLocalDate } from '../overviewModel';
import type { OverviewClock } from '../usePlayerOverview';
import {
  achievement,
  buttonNamed,
  byData,
  consumerProfile,
  day,
  fakeSources,
  missing,
  movableClock,
  NOW_MS,
  offlineClock,
  readable,
  runEntry,
  sequenceMemoryRunEntry,
  summaryWith,
  textOf,
  TODAY,
  utcClock,
  visibleText,
  type FakeState,
} from './overviewFixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

async function renderHome(state: FakeState, clock: OverviewClock = utcClock) {
  act(() => renderer?.unmount());
  const { sources } = fakeSources(state);
  const handlers = { onPlay: vi.fn(), onOpenAchievements: vi.fn(), onOpenGameProgress: vi.fn() };
  await act(async () => {
    renderer = create(<HomeOverview playerId="player-1" sources={sources} clock={clock} {...handlers} />);
  });
  return { r: renderer!, sources, handlers };
}

const one = (r: ReactTestRenderer, name: string) => textOf(byData(r, name)[0]!);
const weekDays = (r: ReactTestRenderer) => r.root.findAll((node) => node.type === 'li' && node.props.className === 'ov-week-day');

describe('Home', () => {
  it('invites a new player to play, without a streak, zeros or achievements', async () => {
    const { r, handlers } = await renderHome({ summary: missing(), runs: [] });
    expect(one(r, 'hero-text')).toBe('Quick arithmetic against the clock that adapts as you play. Finish your first run to start a streak and earn your first achievement.');
    expect(byData(r, 'streak-card')).toHaveLength(0);
    expect(byData(r, 'home-achievements')).toHaveLength(0);
    expect(byData(r, 'recent-runs')).toHaveLength(0);
    expect(visibleText(r)).not.toMatch(/\b0\b/);
    act(() => buttonNamed(r, 'Play Mental Math').props.onClick());
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
  });

  it('shows a streak trained today, this week’s training days and the week’s activity', async () => {
    const { r } = await renderHome({
      summary: readable(summaryWith(['2026-09-30', TODAY])),
      days: [day('2026-09-30', 1, 90_000), day(TODAY, 2, 150_000)],
      achievements: [achievement('first-run', '2026-09-30')],
      runs: [runEntry('sessionAAAAAAAAAAAA1')],
    });
    expect(one(r, 'streak')).toBe('2');
    expect(one(r, 'streak-caption')).toBe('Come back tomorrow to make it 3 days.');
    expect(one(r, 'hero-text')).toBe('You’ve trained today. Play again to chase a new best.');
    expect(weekDays(r).map((node) => node.props['data-trained'])).toEqual([false, false, true, true, false, false, false]);
    expect(weekDays(r).map((node) => node.props['data-today'])).toEqual([false, false, false, true, false, false, false]);
    expect(one(r, 'week-summary')).toBe('This week: 3 finished runs · 4 min played');
    // No goal set: no goal meter.
    expect(byData(r, 'weekly-goal')).toHaveLength(0);
    expect(r.root.findAll((node) => node.props.role === 'progressbar')).toHaveLength(0);
    // A recent run and the achievement it earned.
    expect(r.root.findAll((node) => node.type === 'li' && node.props['data-history-row'] !== undefined)).toHaveLength(1);
    const earned = r.root.find((node) => node.props['data-achievement'] === 'first-run');
    expect(earned.props['data-earned']).toBe(true);
    expect(textOf(earned)).toContain(`Earned ${formatLocalDate('2026-09-30', TODAY)}`);
  });

  it('reads liveness from streakStatus: a stored three-day streak last trained three days ago shows 0', async () => {
    const summary = summaryWith(['2026-09-26', '2026-09-27', '2026-09-28']);
    expect(summary.streak.current).toBe(3);
    const { r } = await renderHome({ summary: readable(summary), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    expect(one(r, 'streak')).toBe('0');
    expect(one(r, 'streak-caption')).toBe(`Last trained ${formatLocalDate('2026-09-28', TODAY)}. Longest: 3 days.`);
    expect(one(r, 'hero-text')).toBe('Play today to start a new streak.');
    expect(r.root.find((node) => node.props.className === 'ov-streak-main').props['data-alive']).toBe(false);
  });

  it('asks to play today while the streak is still alive from yesterday', async () => {
    const { r } = await renderHome({ summary: readable(summaryWith(['2026-09-29', '2026-09-30'])), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    expect(one(r, 'streak')).toBe('2');
    expect(one(r, 'hero-text')).toBe('Play today to keep your 2-day streak going.');
    expect(one(r, 'streak-caption')).toBe('Last trained yesterday.');
  });

  it('shows weekly goal progress only when the profile sets a goal', async () => {
    const { r } = await renderHome({
      summary: readable(summaryWith([TODAY])),
      days: [day('2026-09-28', 1, 90_000), day(TODAY, 1, 90_000)],
      profile: consumerProfile('UTC', { kind: 'activeDays', target: 3 }),
      runs: [runEntry('sessionAAAAAAAAAAAA1')],
    });
    expect(one(r, 'weekly-goal-value')).toBe('2 of 3 active days');
    const meter = r.root.find((node) => node.props.role === 'progressbar');
    expect(meter.props).toMatchObject({ 'aria-valuenow': 2, 'aria-valuemax': 3, 'aria-valuetext': '2 of 3 active days' });
    // Active days (the goal) and training days (the streak) stay separate counts.
    expect(one(r, 'streak')).toBe('1');
  });

  it('marks a met goal', async () => {
    const { r } = await renderHome({
      summary: readable(summaryWith([TODAY])),
      days: [day(TODAY, 3, 270_000)],
      profile: consumerProfile('UTC', { kind: 'minutes', target: 4 }),
      runs: [runEntry('sessionAAAAAAAAAAAA1')],
    });
    expect(one(r, 'weekly-goal-value')).toBe('Goal met · 4 of 4 minutes played');
  });

  it('cannot tell the current streak for an unknown profile time zone, and says why', async () => {
    const { r } = await renderHome({
      summary: readable(summaryWith(['2026-09-29', '2026-09-30'])),
      profile: consumerProfile('Mars/Olympus_Mons'),
      runs: [runEntry('sessionAAAAAAAAAAAA1')],
    });
    expect(one(r, 'streak')).toBe('—');
    expect(one(r, 'streak-caption')).toBe('Longest: 2 days. Your current streak can’t be shown because your profile’s time zone (Mars/Olympus_Mons) isn’t recognised.');
    expect(weekDays(r)).toHaveLength(0);
    expect(byData(r, 'week-summary')).toHaveLength(0);
    expect(one(r, 'hero-text')).toBe('Quick arithmetic against the clock that adapts as you play.');
  });

  it('tells a player whose runs predate streaks that the next run brings them up to date', async () => {
    const { r } = await renderHome({ summary: missing(), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    expect(one(r, 'streak')).toBe('—');
    expect(one(r, 'streak-caption')).toBe('Your streak and achievements catch up after your next finished run.');
    expect(byData(r, 'recent-runs')).toHaveLength(1);
  });

  it('never calls a player whose only runs are Sequence Memory new, and lists only Mental Math runs (NFCT-93)', async () => {
    const { r, sources } = await renderHome({ summary: missing(), runs: [sequenceMemoryRunEntry('sessionSMSMSMSMSMSM1')] });
    expect(sources.gameSessions.subscribeToGameSessionHistory).toHaveBeenCalledWith({ pageSize: 3 }, expect.any(Function), expect.any(Function));
    expect(one(r, 'hero-text')).not.toMatch(/first run/);
    expect(visibleText(r)).not.toContain('Start here');
    expect(one(r, 'streak-caption')).toBe('Your streak and achievements catch up after your next finished run.');
    expect(byData(r, 'recent-runs')).toHaveLength(0);
    const withBoth = await renderHome({ summary: readable(summaryWith([TODAY])), runs: [sequenceMemoryRunEntry('sessionSMSMSMSMSMSM1'), runEntry('sessionAAAAAAAAAAAA1')] });
    expect(textOf(withBoth.r.root.findByProps({ id: 'ov-recent-title' }))).toBe('Recent Mental Math runs');
    expect(withBoth.r.root.findAll((node) => node.type === 'li' && node.props.className?.includes?.('mm-history-row'))).toHaveLength(1);
  });

  it('shows a run whose result is pending as loading, never narrating how it is scored (NFCT-66)', async () => {
    const entry = runEntry('sessionAAAAAAAAAAAA2', { verified: false, wallStartMs: NOW_MS - 600_000 });
    const { r } = await renderHome({ summary: missing(), runs: [entry] }, movableClock(entry.session.endedAt.toMillis() + 1_000));
    expect(one(r, 'streak-caption')).toBe('Loading your streak…');
    const banned = /server|being checked|confirm|verif|provisional|processing/i;
    expect(visibleText(r)).not.toMatch(banned);
    // Pending past the grace (NFCT-83): not loading any more, and still nothing about how it is scored.
    const stale = await renderHome({ summary: missing(), runs: [runEntry('sessionAAAAAAAAAAAA2', { verified: false })] });
    expect(one(stale.r, 'streak-caption')).toBe('Your streak updates once pending scores are final.');
    expect(one(stale.r, 'streak')).toBe('—');
    expect(byData(stale.r, 'recent-runs')).toHaveLength(1);
    expect(visibleText(stale.r)).not.toMatch(banned);
    const withStats = await renderHome({ summary: readable(summaryWith([TODAY])), runs: [runEntry('sessionAAAAAAAAAAAA2', { verified: false })] });
    expect(visibleText(withStats.r)).not.toMatch(banned);
  });

  it('recovers from a failed live read by subscribing again, instead of staying unavailable (NFCT-66)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const state: FakeState = { summary: 'error', runs: [runEntry('sessionAAAAAAAAAAAA1')] };
      const { r, sources } = await renderHome(state);
      expect(one(r, 'streak-caption')).toBe('Your streak couldn’t be loaded right now.');
      state.summary = readable(summaryWith([TODAY]));
      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(sources.stats.subscribeToSummary).toHaveBeenCalledTimes(2);
      expect(one(r, 'streak')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the connection instead of claiming no stats when the summary is not cached offline', async () => {
    const { r } = await renderHome({ summary: missing(true), runs: [runEntry('sessionAAAAAAAAAAAA1')] }, offlineClock);
    expect(one(r, 'streak-caption')).toBe('Your streak will show when you’re back online.');
  });

  it('never calls a player new while offline with nothing cached, or when the runs cannot be read', async () => {
    // No connection and nothing cached: no runs in the cache says nothing about the account.
    const offline = await renderHome({ summary: missing(true), runs: [] }, offlineClock);
    expect(one(offline.r, 'hero-text')).toBe('Quick arithmetic against the clock that adapts as you play.');
    expect(visibleText(offline.r)).not.toContain('Start here');
    expect(one(offline.r, 'streak-caption')).toBe('Your streak will show when you’re back online.');

    // The server has no summary, but the runs could not be read: not "new" either.
    const failed = await renderHome({ summary: missing(), runs: 'error' });
    expect(visibleText(failed.r)).not.toContain('Start here');
    expect(one(failed.r, 'streak-caption')).toBe('Your streak couldn’t be loaded right now.');

    // Online, a summary missing from the cache is still loading: no streak card and no "new" message in between.
    const waiting = await renderHome({ summary: missing(true), runs: [] });
    expect(byData(waiting.r, 'streak-card')).toHaveLength(0);
    expect(visibleText(waiting.r)).not.toContain('Start here');
  });

  it('reports a summary it cannot load without breaking Home', async () => {
    const { r } = await renderHome({ summary: 'error', runs: [] });
    expect(one(r, 'streak-caption')).toBe('Your streak couldn’t be loaded right now.');
    expect(buttonNamed(r, 'Play Mental Math')).toBeDefined();
  });

  it('shows the next achievement to earn before any is earned, and opens Progress for all of them', async () => {
    const { r, handlers } = await renderHome({ summary: readable(summaryWith([], { sessions: 1, activeMs: 4_000 })), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    expect(one(r, 'achievement-count')).toBe('0 of 9 earned');
    const rows = r.root.findAll((node) => node.type === 'li' && node.props['data-achievement'] !== undefined);
    expect(rows.map((node) => node.props['data-achievement'])).toEqual(['first-run']);
    expect(textOf(rows[0]!)).toContain('Not earned yet');
    act(() => buttonNamed(r, 'See all achievements').props.onClick());
    expect(handlers.onOpenAchievements).toHaveBeenCalledTimes(1);
    act(() => buttonNamed(r, 'All Mental Math runs and records').props.onClick());
    expect(handlers.onOpenGameProgress).toHaveBeenCalledTimes(1);
  });

  it('shows the two newest achievements and the next one', async () => {
    const { r } = await renderHome({
      summary: readable(summaryWith(['2026-09-29', '2026-09-30', TODAY])),
      achievements: [achievement('first-run', '2026-09-29', 1), achievement('runs-10', '2026-09-30', 2), achievement('streak-3', TODAY, 3)],
      runs: [runEntry('sessionAAAAAAAAAAAA1')],
    });
    const rows = r.root.findAll((node) => node.type === 'li' && node.props['data-achievement'] !== undefined);
    expect(rows.map((node) => [node.props['data-achievement'], node.props['data-earned']])).toEqual([
      ['streak-3', true], ['runs-10', true], ['runs-50', false],
    ]);
    expect(one(r, 'achievement-count')).toBe('3 of 9 earned');
  });

  it('never shows one player’s reads to another: a new player id starts loading again', async () => {
    const { sources } = fakeSources({ summary: readable(summaryWith([TODAY])), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    await act(async () => {
      renderer = create(<HomeOverview playerId="player-1" sources={sources} clock={utcClock} onPlay={vi.fn()} onOpenAchievements={vi.fn()} onOpenGameProgress={vi.fn()} />);
    });
    expect(sources.stats.subscribeToSummary).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer!.update(<HomeOverview playerId="player-2" sources={sources} clock={utcClock} onPlay={vi.fn()} onOpenAchievements={vi.fn()} onOpenGameProgress={vi.fn()} />);
    });
    expect(sources.stats.subscribeToSummary).toHaveBeenCalledTimes(2);
    expect(sources.profile.getProfile).toHaveBeenCalledTimes(2);
  });
});
