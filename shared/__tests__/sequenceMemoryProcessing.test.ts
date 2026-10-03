import { describe, expect, it } from 'vitest';
import {
  applyCountedSession,
  decideSession,
  evaluateSession,
  GAME_MODULE_REGISTRY,
  sequenceMemoryV1 as sm,
  type SessionEvaluation,
} from '@nfct/shared';
import { TestTimestamp } from './fixtures';
import { forgedSequenceMemory, sequenceMemorySession, type SequenceMemoryPlan } from './processingFixtures';

// Trusted scoring of Sequence Memory v1 sessions (NFCT-93), through the same
// pure pipeline the Cloud Function runs.

const ts = (ms: number) => new TestTimestamp(Math.floor(ms / 1_000), (ms % 1_000) * 1_000_000);
const T0 = 1_790_000_000_000;
const UID = 'player-1';

function session(plan: Partial<SequenceMemoryPlan> = {}): Record<string, unknown> {
  return sequenceMemorySession({ uid: UID, seed: 11, startLevel: 1, targetPeak: 4, endedAtMs: T0, ...plan }, ts);
}

function evaluate(raw: unknown): SessionEvaluation {
  return evaluateSession(raw, { uid: UID, sessionId: 'session-00000001' });
}

function codes(evaluation: SessionEvaluation): string[] {
  if (evaluation.kind === 'scored') return evaluation.entries.map(({ code }) => code);
  if (evaluation.kind === 'invalid') return evaluation.reasons;
  return [];
}

describe('trusted scoring of Sequence Memory v1', () => {
  it('scores an honest completed run as valid, with records and unlocks', () => {
    const evaluation = evaluate(session());
    expect(evaluation.kind).toBe('scored');
    expect(codes(evaluation)).toEqual([]);
    if (evaluation.kind !== 'scored') return;
    expect(evaluation.module.gameId).toBe('sequence-memory');
    expect(evaluation.scored.peakLevel).toBe(4);

    const decision = decideSession(evaluation, null, { sessionId: 'session-00000001', processedAt: ts(T0 + 2_000), registry: GAME_MODULE_REGISTRY });
    expect(decision.result).toMatchObject({
      validity: 'valid',
      reasons: [],
      peakLevel: 4,
      recordKey: 'standard:1',
      personalBest: true,
      unlocked: [{ modeId: 'standard', startLevel: 2 }, { modeId: 'standard', startLevel: 3 }],
      domainContributions: { memory: 0.6, spatial: 0.4 },
      performanceIndex: null,
    });
    expect(decision.result.validity === 'valid' && Object.keys(decision.result.recordValues).sort()).toEqual(['longestSpan', 'peakLevel', 'score']);
    expect(decision.progress).toMatchObject({ gameId: 'sequence-memory', gameVersion: 1, sessionsCompleted: 1, bestPeakLevel: { standard: 4 } });
    expect(decision.unlockRaised).toBe(true);
  });

  it('counts a Sequence Memory run in the player\'s stats summary', () => {
    const raw = session();
    const evaluation = evaluate(raw);
    if (evaluation.kind !== 'scored') throw new Error('expected scored');
    const { result } = decideSession(evaluation, null, { sessionId: 'session-00000011', processedAt: ts(T0 + 2_000), registry: GAME_MODULE_REGISTRY });
    const { summary, day } = applyCountedSession(null, null, { session: evaluation.session, result, sessionId: 'session-00000011', appliedAt: ts(T0 + 2_000) });
    expect(summary).toMatchObject({ sessions: 1, sessionsCompleted: 1, bestPeakLevel: { 'sequence-memory': 4 } });
    expect(day.games).toHaveProperty('sequence-memory');
  });

  it('scores an honest abandoned run as valid; it counts in totals only', () => {
    const evaluation = evaluate(session({ status: 'abandoned' }));
    expect(codes(evaluation)).toEqual([]);
    if (evaluation.kind !== 'scored') return;
    const decision = decideSession(evaluation, null, { sessionId: 'session-00000012', processedAt: ts(T0 + 2_000), registry: GAME_MODULE_REGISTRY });
    expect(decision.result).toMatchObject({ validity: 'valid', personalBest: false, unlocked: [] });
  });

  it.each([
    ['sequence', ['sequence-outside-level', 'sequence-not-from-seed']],
    ['level-sequence', ['level-sequence-mismatch']],
    ['response', ['correct-mismatch']],
  ] as const)('marks a forged %s invalid', (forgery, expected) => {
    const evaluation = evaluate(forgedSequenceMemory(session(), forgery));
    expect(evaluation.kind).toBe('invalid');
    expect(codes(evaluation)).toEqual(expect.arrayContaining([...expected]));
  });

  it('flags a run with too many fast taps: it counts in totals, not in records or unlocks', () => {
    const evaluation = evaluate(forgedSequenceMemory(session(), 'fast-taps'));
    expect(evaluation.kind).toBe('scored');
    expect(codes(evaluation)).toContain('tap-below-floor');
    if (evaluation.kind !== 'scored') return;
    const decision = decideSession(evaluation, null, { sessionId: 'session-00000013', processedAt: ts(T0 + 2_000), registry: GAME_MODULE_REGISTRY });
    expect(decision.result).toMatchObject({ validity: 'flagged', reasons: ['tap-below-floor'] });
    expect(decision.progress).toMatchObject({ sessionsCompleted: 1, bestPeakLevel: {} });
  });

  it('flags a run whose trials are spread apart to claim more active time', () => {
    const evaluation = evaluate(forgedSequenceMemory(session(), 'trial-gap'));
    expect(evaluation.kind).toBe('scored');
    expect(codes(evaluation)).toEqual(expect.arrayContaining(['trial-gap', 'active-duration-mismatch']));
  });

  it('treats a gameVersion outside the registry as unsupported, never invalid', () => {
    expect(evaluate({ ...session(), gameVersion: 2 })).toMatchObject({ kind: 'unsupported', reason: 'unknown-game-version' });
  });

  it('rejects a Mental Math trial shape in a Sequence Memory session', () => {
    const raw = session();
    const trials = (raw.trials as sm.SequenceMemoryTrial[]).map((trial) => ({ ...trial, expected: 3 }));
    expect(codes(evaluate({ ...raw, trials }))).toEqual(['schema-invalid']);
  });

  it('refuses more trials than a run has', () => {
    const raw = session();
    const trials = raw.trials as sm.SequenceMemoryTrial[];
    expect(codes(evaluate({ ...raw, trials: [...trials, trials[0]] }))).toEqual(['schema-invalid']);
  });
});
