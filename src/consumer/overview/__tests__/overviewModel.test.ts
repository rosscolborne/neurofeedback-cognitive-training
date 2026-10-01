import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { addTrainingDay, EMPTY_STREAK, type Achievement, type DailyStats, type UserProfile } from '@nfct/shared';
import type { DocumentRead } from '../../firestore/reads';
import {
  achievementLists,
  activityView,
  goalProgress,
  goalText,
  periodRange,
  playerToday,
  playerWeeklyGoal,
  playerZone,
  streakNudge,
  streakStrip,
  streakView,
} from '../overviewModel';

const at = (ms: number) => Timestamp.fromMillis(ms);
const streakOf = (...dates: string[]) => dates.reduce(addTrainingDay, EMPTY_STREAK);

function day(date: string, sessionsCompleted: number, activeMs: number, sessions = sessionsCompleted): DailyStats {
  return {
    schemaVersion: 1, aggregateVersion: 1, updatedAt: at(0), date, sessions, sessionsCompleted, activeMs,
    games: { 'mental-math': { sessions, sessionsCompleted, activeMs } },
  };
}

function achievement(id: string, localDate: string, earnedAtMs: number): Achievement {
  return { schemaVersion: 1, achievementId: id, earnedAt: at(earnedAtMs), sessionId: 'sessionAAAAAAAAAAAA1', gameId: 'mental-math', localDate };
}

function profileRead(timezone: string, weeklyGoal: UserProfile['preferences']['weeklyGoal']): DocumentRead<UserProfile> {
  return {
    status: 'readable', id: 'player-1', fromCache: false, hasPendingWrites: false,
    data: {
      schemaVersion: 1, createdAt: at(0), updatedAt: at(0), displayName: null, avatar: null,
      preferences: { timezone, soundEnabled: true, hapticsEnabled: true, weeklyGoal },
      onboarding: { version: 1, completedAt: null },
      eeg: { enabled: false, consent: null, preferredDevice: null },
    },
  };
}

// 2026-10-01 is a Thursday; its ISO week is Mon 28 Sep to Sun 4 Oct.
const TODAY = '2026-10-01';

describe('the player’s zone and today', () => {
  it('reads today in the consumer profile’s zone, else in this device’s zone', () => {
    // 03:30 UTC on 1 Oct is still 30 Sep in Toronto.
    const nowMs = Date.UTC(2026, 9, 1, 3, 30);
    const fromProfile = playerZone(profileRead('America/Toronto', null), 'UTC');
    expect(fromProfile).toEqual({ zone: 'America/Toronto', source: 'profile' });
    expect(playerToday(fromProfile, nowMs)).toBe('2026-09-30');
    // The inherited sign-up's profile is not a consumer profile: the device's zone is used.
    const legacy: DocumentRead<UserProfile> = { status: 'unreadable', id: 'player-1', fromCache: false, hasPendingWrites: false, error: new Error('legacy') as never };
    expect(playerZone(legacy, 'Asia/Tokyo')).toEqual({ zone: 'Asia/Tokyo', source: 'device' });
    expect(playerZone(null, 'UTC')).toEqual({ zone: 'UTC', source: 'device' });
    expect(playerToday({ zone: 'UTC', source: 'device' }, nowMs)).toBe(TODAY);
  });

  it('has no today for a zone this runtime does not know', () => {
    expect(playerToday({ zone: 'Mars/Olympus_Mons', source: 'profile' }, Date.UTC(2026, 9, 1))).toBeNull();
  });

  it('takes the weekly goal only from a readable consumer profile', () => {
    expect(playerWeeklyGoal(profileRead('UTC', { kind: 'sessions', target: 5 }))).toEqual({ kind: 'sessions', target: 5 });
    expect(playerWeeklyGoal(profileRead('UTC', null))).toBeNull();
    expect(playerWeeklyGoal(null)).toBeNull();
  });
});

describe('streak view', () => {
  it('uses streakStatus, never the stored current length', () => {
    const streak = streakOf('2026-09-25', '2026-09-26', '2026-09-27');
    expect(streak.current).toBe(3);
    // Last trained three days before today: broken, whatever the stored value says.
    const broken = streakView(streak, TODAY);
    expect(broken).toMatchObject({ kind: 'status', status: { current: 0, alive: false, longest: 3 } });
    expect(streakNudge(broken)).toBe('restart');

    const alive = streakView(streakOf('2026-09-29', '2026-09-30'), TODAY);
    expect(alive).toMatchObject({ kind: 'status', status: { current: 2, alive: true, trainedToday: false } });
    expect(streakNudge(alive)).toBe('keep');

    const trained = streakView(streakOf('2026-09-30', TODAY), TODAY);
    expect(trained).toMatchObject({ kind: 'status', status: { current: 2, trainedToday: true } });
    expect(streakNudge(trained)).toBe('trained-today');
  });

  it('starts with no streak, and keeps only the longest when today is unknown', () => {
    expect(streakView(EMPTY_STREAK, TODAY)).toEqual({ kind: 'none' });
    expect(streakNudge({ kind: 'none' })).toBe('start');
    const unknown = streakView(streakOf('2026-09-29', '2026-09-30'), null);
    expect(unknown).toEqual({ kind: 'today-unknown', longest: 2, lastActiveDate: '2026-09-30' });
    expect(streakNudge(unknown)).toBeNull();
  });

  it('marks this week’s training days, today and the days still to come', () => {
    const strip = streakStrip(streakOf('2026-09-27', '2026-09-28', '2026-09-30'), TODAY, 'en-GB');
    expect(strip.map((entry) => entry.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(strip.map((entry) => entry.trained)).toEqual([true, false, true, false, false, false, false]);
    expect(strip.find((entry) => entry.isToday)?.date).toBe(TODAY);
    expect(strip.filter((entry) => entry.isFuture)).toHaveLength(3);
    expect(strip[0]!.label).toBe('Mon');
  });
});

describe('activity and the weekly goal', () => {
  const documents = [day('2026-09-28', 2, 200_000), day('2026-09-30', 0, 20_000, 1), day(TODAY, 1, 90_000), day('2026-09-20', 5, 500_000)];

  it('lays a week out from Monday, with zeros for days without a document', () => {
    const range = periodRange('week', TODAY);
    expect(range).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    const view = activityView(documents, range, TODAY);
    expect(view.leadingBlanks).toBe(0);
    expect(view.days.map((entry) => entry.active)).toEqual([true, false, false, true, false, false, false]);
    // An abandoned-only day is played but not active.
    expect(view.days[2]).toMatchObject({ sessions: 1, sessionsCompleted: 0, active: false });
    expect(view.totals).toEqual({ sessions: 4, sessionsCompleted: 3, activeMs: 310_000, activeDays: 2 });
  });

  it('lays a month out as a calendar from its first weekday', () => {
    const range = periodRange('month', TODAY);
    expect(range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    const view = activityView(documents, range, TODAY);
    // 1 October 2026 is a Thursday: three blank cells (Mon to Wed) before it.
    expect(view.leadingBlanks).toBe(3);
    expect(view.days).toHaveLength(31);
    expect(view.totals.sessionsCompleted).toBe(1);
  });

  it('measures the goal in its own unit; active days are days with a finished run', () => {
    expect(goalProgress(null, documents, TODAY)).toBeNull();
    const runs = goalProgress({ kind: 'sessions', target: 5 }, documents, TODAY)!;
    expect(runs).toMatchObject({ value: 3, met: false });
    expect(goalText(runs)).toBe('3 of 5 finished runs');
    const minutes = goalProgress({ kind: 'minutes', target: 5 }, documents, TODAY)!;
    expect(minutes).toMatchObject({ value: 5, met: true, fraction: 1 });
    expect(goalText(minutes)).toBe('5 of 5 minutes played');
    const days = goalProgress({ kind: 'activeDays', target: 1 }, documents, TODAY)!;
    expect(goalText(days)).toBe('2 of 1 active day');
  });
});

describe('achievement lists', () => {
  it('splits the catalogue into earned (newest first) and not earned yet (catalogue order)', () => {
    const lists = achievementLists([
      achievement('first-run', '2026-09-27', 1),
      achievement('streak-3', '2026-09-29', 2),
      // A newer catalogue's achievement this build cannot name is left out.
      achievement('some-future-goal', TODAY, 3),
    ]);
    expect(lists.total).toBe(9);
    expect(lists.earned.map((item) => item.definition.id)).toEqual(['streak-3', 'first-run']);
    expect(lists.earned[0]!.earned?.localDate).toBe('2026-09-29');
    expect(lists.notYet.map((item) => item.definition.id)).toEqual([
      'runs-10', 'runs-50', 'runs-100', 'streak-7', 'streak-30', 'mental-math-level-5', 'mental-math-level-10',
    ]);
  });

  it('lists everything as not earned yet for a new player', () => {
    const lists = achievementLists([]);
    expect(lists.earned).toEqual([]);
    expect(lists.notYet).toHaveLength(9);
    expect(lists.notYet[0]!.definition).toMatchObject({ id: 'first-run', title: 'First run', description: 'Finish your first run.' });
  });
});
