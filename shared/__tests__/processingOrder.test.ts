import { describe, expect, it } from 'vitest';
import {
  compareTimestamps,
  decideSession,
  evaluateSession,
  GAME_MODULE_REGISTRY,
  mentalMathV1 as mm,
  readSessionProgressFields,
  rebuildProgress,
  upgradeBlocker,
  upgradeScanLevels,
  upgradeSession,
  type GameProgress,
  type ServerResult,
  type SessionEvaluation,
} from '@nfct/shared';
import { TestTimestamp } from './fixtures';
import { mentalMathSession } from './processingFixtures';

// Order-independent processing (NFCT-19). Trusted scoring may process a
// user's sessions in any order: offline queues, several devices, retries.
// Whatever the order, once every session is processed and every start-level
// upgrade has run, progress and every session's validity must be the same.
//
// This drives the pure decisions exactly as the Cloud Function sequences them
// (process one session; when it raised an unlock, upgrade start-level-locked
// sessions in the same transaction until nothing changes, and let the
// post-commit reconcile finish what that budget left) over random session sets
// in random orders. The Functions emulator tests repeat a smaller version
// against Firestore, sequentially and concurrently.

const ts = (ms: number) => new TestTimestamp(Math.floor(ms / 1_000), (ms % 1_000) * 1_000_000);
const T0 = 1_790_000_000_000;
const UID = 'player-1';

/** A small deterministic PRNG (mulberry32), so every run tests the same cases. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    shuffle: <T>(items: readonly T[]) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
      }
      return copy;
    },
  };
}

type Doc = { readonly id: string; readonly raw: Record<string, unknown>; readonly evaluation: SessionEvaluation };

function randomSessions(random: ReturnType<typeof prng>): Doc[] {
  const count = random.int(3, 7);
  const minutes = random.shuffle(Array.from({ length: 40 }, (_, index) => index)).slice(0, count);
  return minutes.map((minute, index) => {
    const startLevel = random.next() < 0.4 ? 1 : random.int(1, 6);
    const kind = random.next();
    const raw = mentalMathSession({
      uid: UID,
      seed: random.int(0, 0xffff_ffff),
      startLevel,
      targetPeak: random.int(startLevel, Math.min(10, startLevel + 5)),
      endedAtMs: T0 + minute * 60_000,
      status: kind < 0.1 ? 'abandoned' : 'completed',
      rtMs: kind >= 0.1 && kind < 0.2 ? 200 : 1_300,
    }, ts);
    const tampered = kind >= 0.2 && kind < 0.3 ? { ...raw, seed: ((raw.seed as number) + 1) >>> 0 } : raw;
    const id = `session-${String(index).padStart(8, '0')}`;
    return { id, raw: tampered, evaluation: evaluateSession(tampered, { uid: UID, sessionId: id }) };
  });
}

type Budget = { readonly scan: number; readonly upgrades: number };

/**
 * Processes every session in `order` as the Cloud Function does. When a
 * session raises the unlock, its own transaction scans flagged sessions level
 * by level (from the lowest lockable level; each level in document-ID order,
 * as the upgrade-scan query returns them) and upgrades what it finds, to a
 * fixpoint, within `transaction` (reads, upgrades). If that budget runs out,
 * the post-commit reconcile does the same within `reconcile`; a reconcile that
 * runs out stops. `admin: true` then runs the admin reconcile, which has no
 * budget. Nothing is ever ordered by endedAt.
 */
function processInOrder(
  docs: readonly Doc[],
  order: readonly number[],
  {
    transaction = { scan: Infinity, upgrades: Infinity } as Budget,
    reconcile = { scan: Infinity, upgrades: Infinity } as Budget,
    admin = false,
  } = {},
) {
  const results = new Map<string, ServerResult>();
  let progress: GameProgress | null = null;
  let clock = T0 + 60 * 60_000;
  let budgetHit = false;
  let overflows = 0;
  const byId = [...docs].sort((a, b) => (a.id < b.id ? -1 : 1));
  const fieldsOf = (doc: Doc) => readSessionProgressFields({ ...doc.raw, result: results.get(doc.id) });

  /** One upgrade pass to a fixpoint; false when a budget stopped it. */
  const upgradePass = (budget: Budget, upgradedAt: TestTimestamp): boolean => {
    let scannedUpTo = upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, null).from - 1;
    let read = 0;
    let upgrades = 0;
    for (;;) {
      const { to } = upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, progress);
      if (to <= scannedUpTo) return true;
      const candidates: Doc[] = [];
      let exhausted = false;
      scan: for (let level = scannedUpTo + 1; level <= to; level += 1) {
        for (const doc of byId) {
          if (results.get(doc.id)?.validity !== 'flagged' || doc.raw.startLevel !== level) continue;
          if (read >= budget.scan) {
            exhausted = true;
            break scan;
          }
          read += 1;
          if (upgradeBlocker(fieldsOf(doc), progress, GAME_MODULE_REGISTRY) === null) candidates.push(doc);
        }
      }
      scannedUpTo = to;
      for (const doc of candidates) {
        if (upgrades >= budget.upgrades) return false;
        const upgraded = upgradeSession(fieldsOf(doc), progress!, { sessionId: doc.id, upgradedAt, registry: GAME_MODULE_REGISTRY });
        if (upgraded === null) continue;
        results.set(doc.id, upgraded.result);
        progress = upgraded.progress;
        upgrades += 1;
      }
      if (exhausted) return false;
    }
  };

  for (const index of order) {
    const doc = docs[index]!;
    if (doc.evaluation.kind === 'unsupported') throw new Error('every generated session is supported');
    const processedAt = ts(clock += 1_000);
    const decision = decideSession(doc.evaluation, progress, { sessionId: doc.id, processedAt, registry: GAME_MODULE_REGISTRY });
    results.set(doc.id, decision.result);
    progress = decision.progress;
    if (!decision.unlockRaised) continue;
    if (upgradePass(transaction, processedAt)) continue;
    overflows += 1;
    if (!upgradePass(reconcile, ts(clock += 1_000))) budgetHit = true;
  }
  if (admin) upgradePass({ scan: Infinity, upgrades: Infinity }, ts(clock += 1_000));
  return { progress, results, budgetHit, overflows };
}

function content(progress: GameProgress | null) {
  if (progress === null) return null;
  const { updatedAt: _updatedAt, ...rest } = progress;
  return rest;
}

function validities(results: Map<string, ServerResult>) {
  return Object.fromEntries([...results].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, result]) => [id, result.validity]));
}

describe('order-independent processing', () => {
  it('converges to the same progress and validities whatever order sessions are processed in', () => {
    const random = prng(0x5eed_0019);
    let upgradesSeen = 0;
    let overflows = 0;
    let budgetHits = 0;
    for (let run = 0; run < 120; run += 1) {
      const docs = randomSessions(random);
      const playOrder = [...docs.keys()].sort((a, b) => compareTimestamps(
        docs[a]!.raw.endedAt as TestTimestamp, docs[b]!.raw.endedAt as TestTimestamp,
      ));
      const reference = processInOrder(docs, playOrder);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const order = random.shuffle(playOrder);
        // With no budget, the processing transactions alone converge.
        const shuffled = processInOrder(docs, order);
        expect(content(shuffled.progress), `run ${run}`).toEqual(content(reference.progress));
        expect(validities(shuffled.results), `run ${run}`).toEqual(validities(reference.results));
        upgradesSeen += [...shuffled.results.values()].filter((result) => result.reasons.includes('start-level-unlocked-later')).length;

        // A tight in-transaction budget: the post-commit reconcile (no budget) finishes it.
        const transaction = { scan: random.int(0, 2), upgrades: random.int(0, 2) };
        const overflowed = processInOrder(docs, order, { transaction });
        expect(content(overflowed.progress), `run ${run} transaction ${JSON.stringify(transaction)}`).toEqual(content(reference.progress));
        expect(validities(overflowed.results), `run ${run} transaction ${JSON.stringify(transaction)}`).toEqual(validities(reference.results));
        overflows += overflowed.overflows;

        // Tight budgets everywhere: converged whenever no reconcile ran out, and always after the admin reconcile.
        const reconcile = { scan: random.int(0, 3), upgrades: Infinity };
        const tight = processInOrder(docs, order, { transaction, reconcile });
        if (!tight.budgetHit) expect(content(tight.progress), `run ${run} tight`).toEqual(content(reference.progress));
        budgetHits += tight.budgetHit ? 1 : 0;
        const finished = processInOrder(docs, order, { transaction, reconcile, admin: true });
        expect(content(finished.progress), `run ${run} tight + admin`).toEqual(content(reference.progress));
        expect(validities(finished.results), `run ${run} tight + admin`).toEqual(validities(reference.results));
      }

      // A rebuild from the stored results gives the same progress as live processing.
      const stored = docs.map((doc) => ({ id: doc.id, session: readSessionProgressFields({ ...doc.raw, result: reference.results.get(doc.id) }) }));
      expect(content(rebuildProgress(mm.definition, stored, ts(T0)))).toEqual(content(reference.progress));
    }
    // The generator really exercises the upgrade path, the overflow and the budget.
    expect(upgradesSeen).toBeGreaterThan(50);
    expect(overflows).toBeGreaterThan(20);
    expect(budgetHits).toBeGreaterThan(20);
  });

  it('never downgrades: a valid session stays valid whatever is processed after it', () => {
    const random = prng(0xd0_0019);
    for (let run = 0; run < 60; run += 1) {
      const docs = randomSessions(random);
      const order = random.shuffle([...docs.keys()]);
      const seen = new Map<string, string>();
      // Replay prefix by prefix: once a session is valid it stays valid.
      for (let length = 1; length <= order.length; length += 1) {
        const { results } = processInOrder(docs, order.slice(0, length));
        for (const [id, validity] of seen) if (validity === 'valid') expect(results.get(id)?.validity).toBe('valid');
        for (const [id, result] of results) seen.set(id, result.validity);
      }
    }
  });
});
