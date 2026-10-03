import { afterAll, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import {
  forgedSequenceMemory,
  sequenceMemorySession,
  type SequenceMemoryForgery,
  type SequenceMemoryPlan,
} from '../../../shared/__tests__/processingFixtures';
import { minutesAgo } from '../helpers/core';
import {
  emulatorFirestore,
  newSessionId,
  newUid,
  progressPath,
  readDoc,
  sessionPath,
  settled,
  statsPath,
  TRIGGER_PROJECT,
  ts,
  waitFor,
} from '../helpers/emulator';

// Sequence Memory v1 (NFCT-93) through onGameSessionCreated on the Functions
// emulator: the same trusted pipeline as Mental Math, with no Functions code
// specific to the game. Sessions are written as a client writes them.

const { db, close } = emulatorFirestore(TRIGGER_PROJECT);
afterAll(close);

type Plan = Omit<SequenceMemoryPlan, 'uid'>;

async function createSession(uid: string, plan: Plan, forgery?: SequenceMemoryForgery) {
  const id = newSessionId();
  const honest = sequenceMemorySession({ ...plan, uid, createdAt: FieldValue.serverTimestamp() }, ts);
  await db.doc(sessionPath(uid, id)).set(forgery ? forgedSequenceMemory(honest, forgery) : honest);
  return id;
}

async function processed(uid: string, id: string) {
  return (await waitFor(db, sessionPath(uid, id), settled))!;
}

describe('onGameSessionCreated: Sequence Memory v1', () => {
  it('scores an honest run as valid and updates progress/sequence-memory and stats/summary', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 301, startLevel: 1, targetPeak: 5, endedAtMs: minutesAgo(3) });

    const { result, processing, activeDurationMs } = await processed(uid, id);

    expect(processing).toBeUndefined();
    expect(result).toMatchObject({
      validity: 'valid',
      reasons: [],
      peakLevel: 5,
      recordKey: 'standard:1',
      personalBest: true,
      unlocked: [2, 3, 4].map((startLevel) => ({ modeId: 'standard', startLevel })),
      domainContributions: { memory: 0.6, spatial: 0.4 },
      performanceIndex: null,
    });
    expect(await readDoc(db, progressPath(uid, 'sequence-memory'))).toMatchObject({
      gameId: 'sequence-memory',
      gameVersion: 1,
      sessionsCompleted: 1,
      activeMs: activeDurationMs,
      bestPeakLevel: { standard: 5 },
      unlocked: { standard: 4 },
      bests: { 'standard:1': { score: { value: result.score, sessionId: id }, longestSpan: { sessionId: id }, peakLevel: { value: 5, sessionId: id } } },
    });
    expect(await readDoc(db, statsPath(uid))).toMatchObject({
      sessions: 1,
      validRuns: 1,
      bestPeakLevel: { 'sequence-memory': 5 },
      updatedAt: result.processedAt,
    });
    expect(await readDoc(db, progressPath(uid))).toBeUndefined();
  });

  it.each([
    ['sequence', 'sequence-not-from-seed'],
    ['level-sequence', 'level-sequence-mismatch'],
    ['response', 'correct-mismatch'],
  ] as const)('counts a run with a forged %s nowhere', async (forgery, reason) => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 302, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(3) }, forgery);

    const { result } = await processed(uid, id);

    expect(result.validity).toBe('invalid');
    expect(result.reasons).toContain(reason);
    expect(await readDoc(db, progressPath(uid, 'sequence-memory'))).toBeUndefined();
    expect(await readDoc(db, statsPath(uid))).toBeUndefined();
  });

  it('flags a run whose trials are spread apart to claim more active time: no records or unlocks', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 304, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(3) }, 'trial-gap');

    const { result } = await processed(uid, id);
    expect(result.validity).toBe('flagged');
    expect(result.reasons).toEqual(expect.arrayContaining(['trial-gap', 'active-duration-mismatch']));
    expect(await readDoc(db, progressPath(uid, 'sequence-memory'))).toMatchObject({ bests: {}, bestPeakLevel: {}, unlocked: {} });
  });

  it('flags a run with too many fast taps: totals only, no records or unlocks', async () => {
    const uid = newUid();
    const id = await createSession(uid, { seed: 303, startLevel: 1, targetPeak: 4, endedAtMs: minutesAgo(3) }, 'fast-taps');

    expect((await processed(uid, id)).result).toMatchObject({ validity: 'flagged', reasons: ['tap-below-floor'] });
    expect(await readDoc(db, progressPath(uid, 'sequence-memory'))).toMatchObject({ sessionsCompleted: 1, bests: {}, bestPeakLevel: {}, unlocked: {} });
  });
});
