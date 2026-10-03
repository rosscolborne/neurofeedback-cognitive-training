import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createGameModuleRegistry,
  defineGame,
  defineGameVersionModule,
  MAX_RESULT_REASONS,
  mentalMathV1 as mm,
  mentalMathV1Module,
} from '@nfct/shared';
import { forgedEverything } from '../../../shared/__tests__/processingFixtures';
import { handleSessionCreated, runSessionPipeline } from '../../src/pipeline';
import { processSession, recordProcessingState } from '../../src/processSession';
import { rebuildUserProgress } from '../../src/rebuild';
import { reconcileUpgrades } from '../../src/reconcile';
import { reconcileUser, redriveSessions } from '../../src/redrive';
import { sweepSessions } from '../../src/sweep';
import { coreContext, minutesAgo, writeSession, writeSessionAt } from '../helpers/core';
import {
  content,
  CORE_PROJECT,
  emulatorFirestore,
  newSessionId,
  newUid,
  progressPath,
  readDoc,
  sessionDoc,
  sessionPath,
  ts,
} from '../helpers/emulator';

// The processing core against the Firestore emulator (no trigger runs in this
// project), so each test controls exactly when and how often a session is
// processed.

const { db, close } = emulatorFirestore(CORE_PROJECT);
const context = coreContext(db);
afterAll(close);

describe('trusted session processing', () => {
  it('writes a valid result and creates progress for a new user\'s first session at level 1', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 1, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5) });

    const report = await runSessionPipeline(context, uid, id);

    expect(report.outcome).toMatchObject({ status: 'processed', validity: 'valid' });
    const session = await readDoc(db, sessionPath(uid, id));
    expect(session?.result).toMatchObject({
      validity: 'valid',
      reasons: [],
      scoringVersion: 1,
      performanceIndex: null,
      performanceIndexVersion: null,
      peakLevel: 4,
      recordKey: 'timed-90:1',
      personalBest: true,
    });
    expect(session?.processing).toBeUndefined();
    const progress = await readDoc(db, progressPath(uid));
    expect(progress).toMatchObject({
      schemaVersion: 1,
      aggregateVersion: 1,
      gameId: 'mental-math',
      gameVersion: 1,
      sessionsCompleted: 1,
      activeMs: 90_000,
      bestPeakLevel: { 'timed-90': 4 },
      unlocked: { 'timed-90': 3 },
    });
    // Written by one transaction: progress was updated at the instant the result was processed.
    expect(progress?.updatedAt).toEqual(session?.result.processedAt);
  });

  it('writes nothing when processing fails inside the transaction before it commits; a later delivery applies it once', async () => {
    const uid = newUid();
    const locked = await writeSession(db, uid, { seed: 16, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
    await runSessionPipeline(context, uid, locked.id);
    const unlocking = await writeSession(db, uid, { seed: 17, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 2 });
    const before = { locked: await readDoc(db, sessionPath(uid, locked.id)), progress: await readDoc(db, progressPath(uid)) };
    // A fault after the decision, while the transaction plans the upgrade its unlock makes possible.
    const faulty = coreContext(db, {
      registry: createGameModuleRegistry([{
        ...mentalMathV1Module,
        recordValuesFromStored: () => { throw new Error('fault inside the transaction'); },
      }]),
    });

    await expect(handleSessionCreated(faulty, { params: { uid, sessionId: unlocking.id }, time: new Date().toISOString() }))
      .rejects.toThrow(/fault inside the transaction/);

    expect(await readDoc(db, sessionPath(uid, unlocking.id))).toEqual(unlocking.doc);
    expect(await readDoc(db, sessionPath(uid, locked.id))).toEqual(before.locked);
    expect(await readDoc(db, progressPath(uid))).toEqual(before.progress);

    // The redelivery commits everything at once; a delivery after that commit changes nothing.
    await runSessionPipeline(context, uid, unlocking.id);
    const committed = { progress: await readDoc(db, progressPath(uid)), unlocking: await readDoc(db, sessionPath(uid, unlocking.id)) };
    expect(committed.unlocking?.result.validity).toBe('valid');
    expect((await readDoc(db, sessionPath(uid, locked.id)))?.result.validity).toBe('valid');
    expect(committed.progress).toMatchObject({ sessionsCompleted: 2, activeMs: 180_000 });
    expect((await runSessionPipeline(context, uid, unlocking.id)).outcome.status).toBe('already-processed');
    expect(await readDoc(db, progressPath(uid))).toEqual(committed.progress);
    expect(await readDoc(db, sessionPath(uid, unlocking.id))).toEqual(committed.unlocking);
  });

  it('rescores from the trials: the client summary and peak level are never trusted', async () => {
    const uid = newUid();
    const id = newSessionId();
    const doc = sessionDoc(uid, { seed: 2, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) });
    const summary = doc.summary as Record<string, unknown>;
    await db.doc(sessionPath(uid, id)).set({ ...doc, peakLevel: 10, summary: { ...summary, score: 999_999, accuracy: 7 } });

    await runSessionPipeline(context, uid, id);

    const { result } = (await readDoc(db, sessionPath(uid, id)))!;
    expect(result).toMatchObject({ validity: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch'], peakLevel: 3 });
    expect(result.score).toBe(mm.score(doc.trials as mm.MentalMathTrial[], { modeId: 'timed-90', startLevel: 1 }).score);
    expect((await readDoc(db, progressPath(uid)))?.bestPeakLevel).toEqual({ 'timed-90': 3 });
  });

  it('keeps a session valid when its display summary holds NaN or Infinity (numbers to the rules)', async () => {
    const uid = newUid();
    const id = newSessionId();
    const doc = sessionDoc(uid, { seed: 14, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) });
    const summary = doc.summary as Record<string, unknown>;
    await db.doc(sessionPath(uid, id)).set({ ...doc, summary: { ...summary, score: Number.NaN, accuracy: Number.POSITIVE_INFINITY } });

    await runSessionPipeline(context, uid, id);

    expect((await readDoc(db, sessionPath(uid, id)))?.result).toMatchObject({ validity: 'valid', reasons: ['summary-mismatch'] });
  });

  it('marks a session with an envelope field this build does not know unsupported (rules deployed before Functions)', async () => {
    const uid = newUid();
    const id = newSessionId();
    const doc = sessionDoc(uid, { seed: 15, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) });
    await db.doc(sessionPath(uid, id)).set({ ...doc, futureOptionalField: 'x' });

    await runSessionPipeline(context, uid, id);

    const session = await readDoc(db, sessionPath(uid, id));
    expect(session?.result).toBeUndefined();
    expect(session?.processing).toMatchObject({ state: 'unsupported', reason: 'unknown-session-field', attempts: 1 });
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  it('flags a first session at level 2 start-level-locked: totals only, no record', async () => {
    const uid = newUid();
    const { id } = await writeSession(db, uid, { seed: 3, startLevel: 2, targetPeak: 5, endedAtMs: minutesAgo(5) });

    await runSessionPipeline(context, uid, id);

    expect((await readDoc(db, sessionPath(uid, id)))?.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000, bests: {}, bestPeakLevel: {}, unlocked: {} });
  });

  it('counts an invalid session nowhere (seed mismatch)', async () => {
    const uid = newUid();
    const id = newSessionId();
    const doc = sessionDoc(uid, { seed: 4, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) });
    await db.doc(sessionPath(uid, id)).set({ ...doc, seed: 5 });

    await runSessionPipeline(context, uid, id);

    const { result } = (await readDoc(db, sessionPath(uid, id)))!;
    expect(result.validity).toBe('invalid');
    expect(result.reasons).toContain('question-not-from-seed');
    expect(Object.keys(result).sort()).toEqual(['processedAt', 'reasons', 'scoringVersion', 'validity']);
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  it('records a forged session raising every reason: the result is cut to 20 reasons and written once', async () => {
    const uid = newUid();
    await db.doc(sessionPath(uid, 'bad')).set(forgedEverything(ts, minutesAgo(5)));

    await runSessionPipeline(context, uid, 'bad');

    const { result } = (await readDoc(db, sessionPath(uid, 'bad')))!;
    expect(result.validity).toBe('invalid');
    expect(result.reasons).toHaveLength(MAX_RESULT_REASONS);
    expect(result.reasons.at(-1)).toBe('reasons-truncated');
    expect(result.reasons).toEqual(expect.arrayContaining([...Object.keys(mm.REASON_OUTCOMES), 'user-id-mismatch', 'session-id-invalid']));
  });

  describe('exactly once', () => {
    it('changes nothing when the trigger is replayed', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 6, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(5) });
      await runSessionPipeline(context, uid, id);
      const session = await readDoc(db, sessionPath(uid, id));
      const progress = await readDoc(db, progressPath(uid));

      const replay = await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date().toISOString() });
      await runSessionPipeline(context, uid, id);

      expect(replay?.outcome.status).toBe('already-processed');
      expect(await readDoc(db, sessionPath(uid, id))).toEqual(session);
      expect(await readDoc(db, progressPath(uid))).toEqual(progress);
    });

    it('applies totals once under concurrent duplicate deliveries', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 7, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5) });

      const outcomes = await Promise.all(Array.from({ length: 6 }, () => runSessionPipeline(context, uid, id)));

      expect(outcomes.filter(({ outcome }) => outcome.status === 'processed')).toHaveLength(1);
      expect(outcomes.filter(({ outcome }) => outcome.status === 'already-processed')).toHaveLength(5);
      expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000 });
    });

    it('loses no totals when different sessions of one user are processed concurrently', async () => {
      const uid = newUid();
      const written = await Promise.all(Array.from({ length: 5 }, (_, index) =>
        writeSession(db, uid, { seed: 100 + index, startLevel: 1, targetPeak: 2, endedAtMs: minutesAgo(50 - index), order: index })));

      await Promise.all(written.map(({ id }) => runSessionPipeline(context, uid, id)));

      expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 5, activeMs: 450_000 });
    });
  });

  describe('processing metadata', () => {
    it('marks a session of a game version with no module unsupported, not invalid, and re-drives it once one is registered', async () => {
      const uid = newUid();
      const id = newSessionId();
      const doc = sessionDoc(uid, { seed: 8, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) });
      await db.doc(sessionPath(uid, id)).set({ ...doc, gameVersion: 3 });

      await runSessionPipeline(context, uid, id);
      const unsupported = await readDoc(db, sessionPath(uid, id));
      expect(unsupported?.result).toBeUndefined();
      expect(unsupported?.processing).toMatchObject({ state: 'unsupported', reason: 'unknown-game-version', attempts: 1 });
      expect(await readDoc(db, progressPath(uid))).toBeUndefined();

      // A later deploy registers gameVersion 3 (here a copy of v1's rules) and the admin re-drive picks it up.
      const v3 = defineGameVersionModule({
        definition: defineGame({ ...mm.definition, gameVersion: 3 }),
        reasonOutcomes: mm.REASON_OUTCOMES,
        check: (session) => mm.checkSession(session),
      });
      const later = coreContext(db, { registry: createGameModuleRegistry([mentalMathV1Module, v3]) });
      const { results } = await redriveSessions(later, {
        states: ['unsupported'], uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: false,
      });

      expect(results).toMatchObject([{ sessionId: id, state: 'unsupported', now: 'valid' }]);
      const processed = await readDoc(db, sessionPath(uid, id));
      expect(processed?.result).toMatchObject({ validity: 'valid' });
      expect(processed?.processing).toBeUndefined();
      expect(await readDoc(db, progressPath(uid))).toMatchObject({ gameVersion: 3, sessionsCompleted: 1 });
    });

    it('judges a late session of an earlier game version with that version\'s own frozen module', async () => {
      // A build that registers v1 and a v2 whose checks flag every session and whose scoringVersion differs.
      const v2 = defineGameVersionModule({
        definition: defineGame({ ...mm.definition, gameVersion: 2, scoringVersion: 7 }),
        reasonOutcomes: mm.REASON_OUTCOMES,
        check: () => ({ outcome: 'flagged', reasons: ['rt-below-floor'] }),
      });
      const both = coreContext(db, { registry: createGameModuleRegistry([mentalMathV1Module, v2]) });
      const uid = newUid();
      const newer = newSessionId(2);
      await db.doc(sessionPath(uid, newer)).set({
        ...sessionDoc(uid, { seed: 18, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5), createdAt: ts(Date.now()) }), gameVersion: 2,
      });
      await runSessionPipeline(both, uid, newer);
      expect((await readDoc(db, sessionPath(uid, newer)))?.result).toMatchObject({ validity: 'flagged', scoringVersion: 7, reasons: ['rt-below-floor'] });

      // A v1 session queued offline arrives after the v2 one.
      const late = await writeSession(db, uid, { seed: 19, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(30), order: 1 });
      await runSessionPipeline(both, uid, late.id);

      const result = (await readDoc(db, sessionPath(uid, late.id)))?.result;
      expect(result).toMatchObject({ validity: 'valid', scoringVersion: 1, reasons: [], recordKey: 'timed-90:1' });
      expect(result.score).toBe(mm.score(late.doc.trials as mm.MentalMathTrial[], { modeId: 'timed-90', startLevel: 1 }).score);
      const progress = await readDoc(db, progressPath(uid));
      // Its records go to its own version's (archived) record set; the unlock it earned carries over.
      expect(progress).toMatchObject({ gameVersion: 2, sessionsCompleted: 2, bests: {}, bestPeakLevel: { 'timed-90': 5 }, unlocked: { 'timed-90': 4 } });
      expect(progress?.bestsArchive['1']['timed-90:1'].score.sessionId).toBe(late.id);
    });

    it('processes a saved fixed 90 s v1 run and a time-bank v2 run, each by its own rules, as valid (NFCT-60)', async () => {
      const uid = newUid();
      const legacy = await writeSession(db, uid, { seed: 41, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(30), order: 1 });
      await runSessionPipeline(context, uid, legacy.id);
      expect(legacy.doc).toMatchObject({ gameVersion: 1, activeDurationMs: 90_000 });
      expect((await readDoc(db, sessionPath(uid, legacy.id)))?.result).toMatchObject({ validity: 'valid', reasons: [], recordKey: 'timed-90:1' });

      const timeBank = await writeSession(db, uid, { seed: 42, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(10), order: 2, gameVersion: 2 });
      await runSessionPipeline(context, uid, timeBank.id);
      expect(timeBank.doc.gameVersion).toBe(2);
      expect(timeBank.doc.activeDurationMs).not.toBe(90_000);
      expect((await readDoc(db, sessionPath(uid, timeBank.id)))?.result).toMatchObject({ validity: 'valid', reasons: [], recordKey: 'timed-90:1', personalBest: true });
      expect(await readDoc(db, progressPath(uid))).toMatchObject({
        gameVersion: 2, sessionsCompleted: 2, activeMs: 90_000 + (timeBank.doc.activeDurationMs as number), unlocked: { 'timed-90': 3 },
      });
    });

    it('records a scorer fault as failed after the retry window; a later re-drive applies the session exactly once', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 20, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5) });
      const broken = coreContext(db, {
        registry: createGameModuleRegistry([defineGameVersionModule({
          definition: mm.definition,
          reasonOutcomes: mm.REASON_OUTCOMES,
          check: () => { throw new Error('scorer fault'); },
        })]),
      });
      const event = (ageMs: number) => ({ params: { uid, sessionId: id }, time: new Date(Date.now() - ageMs).toISOString() });

      await expect(handleSessionCreated(broken, event(0))).rejects.toThrow(/scorer fault/);
      expect((await readDoc(db, sessionPath(uid, id)))?.processing).toBeUndefined();
      await handleSessionCreated(broken, event(broken.limits.retryWindowMs + 1_000));
      const failed = await readDoc(db, sessionPath(uid, id));
      expect(failed?.result).toBeUndefined();
      expect(failed?.processing).toMatchObject({ state: 'failed', reason: 'internal-error', attempts: 1 });
      expect(await readDoc(db, progressPath(uid))).toBeUndefined();

      // The fix is deployed; the re-drive processes it, and any later re-drive or delivery is a no-op.
      const options = { states: ['failed', 'pending'] as const, uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: false };
      expect((await redriveSessions(context, options)).results).toMatchObject([{ sessionId: id, state: 'failed', now: 'valid' }]);
      const once = { session: await readDoc(db, sessionPath(uid, id)), progress: await readDoc(db, progressPath(uid)) };
      expect(once.session?.processing).toBeUndefined();
      expect(once.progress).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000 });
      expect((await redriveSessions(context, options)).targets).toEqual([]);
      expect((await runSessionPipeline(context, uid, id)).outcome.status).toBe('already-processed');
      expect({ session: await readDoc(db, sessionPath(uid, id)), progress: await readDoc(db, progressPath(uid)) }).toEqual(once);
    });

    it('never records processing metadata on a session that already has a result', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 9, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });
      await runSessionPipeline(context, uid, id);
      const before = await readDoc(db, sessionPath(uid, id));

      expect(await recordProcessingState(context, uid, id, 'failed', 'internal-error')).toBe('already-processed');
      expect(await readDoc(db, sessionPath(uid, id))).toEqual(before);
    });

    it('retries within the window, records failed after it, and clears failed atomically on a later success', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 10, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });
      // Progress from newer code blocks processing (it must never be overwritten).
      const newer = { schemaVersion: 2, aggregateVersion: 7, note: 'written by a newer build' };
      await db.doc(progressPath(uid)).set(newer);
      const event = (ageMs: number) => ({ params: { uid, sessionId: id }, time: new Date(Date.now() - ageMs).toISOString() });

      await expect(handleSessionCreated(context, event(60_000))).rejects.toThrow(/newer code/);
      expect((await readDoc(db, sessionPath(uid, id)))?.processing).toBeUndefined();

      await handleSessionCreated(context, event(context.limits.retryWindowMs + 60_000));
      await handleSessionCreated(context, event(context.limits.retryWindowMs + 60_000));
      const failed = await readDoc(db, sessionPath(uid, id));
      expect(failed?.result).toBeUndefined();
      expect(failed?.processing).toMatchObject({ state: 'failed', reason: 'progress-newer-than-code', attempts: 2 });
      expect(await readDoc(db, progressPath(uid))).toEqual(newer);

      // The newer progress goes away (for example after a roll-forward rebuild); a re-drive succeeds.
      await db.doc(progressPath(uid)).delete();
      const { results } = await redriveSessions(context, {
        states: ['failed'], uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: false,
      });
      expect(results).toMatchObject([{ sessionId: id, now: 'valid' }]);
      const processed = await readDoc(db, sessionPath(uid, id));
      expect(processed?.result.validity).toBe('valid');
      expect(processed?.processing).toBeUndefined();
    });

    it('re-drives a pending session whose trigger never completed', async () => {
      const uid = newUid();
      const { id } = await writeSession(db, uid, { seed: 11, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(5) });

      const dry = await redriveSessions(context, {
        states: ['pending'], uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: true,
      });
      expect(dry.targets.map(({ sessionId }) => sessionId)).toEqual([id]);
      expect((await readDoc(db, sessionPath(uid, id)))?.result).toBeUndefined();

      const { results } = await redriveSessions(context, {
        states: ['pending'], createdAfter: ts(Date.now() - 60 * 60_000), createdBefore: ts(Date.now() + 60_000), limit: 500, scanBudget: 5_000, dryRun: false,
      });
      expect(results).toContainEqual(expect.objectContaining({ uid, sessionId: id, state: 'pending', now: 'valid' }));
    });
  });

  describe('the deletion ledger', () => {
    const ledger = (uid: string) => db.doc(`accountDeletions/${uid}`).set({ status: 'requested', requestedAt: ts(Date.now()) });

    it('stops processing from writing anything for an account being deleted: no result, no processing, no progress', async () => {
      const uid = newUid();
      const { id, doc } = await writeSession(db, uid, { seed: 90, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(5) });
      await ledger(uid);

      expect((await runSessionPipeline(context, uid, id)).outcome).toEqual({ status: 'account-deleted' });
      // Past the retry window a failing delivery would record 'failed'; not for a deleted account.
      await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date(0).toISOString() });
      expect(await recordProcessingState(context, uid, id, 'failed', 'internal-error')).toBe('account-deleted');
      const { results } = await redriveSessions(context, {
        states: ['pending'], uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: false,
      });
      expect(results).toMatchObject([{ sessionId: id, now: 'account-deleted' }]);

      expect(await readDoc(db, sessionPath(uid, id))).toEqual(doc);
      expect(await readDoc(db, progressPath(uid))).toBeUndefined();
    });

    it('stops upgrades, reconciles and rebuilds once the ledger exists', async () => {
      const uid = newUid();
      const locked = await writeSession(db, uid, { seed: 91, startLevel: 2, targetPeak: 3, endedAtMs: minutesAgo(20), order: 1 });
      await runSessionPipeline(context, uid, locked.id);
      const unlocking = await writeSession(db, uid, { seed: 92, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(10), order: 2 });
      // Committed with its upgrade left to the post-commit reconcile, which has not run when deletion starts.
      await processSession(coreContext(db, { limits: { transactionUpgradeScanBudget: 0 } }), uid, unlocking.id);
      await ledger(uid);
      const before = { locked: await readDoc(db, sessionPath(uid, locked.id)), progress: await readDoc(db, progressPath(uid)) };

      expect(await reconcileUpgrades(context, uid, { gameId: 'mental-math', modeId: 'timed-90' })).toEqual({ upgraded: [], stopped: 'account-deleted' });
      expect((await runSessionPipeline(context, uid, unlocking.id)).reconciled).toMatchObject([{ report: { stopped: 'account-deleted' } }]);
      expect((await reconcileUser(context, uid)).map(({ report }) => report.stopped)).toEqual(['account-deleted']);
      expect(await rebuildUserProgress(context, uid, 'mental-math')).toMatchObject({ written: 'account-deleted' });

      expect(await readDoc(db, sessionPath(uid, locked.id))).toEqual(before.locked);
      expect(before.locked?.result.validity).toBe('flagged');
      expect(await readDoc(db, progressPath(uid))).toEqual(before.progress);
    });
  });

  it('never reprocesses an invalid session: no redelivery, reconcile, rebuild, re-drive or sweep changes it', async () => {
    const uid = newUid();
    const createdAtMs = Date.UTC(2001, 2, 1);
    const { id } = await writeSessionAt(db, uid, createdAtMs, { seed: 93, startLevel: 1, targetPeak: 3 }, { seed: 94 });
    await runSessionPipeline(context, uid, id);
    const invalid = await readDoc(db, sessionPath(uid, id));
    expect(invalid?.result).toMatchObject({ validity: 'invalid' });

    await handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date(0).toISOString() });
    await runSessionPipeline(context, uid, id);
    await reconcileUser(context, uid);
    expect(await rebuildUserProgress(context, uid, 'mental-math')).toMatchObject({ written: 'unchanged', progress: null });
    const { targets } = await redriveSessions(context, {
      states: ['pending', 'failed', 'unsupported'], uid, createdAfter: ts(0), createdBefore: ts(Date.now() + 60_000), limit: 10, scanBudget: 100, dryRun: false,
    });
    expect(targets).toEqual([]);
    const swept = await sweepSessions(coreContext(db, { now: () => ts(createdAtMs + 2 * 60 * 60_000) }));
    expect(swept.targets.map(({ sessionId }) => sessionId)).not.toContain(id);

    expect(await readDoc(db, sessionPath(uid, id))).toEqual(invalid);
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  describe('EEG is never an input', () => {
    it('gives the same result and progress whether or not a recording is linked', async () => {
      const [withEeg, withoutEeg] = [newUid(), newUid()];
      const plan = { seed: 12, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(5) };
      const a = await writeSession(db, withEeg, { ...plan, id: 'session-with-a-recording' });
      const b = await writeSession(db, withoutEeg, { ...plan, id: 'session-with-a-recording' });
      await db.doc(`users/${withEeg}/eegRecordings/recording-000000001`).set({
        gameSessionId: a.id, source: 'measured', summary: { mindfulness: { mean: 1 } }, score: 1e9, peakLevel: 10, startLevel: 10,
      });

      await runSessionPipeline(context, withEeg, a.id);
      await runSessionPipeline(context, withoutEeg, b.id);

      const result = async (uid: string) => {
        const { processedAt: _processedAt, ...rest } = (await readDoc(db, sessionPath(uid, a.id)))!.result;
        return rest;
      };
      expect(await result(withEeg)).toEqual(await result(withoutEeg));
      expect(content(await readDoc(db, progressPath(withEeg)))).toEqual(content(await readDoc(db, progressPath(withoutEeg))));
    });

    it('has no code path that names EEG recordings', () => {
      const files = readdirSync(new URL('../../src/', import.meta.url)).filter((file) => file.endsWith('.ts'));
      expect(files.length).toBeGreaterThan(5);
      for (const file of files) {
        const code = readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        expect(code, file).not.toMatch(/eeg/i);
      }
    });
  });

  it('keeps writing server fields only: a session update adds result and deletes processing, nothing else', async () => {
    const uid = newUid();
    const { id, doc } = await writeSession(db, uid, { seed: 13, startLevel: 1, targetPeak: 2, endedAtMs: minutesAgo(5) });
    await db.doc(sessionPath(uid, id)).update({ processing: { state: 'failed', reason: 'internal-error', attempts: 1, updatedAt: ts(Date.now()) } });

    await runSessionPipeline(context, uid, id);

    const { result, ...clientFields } = (await readDoc(db, sessionPath(uid, id)))!;
    expect(result.validity).toBe('valid');
    expect(clientFields).toEqual(doc);
  });
});
