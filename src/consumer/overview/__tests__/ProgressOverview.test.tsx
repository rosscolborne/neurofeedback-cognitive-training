import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATALOGUE } from '@nfct/shared';
import { ProgressOverview } from '../ProgressOverview';
import { formatLocalDate } from '../overviewModel';
import {
  achievement,
  buttonNamed,
  byData,
  consumerProfile,
  day,
  fakeSources,
  missing,
  readable,
  runEntry,
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

async function renderProgress(state: FakeState) {
  const fakes = fakeSources(state);
  const onPlay = vi.fn();
  await act(async () => {
    renderer = create(<ProgressOverview playerId="player-1" sources={fakes.sources} clock={utcClock} onPlay={onPlay} games={<p>Mental Math card</p>} />);
  });
  return { r: renderer!, onPlay, ...fakes };
}

const one = (r: ReactTestRenderer, name: string) => textOf(byData(r, name)[0]!);
const achievementRows = (r: ReactTestRenderer) => r.root.findAll((node) => node.type === 'li' && node.props['data-achievement'] !== undefined);
const calendarDays = (r: ReactTestRenderer) => r.root.findAll((node) => node.type === 'li' && node.props.className === 'ov-cal-day');

describe('Progress', () => {
  it('offers a new player a first run instead of zeros, and lists every achievement as not earned yet', async () => {
    const { r, onPlay } = await renderProgress({ summary: missing() });
    expect(byData(r, 'progress-empty')).toHaveLength(1);
    expect(byData(r, 'all-time')).toHaveLength(0);
    expect(one(r, 'activity-totals')).toBe('No runs yet this week.');
    expect(one(r, 'achievement-count')).toBe('0 of 9 earned');
    expect(achievementRows(r).map((node) => node.props['data-earned'])).toEqual(Array(9).fill(false));
    // Plain descriptions straight from the catalogue.
    expect(visibleText(r)).toContain('Finish a run on 3 days in a row.');
    act(() => buttonNamed(r, 'Play Mental Math').props.onClick());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(visibleText(r)).toContain('Mental Math card');
  });

  it('shows all-time figures with the streak’s liveness from streakStatus', async () => {
    const summary = summaryWith(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-30'], { sessionsCompleted: 6, activeMs: 3_900_000 });
    const { r } = await renderProgress({ summary: readable(summary) });
    expect(one(r, 'current-streak')).toBe('1 day');
    expect(one(r, 'longest-streak')).toBe('3 days');
    expect(one(r, 'runs-finished')).toBe('6');
    expect(one(r, 'time-played')).toBe('1 h 5 min');

    const broken = await renderProgress({ summary: readable(summaryWith(['2026-09-20', '2026-09-21'])) });
    expect(one(broken.r, 'current-streak')).toBe('0 days');
  });

  it('shows this week, then this month, from at most 31 days of daily stats', async () => {
    const { r, dailyRanges } = await renderProgress({
      summary: readable(summaryWith(['2026-09-28', TODAY])),
      days: [day('2026-09-28', 2, 200_000), day(TODAY, 1, 90_000), day('2026-10-20', 4, 400_000)],
    });
    expect(dailyRanges).toEqual([{ from: '2026-09-28', to: '2026-10-04' }]);
    expect(one(r, 'period-runs')).toBe('3');
    expect(one(r, 'period-active-days')).toBe('2');
    expect(calendarDays(r).map((node) => node.props['data-active'])).toEqual([true, false, false, true, false, false, false]);
    const todayCell = calendarDays(r).find((node) => node.props['data-today'] === true)!;
    expect(textOf(todayCell)).toContain(`${formatLocalDate(TODAY, TODAY)} (today): 1 finished run, 1 min 30 s played`);

    await act(async () => buttonNamed(r, 'This month').props.onClick());
    expect(dailyRanges.at(-1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(buttonNamed(r, 'This month').props['aria-pressed']).toBe(true);
    expect(calendarDays(r)).toHaveLength(31);
    // Three blank cells (Mon to Wed) before Thursday 1 October.
    expect(r.root.findAll((node) => node.type === 'li' && node.props['aria-hidden'] === 'true')).toHaveLength(3);
    expect(one(r, 'period-runs')).toBe('5');
    expect(one(r, 'period-active-days')).toBe('2');
  });

  it('shows the weekly goal on the week only, and only when one is set', async () => {
    const state: FakeState = {
      summary: readable(summaryWith([TODAY])),
      days: [day(TODAY, 2, 180_000)],
      profile: consumerProfile('UTC', { kind: 'sessions', target: 4 }),
    };
    const { r } = await renderProgress(state);
    expect(one(r, 'weekly-goal-value')).toBe('2 of 4 finished runs');
    await act(async () => buttonNamed(r, 'This month').props.onClick());
    expect(byData(r, 'weekly-goal')).toHaveLength(0);

    const unset = await renderProgress({ ...state, profile: consumerProfile('UTC', null) });
    expect(byData(unset.r, 'weekly-goal')).toHaveLength(0);
  });

  it('lists earned achievements newest first with the day they were earned, then the rest', async () => {
    const { r } = await renderProgress({
      summary: readable(summaryWith(['2026-09-29', '2026-09-30', TODAY])),
      achievements: [achievement('first-run', '2026-09-29', 1), achievement('streak-3', TODAY, 2)],
    });
    expect(one(r, 'achievement-count')).toBe('2 of 9 earned');
    const rows = achievementRows(r);
    expect(rows.map((node) => node.props['data-achievement'])).toEqual([
      'streak-3', 'first-run',
      ...ACHIEVEMENT_CATALOGUE.map((entry) => entry.id).filter((id) => id !== 'first-run' && id !== 'streak-3'),
    ]);
    expect(textOf(rows[0]!)).toContain(`Earned ${formatLocalDate(TODAY, TODAY)}`);
    expect(textOf(rows[1]!)).toContain(`Earned ${formatLocalDate('2026-09-29', TODAY)}`);
    expect(rows.slice(2).every((node) => node.props['data-earned'] === false)).toBe(true);
  });

  it('cannot place activity on a calendar for an unknown time zone, and says why', async () => {
    const { r, dailyRanges } = await renderProgress({ summary: readable(summaryWith(['2026-09-30'])), profile: consumerProfile('Mars/Olympus_Mons') });
    expect(dailyRanges).toEqual([]);
    expect(visibleText(r)).toContain('Your activity can’t be shown because your time zone (Mars/Olympus_Mons) isn’t recognised.');
    expect(one(r, 'current-streak')).toBe('—');
    expect(one(r, 'longest-streak')).toBe('1 day');
  });

  it('tells a player whose runs predate the aggregates that the next run brings them up to date', async () => {
    const { r } = await renderProgress({ summary: missing(), runs: [runEntry('sessionAAAAAAAAAAAA1')] });
    expect(byData(r, 'progress-empty')).toHaveLength(0);
    expect(visibleText(r)).toContain('Your streak and all-time figures catch up after your next finished run.');
  });

  it('waits for the connection rather than calling an offline player new', async () => {
    const { r } = await renderProgress({ summary: missing(true) });
    expect(byData(r, 'progress-empty')).toHaveLength(0);
    expect(visibleText(r)).toContain('Your progress will show when you’re back online.');
  });

  it('scrolls to and focuses the achievements once loaded when Home asks for them', async () => {
    const heading = { scrollIntoView: vi.fn(), focus: vi.fn() };
    const { sources } = fakeSources({ summary: readable(summaryWith([TODAY])) });
    const onSectionFocused = vi.fn();
    await act(async () => {
      renderer = create(
        <ProgressOverview playerId="player-1" sources={sources} clock={utcClock} onPlay={vi.fn()} games={null} focusSection="achievements" onSectionFocused={onSectionFocused} />,
        { createNodeMock: (element) => ((element.props as { id?: string }).id === 'ov-achievements-title' ? heading : null) },
      );
    });
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(onSectionFocused).toHaveBeenCalledTimes(1);
  });

  it('reports what it cannot load', async () => {
    const { r } = await renderProgress({ summary: 'error' });
    expect(visibleText(r)).toContain('Your progress couldn’t be loaded right now.');
  });
});
