import { Timestamp } from 'firebase/firestore';
import { vi } from 'vitest';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import {
  addTrainingDay,
  EMPTY_STREAK,
  readSessionProgressFields,
  type Achievement,
  type DailyStats,
  type LocalDateRange,
  type StatsSummary,
  type UserProfile,
} from '@nfct/shared';
import type { DocumentRead } from '../../firestore/reads';
import type { GameSessionHistoryEntry, GameSessionHistoryPage } from '../../repositories/gameSessionRepository';
import type { AchievementsRead, DailyStatsRead } from '../../repositories/statsRepository';
import { clientSessionDocument } from '../../games/mentalMath/runSummaryModel';
import { previewDecision } from '../../games/mentalMath/startLevel';
import { playRun } from '../../games/mentalMath/__tests__/fixtures';
import { previewDecision as previewGameDecision } from '../../games/common/startLevel';
import { SEQUENCE_MEMORY } from '../../games/sequenceMemory/runSummaryModel';
import { clientSessionDocument as sequenceMemoryDocument } from '../../games/sequenceMemory/sessionDraft';
import { playRun as playSequenceMemoryRun } from '../../games/sequenceMemory/__tests__/fixtures';
import type { OverviewClock, OverviewSources } from '../usePlayerOverview';

// Fakes for Home and Progress (NFCT-13 part 2): the player's own aggregates
// as the repositories would report them, and a fixed clock.

export const at = (ms: number) => Timestamp.fromMillis(ms);

/** Thursday 1 October 2026, noon UTC. Its ISO week runs Mon 28 Sep to Sun 4 Oct. */
export const NOW_MS = Date.UTC(2026, 9, 1, 12);
export const TODAY = '2026-10-01';
export const utcClock: OverviewClock = { now: () => NOW_MS, deviceZone: () => 'UTC', onForeground: () => () => {}, isOnline: () => true };
/** A clock at `nowMs`, which a test moves forward by setting `nowMs`. */
export function movableClock(nowMs: number): OverviewClock & { nowMs: number } {
  const clock = { ...utcClock, nowMs, now: () => clock.nowMs };
  return clock;
}
/** The same clock on a device with no connection. */
export const offlineClock: OverviewClock = { ...utcClock, isOnline: () => false };

export function summaryWith(trainingDays: readonly string[], overrides: Partial<StatsSummary> = {}): StatsSummary {
  return {
    schemaVersion: 1,
    aggregateVersion: 1,
    updatedAt: at(NOW_MS),
    sessions: trainingDays.length,
    sessionsCompleted: trainingDays.length,
    activeMs: trainingDays.length * 90_000,
    lastPlayedAt: at(NOW_MS),
    validRuns: trainingDays.length,
    bestPeakLevel: {},
    streak: trainingDays.reduce(addTrainingDay, EMPTY_STREAK),
    achievements: [],
    ...overrides,
  };
}

export function readable<T>(data: T, fromCache = false): DocumentRead<T> {
  return { status: 'readable', id: 'summary', data, fromCache, hasPendingWrites: false };
}

export function missing<T>(fromCache = false): DocumentRead<T> {
  return { status: 'missing', id: 'summary', fromCache, hasPendingWrites: false };
}

export function day(date: string, sessionsCompleted: number, activeMs: number): DailyStats {
  return {
    schemaVersion: 1, aggregateVersion: 1, updatedAt: at(NOW_MS), date, sessions: sessionsCompleted, sessionsCompleted, activeMs,
    games: { 'mental-math': { sessions: sessionsCompleted, sessionsCompleted, activeMs } },
  };
}

export function achievement(id: string, localDate: string, earnedAtMs = NOW_MS): Achievement {
  return { schemaVersion: 1, achievementId: id, earnedAt: at(earnedAtMs), sessionId: 'sessionAAAAAAAAAAAA1', gameId: 'mental-math', localDate };
}

export function consumerProfile(timezone: string, weeklyGoal: UserProfile['preferences']['weeklyGoal'] = null): DocumentRead<UserProfile> {
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

/** A users/{uid} document this build cannot read (such as a newer schema). */
export const unreadableProfile: DocumentRead<UserProfile> = {
  status: 'unreadable', id: 'player-1', fromCache: false, hasPendingWrites: false, error: new Error('unreadable profile') as never,
};

/** One finished Mental Math run as a history row: verified by the server, or still on this device. Started an hour before NOW_MS unless `wallStartMs` says otherwise. */
export function runEntry(id: string, { verified = true, wallStartMs = NOW_MS - 3_600_000 }: { verified?: boolean; wallStartMs?: number } = {}): GameSessionHistoryEntry {
  const outcome = playRun({ seed: 4242, startLevel: 1, correct: 7, wallStartMs });
  const document = clientSessionDocument(outcome, { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }, { sessionId: id, userId: 'player-1', seed: 4242 });
  const result = verified ? previewDecision(null, id, document)!.result : undefined;
  return {
    id,
    session: readSessionProgressFields({ ...document, ...(result ? { result } : {}) }),
    awaitingResult: !verified,
    hasPendingWrites: !verified,
  };
}

/** One finished Sequence Memory run (NFCT-93) as a history row, verified by the server or still on this device. */
export function sequenceMemoryRunEntry(id: string, { verified = true, wallStartMs = NOW_MS - 3_600_000 }: { verified?: boolean; wallStartMs?: number } = {}): GameSessionHistoryEntry {
  const outcome = playSequenceMemoryRun({ seed: 4242, wallStartMs });
  const document = sequenceMemoryDocument(outcome, { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }, { sessionId: id, userId: 'player-1', seed: 4242 });
  const result = verified ? previewGameDecision(SEQUENCE_MEMORY, null, id, document)!.result : undefined;
  return {
    id,
    session: readSessionProgressFields({ ...document, ...(result ? { result } : {}) }),
    awaitingResult: !verified,
    hasPendingWrites: !verified,
  };
}

export interface FakeState {
  summary?: DocumentRead<StatsSummary> | 'error';
  days?: readonly DailyStats[];
  achievements?: readonly Achievement[];
  profile?: DocumentRead<UserProfile> | 'error';
  runs?: readonly GameSessionHistoryEntry[] | 'error';
}

/** Repositories that answer at once with `state`; each subscription's calls are recorded. */
export function fakeSources(state: FakeState) {
  const dailyRanges: LocalDateRange[] = [];
  const sources: OverviewSources = {
    stats: {
      subscribeToSummary: vi.fn((onNext: (read: DocumentRead<StatsSummary>) => void, onError: (error: Error) => void) => {
        if (state.summary === 'error') onError(new Error('permission-denied'));
        else onNext(state.summary ?? missing());
        return () => {};
      }),
      subscribeToDailyStats: vi.fn((range: LocalDateRange, onNext: (read: DailyStatsRead) => void) => {
        dailyRanges.push(range);
        onNext({ range, days: (state.days ?? []).filter((entry) => entry.date >= range.from && entry.date <= range.to), unreadable: [], fromCache: false });
        return () => {};
      }),
      subscribeToAchievements: vi.fn((onNext: (read: AchievementsRead) => void) => {
        onNext({ achievements: [...(state.achievements ?? [])], unreadable: [], fromCache: false });
        return () => {};
      }),
    },
    // A new object per harness, so the per-repository profile read is never shared between tests.
    profile: { getProfile: vi.fn(async () => {
      if (state.profile === 'error') throw new Error('offline');
      return state.profile ?? unreadableProfile;
    }) },
    gameSessions: {
      // Like the repository: one game's runs when the options name a game, every game's otherwise.
      subscribeToGameSessionHistory: vi.fn((options: { readonly gameId?: string }, onNext: (page: GameSessionHistoryPage) => void, onError: (error: Error) => void) => {
        if (state.runs === 'error') onError(new Error('unavailable'));
        else {
          const entries = (state.runs ?? []).filter((entry) => options.gameId === undefined || entry.session.gameId === options.gameId);
          onNext({ entries, unreadable: [], nextCursor: null, fromCache: false });
        }
        return () => {};
      }),
    },
  };
  return { sources, dailyRanges };
}

export function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

/** Visible text, without the screen-reader-only labels. */
export function visibleText(renderer: ReactTestRenderer): string {
  const walk = (node: ReactTestInstance | string): string => {
    if (typeof node === 'string') return node;
    if (typeof node.props.className === 'string' && node.props.className.includes('mm-visually-hidden')) return '';
    return node.children.map(walk).join(' ');
  };
  return walk(renderer.root).replace(/\s+/g, ' ');
}

export function byData(renderer: ReactTestRenderer, name: string): ReactTestInstance[] {
  return renderer.root.findAll((node) => typeof node.type === 'string' && node.props['data-overview'] === name);
}

export function buttonNamed(renderer: ReactTestRenderer, name: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === 'button' && (node.props['aria-label'] === name || textOf(node).trim() === name));
}
