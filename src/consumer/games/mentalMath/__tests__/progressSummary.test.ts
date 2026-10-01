import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { readSessionProgressFields, type ServerResult } from '@nfct/shared';
import type { GameSessionHistoryEntry } from '../../../repositories/gameSessionRepository';
import { clientSessionDocument } from '../runSummary';
import { formatPlayTime, gameOverview, historyRow } from '../progressSummary';
import { previewDecision } from '../startLevel';
import { playRun, progressWith } from './fixtures';

const SEED = 4242;
const ENVIRONMENT = { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' } as const;
const at = (ms: number) => Timestamp.fromMillis(ms);

function decide(id: string, startLevel: number, correct: number, wallStartMs: number, progress: Parameters<typeof previewDecision>[0]) {
  const outcome = playRun({ seed: SEED, startLevel, correct, wallStartMs });
  const document = clientSessionDocument(outcome, ENVIRONMENT, { sessionId: id, userId: 'player-1', seed: SEED });
  const decision = previewDecision(progress, id, document)!;
  return { outcome, document, decision };
}

describe('per-game progress', () => {
  it('a new player: level 1 unlocked, no bests, nothing played', () => {
    expect(gameOverview(null)).toEqual({
      sessionsCompleted: 0,
      activeMs: 0,
      bestPeakLevel: null,
      unlocked: 1,
      maxLevel: 10,
      unlock: { kind: 'next', unlocked: 1, nextLevel: 2, reachLevel: 3 },
      levels: [{ startLevel: 1, bests: null }],
    });
  });

  it('lists bests per start level separately, for every unlocked level', () => {
    const one = decide('sessionAAAAAAAAAAAA1', 1, 7, 1_790_000_000_000, null);
    const two = decide('sessionAAAAAAAAAAAA2', 2, 2, 1_790_000_200_000, one.decision.progress);
    const overview = gameOverview(two.decision.progress);
    const score = (result: ServerResult) => (result.validity === 'invalid' ? null : result.score);
    expect(overview).toMatchObject({ sessionsCompleted: 2, unlocked: 2, bestPeakLevel: 3 });
    expect(overview.levels).toEqual([
      { startLevel: 1, bests: { score: score(one.decision.result), correct: 7, peakLevel: 3 } },
      { startLevel: 2, bests: { score: score(two.decision.result), correct: 2, peakLevel: 2 } },
    ]);
  });

  it('shows records kept from a level that is no longer the highest unlocked', () => {
    const progress = progressWith(2, {
      bests: { 'timed-90:4': { score: { value: 900, sessionId: 'sessionAAAAAAAAAAAA9', achievedAt: at(1_790_000_000_000) } } },
    });
    expect(gameOverview(progress).levels.map((row) => row.startLevel)).toEqual([1, 4]);
  });

  it('reads each history row from the trusted result only', () => {
    const { document, decision } = decide('sessionAAAAAAAAAAAA1', 1, 7, 1_790_000_000_000, null);
    const entry = (overrides: Partial<GameSessionHistoryEntry>, result?: ServerResult, processing?: object): GameSessionHistoryEntry => ({
      id: 'sessionAAAAAAAAAAAA1',
      session: readSessionProgressFields({ ...document, ...(result ? { result } : {}), ...(processing ? { processing } : {}) }),
      awaitingResult: !result && !processing,
      hasPendingWrites: false,
      ...overrides,
    });
    const valid = decision.result;
    expect(historyRow(entry({}, valid))).toMatchObject({ state: 'verified', personalBest: true, startLevel: 1, completed: true, activeMs: 90_000, score: valid.validity === 'valid' ? valid.score : -1 });
    expect(historyRow(entry({}, { ...valid, validity: 'flagged', reasons: ['run-overrun'] } as ServerResult))).toMatchObject({ state: 'flagged', personalBest: false });
    expect(historyRow(entry({}, { processedAt: at(1), scoringVersion: 1, validity: 'invalid', reasons: ['schema-invalid'] }))).toMatchObject({ state: 'invalid', score: null });
    expect(historyRow(entry({ hasPendingWrites: true }))).toMatchObject({ state: 'on-device', score: null });
    expect(historyRow(entry({}))).toMatchObject({ state: 'checking', score: null });
    expect(historyRow(entry({}, undefined, { state: 'unsupported', reason: 'unknown-game-version', attempts: 1, updatedAt: at(1) }))).toMatchObject({ state: 'delayed' });
  });

  it('reads a run whose client summary holds a number the strict reader refuses', () => {
    const { document, decision } = decide('sessionAAAAAAAAAAAA1', 1, 7, 1_790_000_000_000, null);
    const raw = { ...document, summary: { ...(document.summary as object), score: Number.NaN }, result: decision.result };
    const row = historyRow({ id: 'sessionAAAAAAAAAAAA1', session: readSessionProgressFields(raw), awaitingResult: false, hasPendingWrites: false });
    expect(row.state).toBe('verified');
    expect(row.score).toBe(decision.result.validity === 'valid' ? decision.result.score : -1);
  });

  it('formats play time with units', () => {
    expect(formatPlayTime(45_000)).toBe('45\u00A0s');
    expect(formatPlayTime(90_000)).toBe('1\u00A0min 30\u00A0s');
    expect(formatPlayTime(180_000)).toBe('3\u00A0min');
    expect(formatPlayTime(18 * 60_000 + 20_000)).toBe('18\u00A0min');
    expect(formatPlayTime(65 * 60_000)).toBe('1\u00A0h 5\u00A0min');
    expect(formatPlayTime(120 * 60_000)).toBe('2\u00A0h');
  });
});
