import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { readSessionProgressFields, type ServerResult } from '@nfct/shared';
import type { GameSessionHistoryEntry } from '../../../repositories/gameSessionRepository';
import { clientSessionDocument } from '../runSummaryModel';
import { formatPlayTime, gameOverview, historyRow, historyRowView, progressCardSummary, type HistoryRow } from '../progressSummary';
import { currentProgress, previewDecision } from '../startLevel';
import { pickerState, playRun, progressWith, sessionRecord } from './fixtures';

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
      levels: [{ startLevel: 1, bests: null, provisional: false }],
    });
  });

  it('lists bests per start level separately, for every unlocked level', () => {
    const one = decide('sessionAAAAAAAAAAAA1', 1, 7, 1_790_000_000_000, null);
    const two = decide('sessionAAAAAAAAAAAA2', 2, 2, 1_790_000_200_000, one.decision.progress);
    const overview = gameOverview(two.decision.progress);
    const score = (result: ServerResult) => (result.validity === 'invalid' ? null : result.score);
    expect(overview).toMatchObject({ sessionsCompleted: 2, unlocked: 2, bestPeakLevel: 3 });
    expect(overview.levels).toEqual([
      { startLevel: 1, bests: { score: score(one.decision.result), correct: 7, peakLevel: 3 }, provisional: false },
      { startLevel: 2, bests: { score: score(two.decision.result), correct: 2, peakLevel: 2 }, provisional: false },
    ]);
  });

  it('marks a start level’s bests provisional while a run the server hasn’t checked holds one of them', () => {
    // Checked: a level 1 run. Pending on this device: a better level 1 run, and a weaker level 2 run.
    const checked = decide('sessionAAAAAAAAAAAA1', 1, 3, 1_790_000_000_000, null);
    const better = playRun({ seed: SEED, startLevel: 1, correct: 7, wallStartMs: 1_790_000_200_000 });
    const state = pickerState(checked.decision.progress, [sessionRecord('sessionAAAAAAAAAAAA2', better, { seed: SEED })]);
    const current = currentProgress(state);
    expect(current.unchecked).toEqual(new Set(['sessionAAAAAAAAAAAA2']));
    const levels = gameOverview(current.progress, current.unchecked).levels;
    expect(levels[0]).toMatchObject({ startLevel: 1, bests: { correct: 7 }, provisional: true });
    // Without the pending run, the server's own bests are not provisional.
    expect(gameOverview(current.checked, current.unchecked).levels[0]).toMatchObject({ bests: { correct: 3 }, provisional: false });
  });

  it('marks the Progress card’s numbers provisional only when an unchecked run changes them', () => {
    const checked = decide('sessionAAAAAAAAAAAA1', 1, 7, 1_790_000_000_000, null);
    expect(progressCardSummary(currentProgress(pickerState(checked.decision.progress)))).toEqual({ sessionsCompleted: 1, unlocked: 2, maxLevel: 10, provisional: false });
    // A finished run pending on this device counts: one more run completed, provisionally.
    const finished = playRun({ seed: SEED, startLevel: 1, correct: 1, wallStartMs: 1_790_000_200_000 });
    expect(progressCardSummary(currentProgress(pickerState(checked.decision.progress, [sessionRecord('sessionAAAAAAAAAAAA2', finished, { seed: SEED })]))))
      .toEqual({ sessionsCompleted: 2, unlocked: 2, maxLevel: 10, provisional: true });
    // An unfinished one changes neither number, so nothing shown is provisional.
    const quit = { ...finished, status: 'abandoned' as const };
    expect(progressCardSummary(currentProgress(pickerState(checked.decision.progress, [sessionRecord('sessionAAAAAAAAAAAA3', quit, { seed: SEED })]))))
      .toMatchObject({ sessionsCompleted: 1, provisional: false });
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
    expect(historyRow(entry({}, valid))).toMatchObject({ state: 'verified', personalBest: true, startLevel: 1, completed: true, activeMs: document.activeDurationMs, score: valid.validity === 'valid' ? valid.score : -1 });
    expect(historyRow(entry({}, valid))).toMatchObject({ awaitingUnlock: false });
    expect(historyRow(entry({}, { ...valid, validity: 'flagged', reasons: ['run-overrun'] } as ServerResult))).toMatchObject({ state: 'flagged', personalBest: false, awaitingUnlock: false });
    // Waiting on its start level to unlock only when that is the server's sole reason.
    const flaggedFor = (reasons: string[]) => historyRow(entry({}, { ...valid, validity: 'flagged', reasons } as ServerResult));
    expect(flaggedFor(['start-level-locked'])).toMatchObject({ state: 'flagged', awaitingUnlock: true });
    for (const reasons of [['rt-below-floor', 'start-level-locked'], ['start-level-locked', 'reasons-truncated'], ['start-level-locked', 'some-future-code']]) {
      expect(flaggedFor(reasons)).toMatchObject({ state: 'flagged', awaitingUnlock: false });
    }
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

  it('reads each row at a glance: score, pending or none, and at most one tag (NFCT-64)', () => {
    const row = (overrides: Partial<HistoryRow>): HistoryRow => ({
      id: 'sessionAAAAAAAAAAAA1', endedAtMs: 0, startLevel: 1, completed: true, activeMs: 90_000,
      state: 'verified', score: 500, personalBest: false, awaitingUnlock: false, ...overrides,
    });
    expect(historyRowView(row({}))).toEqual({ score: { kind: 'score', value: 500, muted: false }, tag: null });
    expect(historyRowView(row({ personalBest: true }))).toEqual({ score: { kind: 'score', value: 500, muted: false }, tag: 'new-best' });
    expect(historyRowView(row({ state: 'flagged' })).tag).toBe('flagged');
    expect(historyRowView(row({ state: 'flagged', awaitingUnlock: true }))).toEqual({ score: { kind: 'score', value: 500, muted: false }, tag: 'awaiting-unlock' });
    expect(historyRowView(row({ state: 'invalid', score: null }))).toEqual({ score: { kind: 'none' }, tag: 'not-counted' });
    for (const state of ['checking', 'delayed'] as const) expect(historyRowView(row({ state, score: null }))).toEqual({ score: { kind: 'pending' }, tag: null });
    expect(historyRowView(row({ state: 'on-device', score: null }))).toEqual({ score: { kind: 'pending' }, tag: 'not-uploaded' });
    // Ended early: one tag, its score kept (quieter), and pending stays pending.
    expect(historyRowView(row({ completed: false, score: 120 }))).toEqual({ score: { kind: 'score', value: 120, muted: true }, tag: 'ended-early' });
    expect(historyRowView(row({ completed: false, state: 'flagged', score: 120 })).tag).toBe('ended-early');
    expect(historyRowView(row({ completed: false, state: 'flagged', awaitingUnlock: true, score: 120 })).tag).toBe('ended-early');
    expect(historyRowView(row({ completed: false, state: 'checking', score: null }))).toEqual({ score: { kind: 'pending' }, tag: 'ended-early' });
    expect(historyRowView(row({ completed: false, state: 'invalid', score: null }))).toEqual({ score: { kind: 'none' }, tag: 'not-counted' });
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
