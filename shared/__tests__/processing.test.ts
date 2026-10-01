import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySession,
  applyValidEffects,
  CLOCK_TOLERANCES,
  clockDiagnostics,
  createGameModuleRegistry,
  decideSession,
  evaluateSession,
  GAME_MODULE_REGISTRY,
  MAX_RESULT_REASONS,
  mentalMathV1 as mm,
  mentalMathV1Module,
  mergeReasons,
  processingRecord,
  readSessionProgressFields,
  SERVER_REASON_OUTCOMES,
  serverResultWriteSchema,
  upgradeBlocker,
  upgradeScanLevels,
  upgradeSession,
  type GameProgress,
  type ReasonEntry,
  type ServerResult,
  type SessionEvaluation,
} from '@nfct/shared';
import { TestTimestamp } from './fixtures';
import { forgedEverything, mentalMathSession, type SessionPlan } from './processingFixtures';

const ts = (ms: number) => new TestTimestamp(Math.floor(ms / 1_000), (ms % 1_000) * 1_000_000);
const T0 = 1_790_000_000_000;
const UID = 'player-1';
const MINUTE = 60_000;

function session(plan: Partial<SessionPlan> = {}): Record<string, unknown> {
  return mentalMathSession({ uid: UID, seed: 11, startLevel: 1, targetPeak: 3, endedAtMs: T0, ...plan }, ts);
}

function evaluate(raw: unknown, sessionId = 'session-00000001') {
  return evaluateSession(raw, { uid: UID, sessionId });
}

function scored(raw: unknown) {
  const evaluation = evaluate(raw);
  if (evaluation.kind !== 'scored') throw new Error(`expected a scored evaluation, got ${evaluation.kind}`);
  return evaluation;
}

function codes(evaluation: SessionEvaluation): string[] {
  if (evaluation.kind === 'scored') return evaluation.entries.map(({ code }) => code);
  if (evaluation.kind === 'invalid') return evaluation.reasons;
  return [];
}

describe('evaluateSession', () => {
  it('scores a conforming session from its trials, with no reasons', () => {
    const raw = session({ startLevel: 2, targetPeak: 5 });
    const evaluation = scored(raw);

    expect(evaluation.module).toBe(mentalMathV1Module);
    expect(evaluation.entries).toEqual([]);
    expect(evaluation.scored).toEqual(mm.score(raw.trials as mm.MentalMathTrial[], { modeId: 'timed-90', startLevel: 2 }));
    expect(evaluation.scored.peakLevel).toBe(5);
  });

  it('ignores server fields: a stale result or processing state never changes the evaluation', () => {
    const raw = session();
    const withServerFields = { ...raw, result: { validity: 'valid' }, processing: { state: 'failed' } };

    expect(evaluate(withServerFields)).toEqual(evaluate(raw));
  });

  it('marks what no registered module can process as unsupported, never invalid', () => {
    expect(evaluate({ ...session(), gameVersion: 2 })).toEqual({ kind: 'unsupported', reason: 'unknown-game-version' });
    expect(evaluate({ ...session(), gameVersion: '1' })).toEqual({ kind: 'unsupported', reason: 'unknown-game-version' });
    expect(evaluate({ ...session(), gameId: 'chess' })).toEqual({ kind: 'unsupported', reason: 'unknown-game' });
    expect(evaluate({ ...session(), schemaVersion: 2 })).toEqual({ kind: 'unsupported', reason: 'unsupported-schema-version' });
    expect(evaluate(null)).toEqual({ kind: 'unsupported', reason: 'unsupported-schema-version' });
  });

  it('marks a schema failure invalid: trials, the mode, or a start level beyond the mode', () => {
    const raw = session();
    const trials = raw.trials as object[];

    for (const broken of [
      { ...raw, trials: [{ ...trials[0], hint: 'x' }, ...trials.slice(1)] },
      { ...raw, modeId: 'endless' },
      { ...raw, startLevel: 11 }, // the rules allow 1-50; Mental Math v1 has 10 levels
      { ...raw, activeDurationMs: 3_600_001 },
      { ...raw, localDate: '2026-02-30' },
      { ...raw, surprise: true, localDate: '2026-02-30' },
      { ...raw, trials: [{ ...trials[0], surprise: true }, ...trials.slice(1)] },
    ]) {
      expect(evaluate(broken)).toEqual({ kind: 'invalid', module: mentalMathV1Module, reasons: ['schema-invalid'] });
    }
  });

  it('marks a session whose only fault is envelope fields this build does not know unsupported, not invalid', () => {
    // The rules gate these with exact key sets: only rules or clients deployed before Functions produce them.
    const raw = session();
    for (const change of [
      { surprise: true },
      { client: { ...(raw.client as object), device: 'phone' } },
      { summary: { ...(raw.summary as object), streak: 3 } },
    ]) {
      expect(evaluate({ ...raw, ...change })).toEqual({ kind: 'unsupported', reason: 'unknown-session-field' });
    }
  });

  it('marks a session whose path does not match it invalid', () => {
    expect(codes(evaluate({ ...session(), userId: 'someone-else' }))).toEqual(['user-id-mismatch']);
    expect(codes(evaluate(session(), 'short'))).toEqual(['session-id-invalid']);
  });

  it('marks trials the seed cannot reproduce invalid (question-not-from-seed)', () => {
    const evaluation = evaluate({ ...session(), seed: 12 });

    expect(evaluation.kind).toBe('invalid');
    expect(codes(evaluation)).toContain('question-not-from-seed');
  });

  it('flags a session the game version flags (rt-below-floor)', () => {
    const evaluation = scored(session({ rtMs: 200 }));

    expect(evaluation.entries).toEqual([{ code: 'rt-below-floor', outcome: 'flagged' }]);
  });

  describe('client summary and peak level are diagnostics only', () => {
    it('keeps a session with a disagreeing summary valid (summary-mismatch)', () => {
      const raw = session();
      const summary = raw.summary as Record<string, unknown>;

      expect(scored({ ...raw, summary: { ...summary, score: 99_999 } }).entries)
        .toEqual([{ code: 'summary-mismatch', outcome: 'diagnostic' }]);
    });

    it('keeps a session whose summary the game schema rejects valid (summary-mismatch)', () => {
      const raw = session();
      const summary = raw.summary as Record<string, unknown>;

      for (const change of [
        { accuracy: 7 }, { trialsTotal: -3 }, { metrics: {} }, { metrics: { lives: 1 } },
        { score: Number.NaN }, { accuracy: Number.POSITIVE_INFINITY }, { trialsCorrect: Number.NEGATIVE_INFINITY },
        { responseTime: { medianMs: Number.NaN, meanMs: 1, p90Ms: 2 } },
      ]) {
        expect(scored({ ...raw, summary: { ...summary, ...change } }).entries)
          .toEqual([{ code: 'summary-mismatch', outcome: 'diagnostic' }]);
      }
    });

    it('keeps a session valid whatever peak the client claims, even below the start or beyond the mode', () => {
      const raw = session({ startLevel: 3, targetPeak: 5 });

      for (const peakLevel of [1, 2, 4, 11, 50]) {
        const evaluation = scored({ ...raw, peakLevel });
        expect(evaluation.entries).toEqual([{ code: 'peak-level-mismatch', outcome: 'diagnostic' }]);
        expect(evaluation.scored.peakLevel).toBe(5);
      }
    });
  });

  it('adds the clock diagnostics, which never change validity', () => {
    const raw = session();
    const evaluation = scored({ ...raw, localDate: '2026-01-01', createdAt: ts(T0 + 30 * 24 * 60 * MINUTE) });

    expect(evaluation.entries).toEqual([
      { code: 'late-upload', outcome: 'diagnostic' },
      { code: 'local-date-mismatch', outcome: 'diagnostic' },
      { code: 'local-date-inconsistent', outcome: 'diagnostic' },
    ]);
    const { result } = decideSession(evaluation, null, { sessionId: 'session-00000001', processedAt: ts(T0), registry: GAME_MODULE_REGISTRY });
    expect(result).toMatchObject({ validity: 'valid', reasons: ['late-upload', 'local-date-mismatch', 'local-date-inconsistent'] });
  });

  it('raises every v1 reason and every trusted-scoring reason that can accompany them, cut to the 20 a result holds', () => {
    const evaluation = evaluateSession(forgedEverything(ts, T0), { uid: UID, sessionId: 'bad' });

    expect(evaluation.kind).toBe('invalid');
    const raised = [
      ...Object.keys(mm.REASON_OUTCOMES),
      'user-id-mismatch', 'session-id-invalid', 'device-clock-ahead', 'wall-clock-short', 'local-date-mismatch', 'local-date-inconsistent',
    ];
    expect(raised).toHaveLength(MAX_RESULT_REASONS + 1);
    const severity = (code: string) => ({ invalid: 0, flagged: 1, diagnostic: 2 })[
      (mm.REASON_OUTCOMES as Record<string, string>)[code] ?? (SERVER_REASON_OUTCOMES as Record<string, string>)[code]!
    ]!;
    const reasons = codes(evaluation);
    // One code too many: the most severe 19 are kept, then the truncation marker.
    expect(reasons).toHaveLength(MAX_RESULT_REASONS);
    expect(reasons[MAX_RESULT_REASONS - 1]).toBe('reasons-truncated');
    const kept = reasons.slice(0, -1);
    expect(kept.every((code) => raised.includes(code))).toBe(true);
    // Only diagnostics are ever cut: every invalid and flagged code is kept, most severe first.
    for (const code of raised.filter((candidate) => severity(candidate) < 2)) expect(kept).toContain(code);
    expect(kept.map(severity)).toEqual([...kept.map(severity)].sort());
    const decision = decideSession(evaluation as Exclude<SessionEvaluation, { kind: 'unsupported' }>, null, {
      sessionId: 'bad', processedAt: ts(T0), registry: GAME_MODULE_REGISTRY,
    });
    expect(serverResultWriteSchema.parse(decision.result).reasons).toEqual(reasons);
    expect(decision.progress).toBeNull();
  });

  it('never reads EEG: a recording field on the document is an unknown field like any other, never scored', () => {
    // The session schema has no EEG field at all (the rules refuse one); the only link is eegRecordings.gameSessionId.
    expect(evaluate({ ...session(), eegLinked: true })).toEqual({ kind: 'unsupported', reason: 'unknown-session-field' });
    // No processing module imports or names anything about EEG (comments aside).
    const sources = ['evaluate', 'decide', 'registry', 'modules', 'reasons', 'clock']
      .map((file) => readFileSync(new URL(`../processing/${file}.ts`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''));
    for (const source of sources) expect(source).not.toMatch(/eeg/i);
  });
});

describe('clockDiagnostics', () => {
  const facts = {
    startedAt: ts(T0 - 100_000),
    endedAt: ts(T0),
    createdAt: ts(T0 + 1_000),
    activeDurationMs: 90_000,
    localDate: '2026-09-21',
    timezone: 'America/Toronto',
  };
  const found = (change: Partial<typeof facts>) => clockDiagnostics({ ...facts, ...change }).map(({ code }) => code);

  it('finds nothing for an honest session, and tolerates small skew', () => {
    expect(new Date(T0).toISOString().slice(0, 10)).toBe('2026-09-21');
    expect(found({})).toEqual([]);
    expect(found({ createdAt: ts(T0 - CLOCK_TOLERANCES.deviceAheadMs) })).toEqual([]);
    expect(found({ localDate: '2026-09-20' })).toEqual([]);
    expect(found({ localDate: '2026-09-22' })).toEqual([]);
    // Uploaded the next day: still within a day of the server's date.
    expect(found({ createdAt: ts(T0 + 20 * 60 * MINUTE) })).toEqual([]);
  });

  it('notes a device clock ahead of the server, a late upload and a short wall-clock span', () => {
    expect(found({ createdAt: ts(T0 - CLOCK_TOLERANCES.deviceAheadMs - 1) })).toEqual(['device-clock-ahead']);
    // A week-old offline session is also more than a day from the server's date.
    expect(found({ createdAt: ts(T0 + CLOCK_TOLERANCES.lateUploadMs) })).toEqual(['local-date-mismatch']);
    expect(found({ createdAt: ts(T0 + CLOCK_TOLERANCES.lateUploadMs + 1) })).toEqual(['late-upload', 'local-date-mismatch']);
    expect(found({ startedAt: ts(T0 - 80_000) })).toEqual(['wall-clock-short']);
  });

  it('checks localDate against the server createdAt (local-date-mismatch, design F) and the device endedAt (local-date-inconsistent)', () => {
    const DAY = 24 * 60 * MINUTE;
    // Both clocks agree with each other; localDate agrees with neither.
    expect(found({ localDate: '2026-09-23' })).toEqual(['local-date-mismatch', 'local-date-inconsistent']);
    expect(found({ localDate: '2026-09-19' })).toEqual(['local-date-mismatch', 'local-date-inconsistent']);
    // Played offline on the 21st, uploaded on the 24th: consistent on the device, but a backfill as the server sees it.
    expect(found({ createdAt: ts(T0 + 3 * DAY) })).toEqual(['local-date-mismatch']);
    // The device clock was set back three days and localDate follows it: only the server clock catches that.
    expect(found({ startedAt: ts(T0 - 3 * DAY - 100_000), endedAt: ts(T0 - 3 * DAY), localDate: '2026-09-18' })).toEqual(['local-date-mismatch']);
    // The device clock was set back, but localDate is today's: the client's own fields disagree.
    expect(found({ startedAt: ts(T0 - 3 * DAY - 100_000), endedAt: ts(T0 - 3 * DAY) })).toEqual(['local-date-inconsistent']);
    // 01:30 UTC on the 22nd is still the 21st in Toronto and already the 22nd in Tokyo.
    const lateEvening = Date.UTC(2026, 8, 22, 1, 30);
    const evening = { endedAt: ts(lateEvening), createdAt: ts(lateEvening), startedAt: ts(lateEvening - 100_000), localDate: '2026-09-20' };
    expect(found(evening)).toEqual([]);
    expect(found({ ...evening, timezone: 'Asia/Tokyo' })).toEqual(['local-date-mismatch', 'local-date-inconsistent']);
  });

  it('keeps every clock check a diagnostic', () => {
    for (const code of ['device-clock-ahead', 'late-upload', 'wall-clock-short', 'local-date-mismatch', 'local-date-inconsistent', 'unknown-timezone'] as const) {
      expect(SERVER_REASON_OUTCOMES[code], code).toBe('diagnostic');
    }
  });

  it('notes a time zone it does not know instead of failing', () => {
    expect(found({ timezone: 'Mars/Olympus_Mons' })).toEqual(['unknown-timezone']);
  });
});

describe('mergeReasons', () => {
  const entry = (code: string, outcome: ReasonEntry['outcome']): ReasonEntry => ({ code, outcome });

  it('orders by severity, keeping the given order within a severity, each code once', () => {
    expect(mergeReasons([
      entry('peak-level-mismatch', 'diagnostic'), entry('rt-below-floor', 'flagged'), entry('expected-mismatch', 'invalid'),
      entry('rt-below-floor', 'flagged'), entry('start-level-locked', 'flagged'),
    ])).toEqual({ validity: 'invalid', reasons: ['expected-mismatch', 'rt-below-floor', 'start-level-locked', 'peak-level-mismatch'] });
    expect(mergeReasons([])).toEqual({ validity: 'valid', reasons: [] });
    expect(mergeReasons([entry('summary-mismatch', 'diagnostic')])).toEqual({ validity: 'valid', reasons: ['summary-mismatch'] });
  });

  it('bounds the list at 20, most severe first, with a truncation marker, and keeps the validity', () => {
    const many = [
      ...Array.from({ length: 12 }, (_, index) => entry(`diagnostic-${index}`, 'diagnostic')),
      ...Array.from({ length: 12 }, (_, index) => entry(`flag-${index}`, 'flagged')),
    ];
    const merged = mergeReasons(many);

    expect(merged.validity).toBe('flagged');
    expect(merged.reasons).toHaveLength(MAX_RESULT_REASONS);
    expect(merged.reasons.slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, index) => `flag-${index}`));
    expect(merged.reasons.at(-1)).toBe('reasons-truncated');
    expect(mergeReasons([...many, entry('x-invalid', 'invalid')]).reasons[0]).toBe('x-invalid');
  });
});

describe('registry', () => {
  it('registers Mental Math v1 with its frozen definition and reason table', () => {
    expect(GAME_MODULE_REGISTRY.find('mental-math', 1)).toBe(mentalMathV1Module);
    expect(GAME_MODULE_REGISTRY.current('mental-math')).toBe(mentalMathV1Module);
    expect(GAME_MODULE_REGISTRY.find('mental-math', 2)).toBeUndefined();
    expect(mentalMathV1Module.definition).toBe(mm.definition);
    expect(mentalMathV1Module.reasonOutcomes).toBe(mm.REASON_OUTCOMES);
  });

  it("covers every version the rules let a client write (supportedGameVersions)", () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const block = /function supportedGameVersions\(\) \{\s*return \{([\s\S]*?)\};/.exec(rules)?.[1];
    const windows = [...(block ?? '').matchAll(/'([a-z0-9-]+)': \{ 'min': (\d+), 'max': (\d+) \}/g)];

    expect(windows.length).toBeGreaterThan(0);
    for (const [, gameId, min, max] of windows) {
      for (let version = Number(min); version <= Number(max); version += 1) {
        expect(GAME_MODULE_REGISTRY.find(gameId!, version), `${gameId} v${version}`).toBeDefined();
      }
    }
  });

  it("keeps trusted scoring's reason codes apart from every game's", () => {
    for (const module of GAME_MODULE_REGISTRY.modules) {
      for (const code of Object.keys(module.reasonOutcomes)) expect(SERVER_REASON_OUTCOMES).not.toHaveProperty(code);
    }
  });

  it('refuses a version registered twice', () => {
    expect(() => createGameModuleRegistry([mentalMathV1Module, mentalMathV1Module])).toThrow(/twice/);
  });
});

type Judged = Exclude<SessionEvaluation, { kind: 'unsupported' }>;

function decide(raw: Record<string, unknown>, progress: GameProgress | null, sessionId: string, atMs: number) {
  return decideSession(evaluate(raw, sessionId) as Judged, progress, {
    sessionId, processedAt: ts(atMs), registry: GAME_MODULE_REGISTRY,
  });
}

describe('decideSession', () => {
  it("processes a new user's first session at level 1 as valid and creates progress", () => {
    const decision = decide(session({ startLevel: 1, targetPeak: 4 }), null, 'session-00000001', T0 + MINUTE);

    expect(decision.result).toMatchObject({
      validity: 'valid',
      reasons: [],
      performanceIndex: null,
      performanceIndexVersion: null,
      peakLevel: 4,
      recordKey: 'timed-90:1',
      personalBest: true,
      unlocked: [{ modeId: 'timed-90', startLevel: 2 }, { modeId: 'timed-90', startLevel: 3 }],
      domainContributions: mm.definition.domainWeights,
    });
    expect(decision.progress).toMatchObject({ sessionsCompleted: 1, bestPeakLevel: { 'timed-90': 4 }, unlocked: { 'timed-90': 3 } });
    expect(decision.unlockRaised).toBe(true);
  });

  it("flags a new user's first session at level 2 start-level-locked, counting only its totals", () => {
    const decision = decide(session({ startLevel: 2, targetPeak: 4 }), null, 'session-00000001', T0 + MINUTE);

    expect(decision.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked'], peakLevel: 4, performanceIndex: null });
    expect(decision.result).not.toHaveProperty('recordKey');
    expect(decision.progress).toMatchObject({ sessionsCompleted: 1, activeMs: 90_000, bestPeakLevel: {}, bests: {} });
    expect(decision.unlockRaised).toBe(false);
  });

  it('counts an invalid session nowhere: missing progress stays missing', () => {
    const decision = decide({ ...session(), seed: 99 }, null, 'session-00000001', T0 + MINUTE);

    expect(decision.result).toEqual({ processedAt: ts(T0 + MINUTE), scoringVersion: 1, validity: 'invalid', reasons: expect.any(Array) });
    expect(decision.progress).toBeNull();
  });
});

/** A stored session's progress fields, as the upgrade scan reads them. */
function stored(raw: Record<string, unknown>, result: ServerResult) {
  return readSessionProgressFields({ ...raw, result });
}

describe('flagged -> valid upgrade', () => {
  const lockedRaw = session({ seed: 21, startLevel: 3, targetPeak: 6, endedAtMs: T0 });
  const unlockingRaw = session({ seed: 22, startLevel: 1, targetPeak: 5, endedAtMs: T0 - 10 * MINUTE });

  function lockedThenUnlocked() {
    const locked = decide(lockedRaw, null, 'session-locked-0001', T0 + MINUTE);
    const unlocking = decide(unlockingRaw, locked.progress, 'session-unlock-0001', T0 + 2 * MINUTE);
    return { locked, unlocking };
  }

  it('upgrades a start-level-locked session once progress unlocks its level, applying only valid-only effects', () => {
    const { locked, unlocking } = lockedThenUnlocked();
    expect(locked.result.validity).toBe('flagged');
    expect(unlocking.unlockRaised).toBe(true);

    const upgraded = upgradeSession(stored(lockedRaw, locked.result), unlocking.progress!, {
      sessionId: 'session-locked-0001', upgradedAt: ts(T0 + 3 * MINUTE), registry: GAME_MODULE_REGISTRY,
    })!;
    const before = unlocking.progress!;

    expect(upgraded.result).toMatchObject({
      validity: 'valid',
      reasons: ['start-level-unlocked-later'],
      recordKey: 'timed-90:3',
      personalBest: true,
      peakLevel: 6,
    });
    // Stored trusted values carry over unchanged; nothing is rescored.
    const { validity: _v, reasons: _r, ...storedValues } = locked.result;
    expect(upgraded.result).toMatchObject(storedValues);
    expect(upgraded.progress).toMatchObject({
      sessionsCompleted: before.sessionsCompleted,
      activeMs: before.activeMs,
      lastPlayedAt: before.lastPlayedAt,
      bestPeakLevel: { 'timed-90': 6 },
    });
    expect(upgraded.progress?.bests['timed-90:3']?.score?.sessionId).toBe('session-locked-0001');
    expect(upgraded.unlockRaised).toBe(true);
  });

  it('gives the same progress as processing the session valid in play order', () => {
    const { locked, unlocking } = lockedThenUnlocked();
    const upgraded = upgradeSession(stored(lockedRaw, locked.result), unlocking.progress!, {
      sessionId: 'session-locked-0001', upgradedAt: ts(T0 + 3 * MINUTE), registry: GAME_MODULE_REGISTRY,
    })!;
    const unlockingFirst = decide(unlockingRaw, null, 'session-unlock-0001', T0 + MINUTE);
    const lockedSecond = decide(lockedRaw, unlockingFirst.progress, 'session-locked-0001', T0 + 2 * MINUTE);
    const withoutWriteTime = ({ updatedAt: _updatedAt, ...rest }: GameProgress) => rest;

    expect(lockedSecond.result.validity).toBe('valid');
    expect(withoutWriteTime(upgraded.progress!)).toEqual(withoutWriteTime(lockedSecond.progress!));
  });

  it('refuses what is not only start-level-locked, or is still locked, or has been rescored since', () => {
    const { locked, unlocking } = lockedThenUnlocked();
    const flagged = locked.result as Extract<ServerResult, { validity: 'flagged' }>;
    const blocker = (result: ServerResult, progress: GameProgress | null = unlocking.progress) =>
      upgradeBlocker(stored(lockedRaw, result), progress, GAME_MODULE_REGISTRY);

    expect(blocker(flagged)).toBeNull();
    expect(blocker(flagged, locked.progress)).toBe('still-locked');
    expect(blocker({ ...flagged, reasons: ['start-level-locked', 'peak-level-mismatch', 'late-upload'] })).toBeNull();
    expect(blocker({ ...flagged, reasons: ['rt-below-floor', 'start-level-locked'] })).toBe('flagged-for-another-reason');
    expect(blocker({ ...flagged, reasons: ['start-level-locked', 'reasons-truncated'] })).toBe('flagged-for-another-reason');
    expect(blocker({ ...flagged, reasons: ['start-level-locked', 'some-future-code'] })).toBe('flagged-for-another-reason');
    expect(blocker({ ...flagged, reasons: ['rt-below-floor'] })).toBe('not-start-level-locked');
    expect(blocker({ ...flagged, scoringVersion: 2 })).toBe('scoring-version-changed');
    expect(blocker(unlocking.result)).toBe('not-flagged');
    expect(upgradeBlocker({ ...stored(lockedRaw, flagged), gameVersion: 2 }, unlocking.progress, GAME_MODULE_REGISTRY))
      .toBe('unknown-game-version');
    expect(upgradeSession(stored(lockedRaw, flagged), locked.progress!, {
      sessionId: 'session-locked-0001', upgradedAt: ts(T0), registry: GAME_MODULE_REGISTRY,
    })).toBeNull();
  });
});

describe('upgrade predicate and fixpoint', () => {
  const withoutWriteTime = ({ updatedAt: _updatedAt, ...rest }: GameProgress) => rest;

  it('upgrades a session whose other reasons are diagnostics, keeping them: the same result as play order', () => {
    // A disagreeing summary and client peak are diagnostics: they must not decide validity, so they must not block the upgrade.
    const lockedRaw: Record<string, unknown> = { ...session({ seed: 41, startLevel: 3, targetPeak: 6, endedAtMs: T0 }), peakLevel: 9 };
    const summary = lockedRaw.summary as Record<string, unknown>;
    const noisy = { ...lockedRaw, summary: { ...summary, score: 1 } };
    const unlockingRaw = session({ seed: 42, startLevel: 1, targetPeak: 5, endedAtMs: T0 - 10 * MINUTE });

    const locked = decide(noisy, null, 'session-noisy-00001', T0 + MINUTE);
    expect(locked.result).toMatchObject({ validity: 'flagged', reasons: ['start-level-locked', 'peak-level-mismatch', 'summary-mismatch'] });
    const unlocking = decide(unlockingRaw, locked.progress, 'session-unlock-0002', T0 + 2 * MINUTE);
    const upgraded = upgradeSession(stored(noisy, locked.result), unlocking.progress!, {
      sessionId: 'session-noisy-00001', upgradedAt: ts(T0 + 3 * MINUTE), registry: GAME_MODULE_REGISTRY,
    })!;

    const inPlayOrder = decide(noisy, decide(unlockingRaw, null, 'session-unlock-0002', T0 + MINUTE).progress, 'session-noisy-00001', T0 + 2 * MINUTE);
    expect(inPlayOrder.result).toMatchObject({ validity: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch'] });
    expect(upgraded.result).toMatchObject({
      validity: 'valid', reasons: ['peak-level-mismatch', 'summary-mismatch', 'start-level-unlocked-later'], processedAt: locked.result.processedAt,
    });
    expect(withoutWriteTime(upgraded.progress!)).toEqual(withoutWriteTime(inPlayOrder.progress!));
  });

  it('keeps a mutually locked pair flagged in every order: neither may unlock the other', () => {
    // A (start 3, peak 6) would unlock B; B (start 5, peak 7) would unlock A; nothing else unlocks either.
    const a = session({ seed: 43, startLevel: 3, targetPeak: 6, endedAtMs: T0 });
    const b = session({ seed: 44, startLevel: 5, targetPeak: 7, endedAtMs: T0 + MINUTE });
    for (const [first, second] of [[a, b], [b, a]] as const) {
      const one = decide(first, null, first === a ? 'session-pair-a0001' : 'session-pair-b0001', T0 + 2 * MINUTE);
      const two = decide(second, one.progress, second === a ? 'session-pair-a0001' : 'session-pair-b0001', T0 + 3 * MINUTE);
      expect([one.result.validity, two.result.validity]).toEqual(['flagged', 'flagged']);
      expect(one.unlockRaised || two.unlockRaised).toBe(false);
      for (const [raw, decision] of [[first, one], [second, two]] as const) {
        expect(upgradeBlocker(stored(raw, decision.result), two.progress, GAME_MODULE_REGISTRY)).toBe('still-locked');
      }
      expect(two.progress).toMatchObject({ bestPeakLevel: {}, bests: {}, sessionsCompleted: 2 });
    }
  });

  it('scans only the levels that can hold an upgradable session', () => {
    expect(upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, null)).toEqual({ from: 2, to: 1 });
    const progress = decide(session({ startLevel: 1, targetPeak: 6 }), null, 'session-scan-00001', T0).progress!;
    expect(upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, mm.MODE_ID, progress)).toEqual({ from: 2, to: 5 });
    expect(upgradeScanLevels(GAME_MODULE_REGISTRY, mm.GAME_ID, 'no-such-mode', progress)).toEqual({ from: 1, to: 0 });
  });
});

describe('applyValidEffects', () => {
  const raw = session({ seed: 31, startLevel: 1, targetPeak: 6 });
  const evaluation = scored(raw);
  const input = (validity: 'valid' | 'flagged', appliedAt = ts(T0 + MINUTE)) => ({
    definition: mm.definition,
    sessionId: 'session-00000031',
    session: evaluation.session,
    outcome: validity === 'valid'
      ? { validity, peakLevel: 6, recordKey: 'timed-90:1', recordValues: { score: evaluation.scored.score, correct: 5, peakLevel: 6 } }
      : { validity },
    appliedAt,
  } as const);

  it('is idempotent: applying it twice equals applying it once', () => {
    const counted = applySession(null, input('flagged'))!;
    const once = applyValidEffects(counted, input('valid') as Parameters<typeof applyValidEffects>[1]);

    expect(applyValidEffects(once, input('valid') as Parameters<typeof applyValidEffects>[1])).toEqual(once);
  });

  it('never touches totals', () => {
    const counted = applySession(null, input('flagged'))!;
    const effects = applyValidEffects(counted, input('valid') as Parameters<typeof applyValidEffects>[1]);

    expect(effects.sessionsCompleted).toBe(counted.sessionsCompleted);
    expect(effects.activeMs).toBe(counted.activeMs);
    expect(effects.lastPlayedAt).toEqual(counted.lastPlayedAt);
    expect(effects.bestPeakLevel).toEqual({ 'timed-90': 6 });
  });

  it('composes applySession: totals, then the valid-only effects', () => {
    const counted = applySession(null, input('flagged'))!;

    expect(applyValidEffects(counted, input('valid') as Parameters<typeof applyValidEffects>[1]))
      .toEqual(applySession(null, input('valid')));
  });

  it('refuses anything but a valid outcome', () => {
    const counted = applySession(null, input('flagged'))!;

    expect(() => applyValidEffects(counted, input('flagged') as unknown as Parameters<typeof applyValidEffects>[1])).toThrow(/valid outcome/);
  });

  it('gives an abandoned session no effects', () => {
    const abandoned = { ...input('valid'), session: { ...evaluation.session, status: 'abandoned' as const } };
    const counted = applySession(null, { ...abandoned, outcome: { validity: 'flagged' } })!;

    expect(applyValidEffects(counted, abandoned as Parameters<typeof applyValidEffects>[1])).toEqual(counted);
  });
});

describe('processingRecord', () => {
  it('counts attempts and keeps the latest state and reason', () => {
    expect(processingRecord(undefined, 'unsupported', 'unknown-game-version', ts(T0)))
      .toEqual({ state: 'unsupported', reason: 'unknown-game-version', attempts: 1, updatedAt: ts(T0) });
    expect(processingRecord({ attempts: 3 }, 'failed', 'internal-error', ts(T0)).attempts).toBe(4);
    expect(processingRecord({ attempts: 'x' }, 'failed', 'internal-error', ts(T0)).attempts).toBe(1);
  });
});
