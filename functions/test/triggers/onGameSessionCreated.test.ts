import { afterAll, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { handleSessionCreated } from '../../src/pipeline';
import { coreContext, minutesAgo } from '../helpers/core';
import {
  achievementPath,
  content,
  dailyStatsPath,
  emulatorFirestore,
  newSessionId,
  newUid,
  progressPath,
  readDoc,
  sessionDoc,
  sessionPath,
  settled,
  statsContent,
  statsPath,
  TRIGGER_PROJECT,
  waitFor,
  type Plan,
} from '../helpers/emulator';

// onGameSessionCreated end to end on the Functions emulator: the built bundle
// (functions/lib) is loaded by the emulator and runs on every session create.
// Sessions are written as a client writes them (createdAt = server time).
// Design section L / card NFCT-19 emulator tests.

const { db, close } = emulatorFirestore(TRIGGER_PROJECT);
afterAll(close);

async function createSession(uid: string, plan: Plan, change: Record<string, unknown> = {}, id = newSessionId()) {
  await db.doc(sessionPath(uid, id)).set({ ...sessionDoc(uid, { ...plan, createdAt: FieldValue.serverTimestamp() }), ...change });
  return id;
}

async function processed(uid: string, id: string) {
  return (await waitFor(db, sessionPath(uid, id), settled))!;
}

describe('onGameSessionCreated', () => {
  it("processes a new user's first session at level 1 as valid, with no progress document, and creates progress", async () => {
    const uid = newUid();
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
    const id = await createSession(uid, { seed: 101, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(3) });

    const { result, processing } = await processed(uid, id);

    expect(processing).toBeUndefined();
    expect(result).toMatchObject({ validity: 'valid', reasons: [], performanceIndex: null, performanceIndexVersion: null, peakLevel: 4 });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({
      sessionsCompleted: 1, activeMs: 90_000, bestPeakLevel: { 'timed-90': 4 }, unlocked: { 'timed-90': 3 },
      bests: { 'timed-90:1': { score: { value: result.score, sessionId: id } } },
    });
  });

  it('maintains the stats, the day and the achievements in the same commit (NFCT-13), and a replay changes nothing', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 116, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(3) });

    const { result, localDate } = await processed(uid, id);

    expect(await readDoc(db, statsPath(uid))).toMatchObject({
      sessions: 1, validRuns: 1, bestPeakLevel: { 'mental-math': 5 }, streak: { current: 1, lastActiveDate: localDate },
      achievements: ['first-run', 'mental-math-level-5'], updatedAt: result.processedAt,
    });
    expect(await readDoc(db, dailyStatsPath(uid, localDate))).toMatchObject({ sessions: 1, activeMs: 90_000, updatedAt: result.processedAt });
    expect(await readDoc(db, achievementPath(uid, 'first-run'))).toMatchObject({ sessionId: id, earnedAt: result.processedAt, localDate });

    const before = await statsContent(db, uid);
    await handleSessionCreated(coreContext(db), { params: { uid, sessionId: id }, time: new Date().toISOString() });
    expect(await statsContent(db, uid)).toEqual(before);
  });

  it('flags a first session at level 2 start-level-locked', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 102, startLevel: 2, targetPeak: 4, endedAtMs: minutesAgo(3) });

    expect((await processed(uid, id)).result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 1, bests: {}, bestPeakLevel: {} });
  });

  it('changes nothing when the trigger is replayed', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 103, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(3) });
    const session = await processed(uid, id);
    const progress = await readDoc(db, progressPath(uid));

    // Redeliver the same event to the same handler code.
    const replay = await handleSessionCreated(coreContext(db), { params: { uid, sessionId: id }, time: new Date().toISOString() });

    expect(replay?.outcome.status).toBe('already-processed');
    expect(await readDoc(db, sessionPath(uid, id))).toEqual(session);
    expect(await readDoc(db, progressPath(uid))).toEqual(progress);
  });

  it('applies totals once when a duplicate delivery races the trigger', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 104, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(3) });
    const context = coreContext(db);

    await Promise.all(Array.from({ length: 3 }, () => handleSessionCreated(context, { params: { uid, sessionId: id }, time: new Date().toISOString() })));
    await processed(uid, id);
    // Give the emulator's own delivery time to finish, then check nothing was counted twice.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000 });
  });

  it('keeps separate bests for different start levels', async () => {
    const uid = newUid();
    const first = await createSession(uid, { seed: 105, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20) });
    const firstResult = (await processed(uid, first)).result;
    const second = await createSession(uid, { seed: 106, startLevel: 3, targetPeak: 4, endedAtMs: minutesAgo(10) });
    const secondResult = (await processed(uid, second)).result;

    expect(firstResult.recordKey).toBe('timed-90:1');
    expect(secondResult).toMatchObject({ validity: 'valid', recordKey: 'timed-90:3' });
    const { bests } = (await readDoc(db, progressPath(uid)))!;
    expect(Object.keys(bests).sort()).toEqual(['timed-90:1', 'timed-90:3']);
    expect(bests['timed-90:1'].score).toMatchObject({ value: firstResult.score, sessionId: first });
    expect(bests['timed-90:3'].score).toMatchObject({ value: secondResult.score, sessionId: second });
  });

  it('sets no record for a flagged session', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 107, startLevel: 1, targetPeak: 4, rtMs: 200, endedAtMs: minutesAgo(3) });

    expect((await processed(uid, id)).result).toMatchObject({ validity: 'flagged', reasons: ['rt-below-floor'] });
    expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000, bests: {}, bestPeakLevel: {}, unlocked: {} });
  });

  it('counts an invalid session nowhere', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 108, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(3) }, { seed: 109 });

    const { result } = await processed(uid, id);

    expect(result.validity).toBe('invalid');
    expect(result.reasons).toContain('question-not-from-seed');
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  it('marks a session of an unsupported game version unsupported, not invalid', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 110, startLevel: 1, targetPeak: 3, endedAtMs: minutesAgo(3) }, { gameVersion: 2 });

    const session = await processed(uid, id);

    expect(session.result).toBeUndefined();
    expect(session.processing).toMatchObject({ state: 'unsupported', reason: 'unknown-game-version', attempts: 1 });
  });

  describe('two queued sessions processed out of order are not wrongly flagged (end state)', () => {
    it('queued offline and delivered together: both end valid, whichever trigger commits first', async () => {
      const uid = newUid();
      const [earlier, later] = [newSessionId(1), newSessionId(2)];
      const batch = db.batch();
      // Written in one commit, later session first; both triggers run concurrently.
      batch.set(db.doc(sessionPath(uid, later)), sessionDoc(uid, {
        seed: 111, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10), createdAt: FieldValue.serverTimestamp(),
      }));
      batch.set(db.doc(sessionPath(uid, earlier)), sessionDoc(uid, {
        seed: 112, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20), createdAt: FieldValue.serverTimestamp(),
      }));
      await batch.commit();

      await processed(uid, earlier);
      // The later session is valid once the earlier one is processed: either it was processed second, or the
      // earlier session's commit upgraded it. Only the point-in-time note tells which.
      const laterResult = (await waitFor(db, sessionPath(uid, later), (data) => data?.result?.validity === 'valid'))!.result;

      expect(laterResult).toMatchObject({ validity: 'valid', recordKey: 'timed-90:3' });
      expect([[], ['start-level-unlocked-later']]).toContainEqual(laterResult.reasons);
      expect((await readDoc(db, sessionPath(uid, earlier)))?.result).toMatchObject({ validity: 'valid' });
      expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 2, activeMs: 180_000, unlocked: { 'timed-90': 5 } });
      // Both counted once in the stats, and both valid runs, whichever commit upgraded which.
      expect(await readDoc(db, statsPath(uid))).toMatchObject({ sessions: 2, validRuns: 2, bestPeakLevel: { 'mental-math': 6 } });
    });

    it('delivered one at a time in reverse play order: the unlocking commit upgrades the later session in the same write', async () => {
      const uid = newUid();
      const later = await createSession(uid, { seed: 113, startLevel: 3, targetPeak: 6, endedAtMs: minutesAgo(10) }, {}, newSessionId(2));
      const flagged = (await processed(uid, later)).result;
      expect(flagged.validity).toBe('flagged');
      const earlier = await createSession(uid, { seed: 114, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(20) }, {}, newSessionId(1));
      await processed(uid, earlier);

      // No waiting: the upgrade was part of the commit that wrote the earlier session's result.
      const upgraded = (await readDoc(db, sessionPath(uid, later)))?.result;
      expect(upgraded).toMatchObject({ validity: 'valid', reasons: ['start-level-unlocked-later'], processedAt: flagged.processedAt });
      expect(await readDoc(db, progressPath(uid))).toMatchObject({ sessionsCompleted: 2, activeMs: 180_000, unlocked: { 'timed-90': 5 } });
    });
  });

  it('never reads EEG: a recording written with the session changes nothing', async () => {
    const [withEeg, withoutEeg] = [newUid(), newUid()];
    const plan = { seed: 115, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(3) };
    const id = 'session-with-linked-eeg-01';
    const batch = db.batch();
    batch.set(db.doc(sessionPath(withEeg, id)), sessionDoc(withEeg, { ...plan, createdAt: FieldValue.serverTimestamp() }));
    batch.set(db.doc(`users/${withEeg}/eegRecordings/recording-for-session-01`), {
      gameSessionId: id, source: 'measured', score: 1e9, peakLevel: 10, startLevel: 10,
    });
    await batch.commit();
    await createSession(withoutEeg, plan, {}, id);

    const a = (await processed(withEeg, id)).result;
    const b = (await processed(withoutEeg, id)).result;

    const { processedAt: _a, ...resultWithEeg } = a;
    const { processedAt: _b, ...resultWithoutEeg } = b;
    expect(resultWithEeg).toEqual(resultWithoutEeg);
    expect(content(await readDoc(db, progressPath(withEeg)))).toEqual(content(await readDoc(db, progressPath(withoutEeg))));
  });
});
