import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  GAME_PROGRESS_SCHEMA_VERSION,
  PROGRESS_AGGREGATE_VERSION,
  sequenceMemory as sm,
  type GameProgress,
  type GameSession,
  type ServerResult,
} from '@nfct/shared';
import type { GameSessionRecord, SaveGameSessionInput, StartedGameSession } from '../../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../../repositories/progressRepository';
import type { VisibilitySource } from '../../common/visibility';
import { ManualClock } from '../../mentalMath/__tests__/manualClock';
import { FEEDBACK_MS } from '../runController';
import { SequenceMemoryScreen } from '../SequenceMemoryScreen';
import { sequenceMemoryCardSummary } from '../progressSummary';
import { currentProgress } from '../runSummaryModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = 777;
const SESSION_ID = 'sessionSMSMSMSMSMSM1';
type SaveInput = SaveGameSessionInput<sm.SequenceMemoryTrial, sm.SequenceMemoryMetrics>;

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  isHidden = () => this.hidden;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(hidden: boolean) { this.hidden = hidden; this.listeners.forEach((listener) => listener()); }
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

function progressWith(bestPeakLevel: number | null, overrides: Partial<GameProgress> = {}): GameProgress {
  const at = Timestamp.fromMillis(1_790_000_000_000);
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    aggregateVersion: PROGRESS_AGGREGATE_VERSION,
    updatedAt: at,
    gameId: sm.GAME_ID,
    gameVersion: sm.GAME_VERSION,
    sessionsCompleted: bestPeakLevel === null ? 0 : 1,
    activeMs: 0,
    lastPlayedAt: at,
    bestPeakLevel: bestPeakLevel === null ? {} : { [sm.MODE_ID]: bestPeakLevel },
    unlocked: {},
    bests: {},
    bestsArchive: {},
    ...overrides,
  };
}

function stateWith(progress: GameProgress | null, recentSessions: GameSessionRecord[] = []): ProgressWithRecentSessions {
  return {
    progress: progress === null ? { status: 'missing', id: sm.GAME_ID, fromCache: true, hasPendingWrites: false } : { status: 'readable', id: sm.GAME_ID, data: progress, fromCache: true, hasPendingWrites: false },
    recentSessions,
    pendingSessions: recentSessions.filter((record) => record.awaitingResult),
    unreadableSessions: [],
    fromCache: true,
  } as ProgressWithRecentSessions;
}

function harness(state: ProgressWithRecentSessions = stateWith(null)) {
  const clock = new ManualClock();
  const visibility = new FakeVisibility();
  const saves: SaveInput[] = [];
  const save = vi.fn(async (input: SaveInput) => {
    saves.push(input);
    return { sessionId: SESSION_ID, userId: 'player-1', acknowledged: Promise.resolve() };
  });
  const gameSessions = {
    startGameSession: vi.fn((): StartedGameSession => ({ sessionId: SESSION_ID, seed: SEED, userId: 'player-1', save: save as unknown as StartedGameSession['save'] })),
    getGameSession: vi.fn(),
  };
  const listeners = new Set<(value: ProgressWithRecentSessions) => void>();
  let latest = state;
  const progress = {
    subscribeToProgressWithRecentSessions: vi.fn((gameId: string, _options: object, onNext: (value: ProgressWithRecentSessions) => void) => {
      expect(gameId).toBe('sequence-memory');
      listeners.add(onNext);
      onNext(latest);
      return () => { listeners.delete(onNext); };
    }),
  };
  const publish = (next: ProgressWithRecentSessions) => act(() => { latest = next; listeners.forEach((listener) => listener(next)); });
  const onExit = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <SequenceMemoryScreen
        gameSessions={gameSessions}
        progress={progress}
        clock={clock}
        environment={{ timezone: 'UTC', appVersion: '0.0.0', platform: 'web' }}
        visibility={visibility}
        onExit={onExit}
      />,
    );
  });
  const root = () => renderer.root;
  const press = (label: string) => {
    const button = root().findAll((node) => node.type === 'button' && textOf(node).trim() === label)[0];
    if (!button) throw new Error(`no button '${label}'`);
    act(() => { button.props.onClick({ detail: 0 }); });
  };
  const advance = (ms: number) => act(() => { clock.advance(ms); });
  const tiles = () => root().findAll((node) => node.type === 'button' && node.props['data-tile'] !== undefined);
  const tile = (index: number) => tiles().find((node) => node.props['data-tile'] === index)!;
  const pointerDown = (index: number) => act(() => { tile(index).props.onPointerDown({ pointerType: 'touch', button: 0 }); });
  const status = () => textOf(root().find((node) => node.props['data-sm'] === 'status'));
  const hud = (name: string) => textOf(root().find((node) => node.props['data-hud'] === name));
  /** Watches the presentation through, reading the lit tiles from the board as a player sees them. */
  const watch = (): number[] => {
    const seen: number[] = [];
    let lastStep: string | undefined;
    while (status() === 'Watch the sequence') {
      const lit = tiles().find((node) => node.props['data-lit'] === 'true');
      const step = lit?.props['data-lit-step'] as number | undefined;
      if (lit && `${step}` !== lastStep) {
        seen.push(lit.props['data-tile'] as number);
        lastStep = `${step}`;
      }
      advance(50);
    }
    return seen;
  };
  return { clock, visibility, saves, gameSessions, progress, publish, onExit, root, press, advance, tiles, tile, pointerDown, status, hud, watch };
}

describe('SequenceMemoryScreen', () => {
  it('starts from the picker at the unlocked level and plays a sequence read off the board', () => {
    const h = harness(stateWith(progressWith(4)));
    expect(textOf(h.root().findByType('h1'))).toBe('Sequence Memory');
    h.press('Start at level 3');
    expect(h.hud('level')).toBe('3');
    expect(h.tiles()).toHaveLength(9);
    const seen = h.watch();
    expect(seen).toHaveLength(sm.levelParams(3).span);
    expect(h.status()).toBe(`Your turn: tap ${seen.length} tiles in order`);
    for (const index of seen) {
      h.advance(400);
      h.pointerDown(index);
    }
    expect(h.status()).toBe('Correct');
    expect(h.hud('score')).toBe('40');
  });

  it('counts one tap per press: the click after a pointer press is ignored, a keyboard click taps', () => {
    const h = harness();
    h.press('Start at level 1');
    const [first, second] = h.watch();
    h.advance(300);
    h.pointerDown(first!);
    act(() => { h.tile(first!).props.onClick({ detail: 1 }); });
    expect(h.status()).toBe('1 of 2');
    act(() => { h.tile(second!).props.onClick({ detail: 0 }); });
    expect(h.status()).toBe('Correct');
  });

  it('backgrounding during the presentation pauses and discards the trial; resuming shows a fresh one', () => {
    const h = harness(stateWith(progressWith(3)));
    h.press('Start at level 2');
    h.advance(1_200);
    act(() => h.visibility.set(true));
    expect(h.root().findAll((node) => node.props.id === 'sm-paused-title')).toHaveLength(1);
    expect(h.tiles()).toHaveLength(0);
    act(() => h.visibility.set(false));
    h.press('Resume');
    expect(h.status()).toBe('Watch the sequence');
    expect(h.hud('trial')).toBe('1/20');
  });

  it('saves a completed run once, then shows a pending result that becomes final', async () => {
    const h = harness();
    h.press('Start at level 1');
    for (let trial = 0; trial < sm.TRIALS_PER_RUN; trial += 1) {
      for (const index of h.watch()) {
        h.advance(350);
        h.pointerDown(index);
      }
      h.advance(FEEDBACK_MS);
    }
    await act(async () => { await Promise.resolve(); });
    expect(h.saves).toHaveLength(1);
    const { session, definition } = h.saves[0]!;
    expect(definition).toBe(sm.definition);
    expect(session).toMatchObject({ gameId: 'sequence-memory', gameVersion: 1, modeId: 'standard', status: 'completed', startLevel: 1 });
    expect(session.trials).toHaveLength(sm.TRIALS_PER_RUN);
    expect(session.activeDurationMs).toBe(sm.trialEndMs(session.trials.at(-1)!));
    expect(textOf(h.root().find((node) => node.props.id === 'sm-handoff-title'))).toBe('Run complete');
    expect(textOf(h.root().find((node) => node.props['data-summary'] === 'verification'))).toBe('Pending');

    // Trusted scoring answers: the same score, now final.
    const scored = sm.score(session.trials, { modeId: sm.MODE_ID, startLevel: 1 });
    const result = {
      processedAt: Timestamp.fromMillis(1_790_000_100_000),
      scoringVersion: 1,
      validity: 'valid',
      reasons: [],
      score: scored.score,
      accuracy: scored.accuracy,
      responseTime: scored.responseTime,
      peakLevel: scored.peakLevel,
      metrics: scored.metrics,
      performanceIndex: null,
      performanceIndexVersion: null,
      domainContributions: { memory: 0.6, spatial: 0.4 },
      recordKey: 'standard:1',
      recordValues: { score: scored.score, longestSpan: scored.metrics.longestSpan, peakLevel: scored.peakLevel },
      personalBest: true,
      unlocked: [],
    } as unknown as ServerResult;
    const stored = { id: SESSION_ID, session: { ...session, schemaVersion: 1, userId: 'player-1', seed: SEED, createdAt: session.endedAt, result } as unknown as GameSession, awaitingResult: false, hasPendingWrites: false };
    h.publish(stateWith(progressWith(scored.peakLevel, { sessionsCompleted: 1 }), [stored]));
    expect(textOf(h.root().find((node) => node.props['data-summary'] === 'verification'))).toBe('Final');
    expect(textOf(h.root().find((node) => node.props['data-result'] === 'score'))).toBe(new Intl.NumberFormat().format(scored.score));
  });

  it('quitting saves the run as unfinished', async () => {
    const h = harness();
    h.press('Start at level 1');
    h.advance(500);
    h.press('Pause');
    h.press('Quit run');
    await act(async () => { await Promise.resolve(); });
    expect(h.saves[0]!.session).toMatchObject({ status: 'abandoned', trials: [], activeDurationMs: 0 });
    expect(textOf(h.root().find((node) => node.props.id === 'sm-handoff-title'))).toBe('Run ended early');
  });
});

describe('Sequence Memory progress card', () => {
  it('summarises runs and unlocked start levels', () => {
    expect(sequenceMemoryCardSummary(currentProgress(stateWith(null)))).toEqual({ sessionsCompleted: 0, unlocked: 1, maxLevel: 10, provisional: false });
    expect(sequenceMemoryCardSummary(currentProgress(stateWith(progressWith(5, { sessionsCompleted: 3 })))))
      .toEqual({ sessionsCompleted: 3, unlocked: 4, maxLevel: 10, provisional: false });
  });
});
