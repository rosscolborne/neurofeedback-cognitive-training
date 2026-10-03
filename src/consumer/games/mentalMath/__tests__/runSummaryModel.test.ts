import { describe, expect, it } from 'vitest';
import { mentalMath, type GameProgress, type ServerResult } from '@nfct/shared';
import type { GameSessionRecord } from '../../../repositories/gameSessionRepository';
import type { RunOutcome } from '../runController';
import { clientSessionDocument, nextUnlock, runSummary, type RunIdentity, type SaveStatus } from '../runSummaryModel';
import { previewDecision } from '../startLevel';
import { pickerState, playRun, progressWith, sessionRecord } from './fixtures';

const SEED = 4242;
const ENVIRONMENT = { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' } as const;
const RUN: RunIdentity = { sessionId: 'sessionAAAAAAAAAAAA1', userId: 'player-1', seed: SEED };
const OLDER = 'sessionAAAAAAAAAAAA0';

/** Seven right answers from level 1: the staircase reaches level 3, which unlocks start level 2. */
const climb = (wallStartMs?: number) => playRun({ seed: SEED, startLevel: 1, correct: 7, wallStartMs });
const weak = (wallStartMs?: number) => playRun({ seed: SEED, startLevel: 1, correct: 1, wallStartMs });

/** This run as the listener reports it: pending on this device, or with trusted scoring's result. */
function stored(outcome: RunOutcome, result?: ServerResult, id = RUN.sessionId): GameSessionRecord {
  const record = sessionRecord(id, outcome, { awaitingResult: result === undefined, seed: SEED });
  return result ? { ...record, session: { ...record.session, result } } : record;
}

/** What trusted scoring writes for this run against `progress` (the shared decision the Cloud Function makes). */
function trusted(outcome: RunOutcome, progress: GameProgress | null, id = RUN.sessionId) {
  const decision = previewDecision(progress, id, clientSessionDocument(outcome, ENVIRONMENT, { ...RUN, sessionId: id }));
  if (!decision) throw new Error('no decision');
  return decision;
}

function summary(outcome: RunOutcome, save: SaveStatus, state: Parameters<typeof runSummary>[0]['state']) {
  return runSummary({ outcome, environment: ENVIRONMENT, run: RUN, save, state });
}

describe('post-session summary', () => {
  it('shows the local score at once, marked provisional, while records load', () => {
    const outcome = climb();
    const model = summary(outcome, 'saving', null);
    const local = mentalMath.score(outcome.run.trials, { modeId: 'timed-90', startLevel: 1 });
    expect(model.verification).toEqual({ kind: 'provisional', detail: 'saving' });
    expect(model.score).toBe(local.score);
    expect(model.breakdown).toEqual({ difficultyPoints: local.metrics.difficultyPoints, speedBonusPoints: local.metrics.speedBonusPoints });
    expect(model.breakdown!.difficultyPoints + model.breakdown!.speedBonusPoints).toBe(model.score);
    expect(model.record).toEqual({ kind: 'loading' });
    expect(model.unlock).toEqual({ kind: 'loading' });
    expect(model.totals).toBeNull();
  });

  it('previews a first run with the shared decision: a new best for its start level, an unlock, and totals', () => {
    const outcome = climb();
    const model = summary(outcome, 'confirmed', pickerState(null, [stored(outcome)]));
    expect(model.verification).toEqual({ kind: 'provisional', detail: 'checking' });
    expect(model.record).toEqual({ kind: 'new-best', startLevel: 1, metrics: ['score', 'correct', 'peakLevel'] });
    expect(model.unlock).toEqual({ kind: 'unlocked', levels: [2] });
    expect(model.totals).toEqual({ sessionsCompleted: 1, activeMs: outcome.activeDurationMs, includesUnverified: true });
  });

  it('says the run is waiting to upload while it is only on this device', () => {
    const outcome = climb();
    expect(summary(outcome, 'queued', pickerState(null, [stored(outcome)])).verification).toEqual({ kind: 'provisional', detail: 'on-device' });
  });

  it('replaces the preview with the trusted result when it arrives', () => {
    const outcome = climb();
    const decision = trusted(outcome, null);
    if (decision.result.validity !== 'valid') throw new Error('expected a valid result');
    // A trusted score that differs from the device's, to show which one is displayed.
    const result: ServerResult = { ...decision.result, score: 1234, metrics: { ...decision.result.metrics, difficultyPoints: 1000, speedBonusPoints: 234 } };
    const model = summary(outcome, 'confirmed', pickerState(decision.progress, [stored(outcome, result)]));
    expect(model.verification).toEqual({ kind: 'verified' });
    expect(model.score).toBe(1234);
    expect(model.breakdown).toEqual({ difficultyPoints: 1000, speedBonusPoints: 234 });
    expect(model.record).toEqual({ kind: 'new-best', startLevel: 1, metrics: ['score', 'correct', 'peakLevel'] });
    expect(model.unlock).toEqual({ kind: 'unlocked', levels: [2] });
    expect(model.totals).toEqual({ sessionsCompleted: 1, activeMs: outcome.activeDurationMs, includesUnverified: false });
  });

  it('shows no new best for a lower-scoring repeat at the same start level, and names the best to beat', () => {
    const first = trusted(climb(1_790_000_000_000), null, OLDER);
    const repeat = weak(1_790_000_200_000);
    const decision = trusted(repeat, first.progress);
    expect(decision.result.validity === 'valid' && decision.result.personalBest).toBe(false);
    const model = summary(repeat, 'confirmed', pickerState(decision.progress, [stored(repeat, decision.result)]));
    const best = first.result.validity === 'valid' ? first.result.score : null;
    expect(model.record).toEqual({ kind: 'best-so-far', startLevel: 1, bestScore: best });
    expect(model.unlock).toEqual({ kind: 'next', unlocked: 2, nextLevel: 3, reachLevel: 4 });
    expect(model.totals?.sessionsCompleted).toBe(2);
  });

  it('keeps separate bests per start level: a first run at level 2 is a new best there', () => {
    const levelOne = trusted(climb(1_790_000_000_000), null, OLDER);
    const levelTwo = playRun({ seed: SEED, startLevel: 2, correct: 1, wallStartMs: 1_790_000_200_000 });
    const decision = trusted(levelTwo, levelOne.progress);
    const model = summary(levelTwo, 'confirmed', pickerState(decision.progress, [stored(levelTwo, decision.result)]));
    expect(model.record).toMatchObject({ kind: 'new-best', startLevel: 2 });
    expect(decision.progress!.bests['timed-90:1']!.score!.sessionId).toBe(OLDER);
    expect(decision.progress!.bests['timed-90:2']!.score!.sessionId).toBe(RUN.sessionId);
  });

  it('previews against the other runs still pending on this device, so an unlock is announced once', () => {
    const older = climb(1_790_000_000_000);
    const outcome = weak(1_790_000_200_000);
    const model = summary(outcome, 'queued', pickerState(null, [stored(outcome), stored(older, undefined, OLDER)]));
    expect(model.unlock).toEqual({ kind: 'next', unlocked: 2, nextLevel: 3, reachLevel: 4 });
    expect(model.record).toMatchObject({ kind: 'best-so-far', startLevel: 1 });
    expect(model.totals).toMatchObject({ sessionsCompleted: 2, includesUnverified: true });
  });

  it('explains a flagged run: it counts in totals but sets no records or unlocks', () => {
    const outcome = climb();
    const decision = trusted(outcome, null);
    const flagged = { ...decision.result, validity: 'flagged', reasons: ['rt-below-floor'] } as ServerResult;
    const model = summary(outcome, 'confirmed', pickerState(progressWith(1), [stored(outcome, flagged)]));
    expect(model.verification).toEqual({ kind: 'flagged', reasons: ['rt-below-floor'], upgradable: false });
    expect(model.score).toBe(decision.result.validity === 'valid' ? decision.result.score : null);
    expect(model.record).toMatchObject({ kind: 'ineligible', reason: 'flagged' });
    expect(model.unlock).toMatchObject({ kind: 'next', unlocked: 1 });
  });

  it('says a run flagged only for a locked start level can still count: trusted scoring upgrades it once the level unlocks', () => {
    const outcome = playRun({ seed: SEED, startLevel: 2, correct: 3 });
    const decision = trusted(outcome, null);
    expect(decision.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    const lockedOnly = summary(outcome, 'confirmed', pickerState(null, [stored(outcome, decision.result)]));
    expect(lockedOnly.verification).toEqual({ kind: 'flagged', reasons: ['start-level-locked'], upgradable: true });
    expect(lockedOnly.record).toEqual({ kind: 'ineligible', startLevel: 2, reason: 'flagged', bestScore: null, upgradable: true });
    // The preview predicts the same before the server has checked it.
    expect(summary(outcome, 'confirmed', pickerState(null, [stored(outcome)])).record).toMatchObject({ reason: 'flagged', upgradable: true });
    // Another flag as well: the upgrade never applies (ADR-001 decision 12).
    const alsoFast = { ...decision.result, reasons: ['start-level-locked', 'rt-below-floor'] } as ServerResult;
    const both = summary(outcome, 'confirmed', pickerState(null, [stored(outcome, alsoFast)]));
    expect(both.verification).toMatchObject({ upgradable: false });
    expect(both.record).toMatchObject({ reason: 'flagged', upgradable: false });
  });

  it('never promises records to an unfinished run at a locked start level: the upgrade gives it none', () => {
    const quit: RunOutcome = { ...playRun({ seed: SEED, startLevel: 2, correct: 3 }), status: 'abandoned' };
    const decision = trusted(quit, null);
    expect(decision.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    const checked = summary(quit, 'confirmed', pickerState(null, [stored(quit, decision.result)]));
    expect(checked.verification).toEqual({ kind: 'flagged', reasons: ['start-level-locked'], upgradable: false });
    expect(checked.record).toEqual({ kind: 'ineligible', startLevel: 2, reason: 'flagged', bestScore: null, upgradable: false });
    // The preview says the same before the server has checked it.
    expect(summary(quit, 'confirmed', pickerState(null, [stored(quit)])).record).toMatchObject({ reason: 'flagged', upgradable: false });
  });

  it('says the totals include an unchecked run only when the preview counts this run, or another pending one', () => {
    // Predicted invalid (its questions are not from the seed it names): counted nowhere, so the totals are all checked.
    const outcome = climb();
    const forged = runSummary({ outcome, environment: ENVIRONMENT, run: { ...RUN, seed: SEED + 1 }, save: 'confirmed', state: pickerState(progressWith(1), [stored(outcome)]) });
    expect(forged.verification).toMatchObject({ kind: 'provisional' });
    expect(forged.record).toMatchObject({ kind: 'ineligible', reason: 'invalid' });
    expect(forged.totals).toEqual({ sessionsCompleted: 1, activeMs: 0, includesUnverified: false });

    // Predicted flagged (start level 2 is still locked): it counts in the totals, so they include an unchecked run.
    const locked = playRun({ seed: SEED, startLevel: 2, correct: 3 });
    const flagged = summary(locked, 'confirmed', pickerState(null, [stored(locked)]));
    expect(flagged.record).toMatchObject({ kind: 'ineligible', reason: 'flagged' });
    expect(flagged.totals).toMatchObject({ sessionsCompleted: 1, includesUnverified: true });

    // Checked by the server, with another run still pending on this device.
    const older = weak(1_790_000_000_000);
    const decision = trusted(outcome, null);
    const withPending = summary(outcome, 'confirmed', pickerState(decision.progress, [stored(outcome, decision.result), stored(older, undefined, OLDER)]));
    expect(withPending.totals).toMatchObject({ includesUnverified: true });
    expect(summary(outcome, 'confirmed', pickerState(decision.progress, [stored(outcome, decision.result)])).totals).toMatchObject({ includesUnverified: false });
  });

  it('shows no score for a run trusted scoring found invalid', () => {
    const outcome = climb();
    const invalid = { processedAt: outcome.run.trials.length, scoringVersion: 1, validity: 'invalid', reasons: ['question-not-from-seed'] } as unknown as ServerResult;
    const model = summary(outcome, 'confirmed', pickerState(null, [stored(outcome, invalid)]));
    expect(model.verification).toEqual({ kind: 'invalid', reasons: ['question-not-from-seed'] });
    expect(model.score).toBeNull();
    expect(model.breakdown).toBeNull();
    expect(model.record).toMatchObject({ kind: 'ineligible', reason: 'invalid' });
  });

  it('never gives an unfinished run a record or an unlock', () => {
    const outcome: RunOutcome = { ...climb(), status: 'abandoned' };
    const model = summary(outcome, 'confirmed', pickerState(null, [stored(outcome)]));
    expect(model.record).toMatchObject({ kind: 'ineligible', reason: 'abandoned' });
    expect(model.unlock).toEqual({ kind: 'next', unlocked: 1, nextLevel: 2, reachLevel: 3 });
    expect(model.totals).toMatchObject({ sessionsCompleted: 0 });
  });

  it('says when trusted scoring could not process the run yet', () => {
    const outcome = climb();
    const record = stored(outcome);
    const delayed = { ...record, awaitingResult: false, session: { ...record.session, processing: { state: 'failed', reason: 'internal-error', attempts: 1, updatedAt: record.session.endedAt } } };
    expect(summary(outcome, 'confirmed', pickerState(null, [delayed])).verification).toEqual({ kind: 'provisional', detail: 'delayed' });
  });

  it('does not count a run that was not saved', () => {
    const outcome = climb();
    const model = summary(outcome, 'failed', pickerState(progressWith(1), []));
    expect(model.verification).toEqual({ kind: 'not-saved' });
    expect(model.record).toMatchObject({ kind: 'ineligible', reason: 'not-saved' });
    expect(model.totals).toMatchObject({ sessionsCompleted: 1, includesUnverified: false });
  });

  it('describes the next unlock from the mode’s own policy', () => {
    expect(nextUnlock(null)).toEqual({ kind: 'next', unlocked: 1, nextLevel: 2, reachLevel: 3 });
    expect(nextUnlock(progressWith(5))).toEqual({ kind: 'next', unlocked: 4, nextLevel: 5, reachLevel: 6 });
    // Level 10 unlocks itself once it is reached.
    expect(nextUnlock(progressWith(9))).toEqual({ kind: 'next', unlocked: 8, nextLevel: 10, reachLevel: 10 });
    expect(nextUnlock(progressWith(10))).toEqual({ kind: 'all', maxLevel: 10 });
  });
});
