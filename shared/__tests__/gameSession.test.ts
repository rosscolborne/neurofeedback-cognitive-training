import { describe, expect, it } from 'vitest';
import {
  DomainReadError,
  gameSessionWriteSchema,
  outcomeFromResult,
  readGameSession,
  readGameSessionFor,
  readSessionAggregateFields,
  readSessionProgressFields,
  serverResultWriteSchema,
  SESSION_AGGREGATE_FIELDS,
  SESSION_PROGRESS_FIELDS,
  SESSION_SEED_MAX,
  sessionProcessingWriteSchema,
  trustedGameSessionSchemaFor,
} from '@nfct/shared';
import { at, fixtureGame, storedSession, unprocessedSession } from './fixtures';

function unrecognizedKeys(raw: unknown): string[] {
  const result = gameSessionWriteSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []));
}

function storedResult(): Record<string, unknown> {
  return storedSession().result as Record<string, unknown>;
}

describe('game session schema', () => {
  it('reads and writes a valid stored session', () => {
    const raw = storedSession();

    expect(gameSessionWriteSchema.parse(raw)).toEqual(raw);
    expect(readGameSession(raw)).toEqual(raw);
    expect(readGameSessionFor(fixtureGame, raw)).toEqual(raw);
  });

  it('reads a session that the server has not processed yet', () => {
    const unprocessed = unprocessedSession();

    expect(readGameSession(unprocessed)).toEqual(unprocessed);
  });

  it('refuses to write an eegLinked field, whatever its value, and never reads one', () => {
    for (const eegLinked of [true, false]) {
      const raw = { ...storedSession(), eegLinked };

      expect(unrecognizedKeys(raw)).toEqual(['eegLinked']);
      expect(readGameSession(raw)).not.toHaveProperty('eegLinked');
    }
  });

  it('rejects unknown keys at every level on write', () => {
    const session = storedSession();
    const cases: Record<string, unknown>[] = [
      { ...session, hadEeg: true },
      { ...session, client: { ...(session.client as object), deviceId: 'abc' } },
      { ...session, summary: { ...(session.summary as object), eegFocus: 0.8 } },
      { ...session, result: { ...storedResult(), achievementsAwarded: [] } },
      { ...session, result: { ...storedResult(), responseTime: { medianMs: 1, meanMs: 1, p90Ms: 1, maxMs: 2 } } },
    ];

    for (const raw of cases) {
      expect(unrecognizedKeys(raw)).toHaveLength(1);
    }
  });

  it('reads fields added by a newer compatible writer, ignoring what it does not understand', () => {
    const session = storedSession();
    const newer = {
      ...session,
      hadEegAtCompletion: true,
      client: { ...(session.client as object), buildNumber: 42 },
      result: { ...storedResult(), achievementsAwarded: ['first-run'] },
    };

    expect(readGameSession(newer)).toEqual(session);
  });

  it('reads domain contributions from a newer catalogue, ignoring unknown domains', () => {
    const newer = {
      ...storedSession(),
      result: { ...storedResult(), domainContributions: { reasoning: 0.5, attention: 0.3, 'processing-speed': 0.2 } },
    };

    expect(readGameSession(newer).result).toMatchObject({ domainContributions: { reasoning: 0.5, 'processing-speed': 0.2 } });
    expect(gameSessionWriteSchema.safeParse(newer).success).toBe(false);
  });

  it('keeps performanceIndex nullable and paired with its version', () => {
    const session = storedSession();
    const result = storedResult();

    expect(readGameSession(session).result).toMatchObject({ performanceIndex: null, performanceIndexVersion: null });
    expect(() => readGameSession({ ...session, result: { ...result, performanceIndex: 0.7 } })).toThrow(DomainReadError);
    expect(() => readGameSession({ ...session, result: { ...result, performanceIndexVersion: 1 } })).toThrow(DomainReadError);
    expect(() => readGameSession({ ...session, result: { ...result, performanceIndex: undefined } })).toThrow(DomainReadError);
  });

  it('requires startLevel and peakLevel, bounding the client peak only as the rules do', () => {
    const { startLevel: _startLevel, ...withoutStart } = storedSession();

    expect(() => readGameSession(withoutStart)).toThrow(DomainReadError);
    // The client peak is an untrusted observation: one below the start level
    // is the game's peak-level-mismatch diagnostic, never a schema failure.
    expect(readGameSession({ ...storedSession(), startLevel: 4, peakLevel: 3 }).peakLevel).toBe(3);
    expect(gameSessionWriteSchema.safeParse({ ...unprocessedSession(), startLevel: 4, peakLevel: 3 }).success).toBe(true);
    for (const peakLevel of [0, 51, 2.5]) {
      expect(() => readGameSession({ ...storedSession(), peakLevel })).toThrow(/peakLevel/);
    }
  });

  it('requires an unsigned 32-bit integer seed, on write and on read', () => {
    const { seed: _seed, ...withoutSeed } = storedSession();

    expect(gameSessionWriteSchema.safeParse(withoutSeed).success).toBe(false);
    expect(() => readGameSession(withoutSeed)).toThrow(DomainReadError);
    for (const seed of [0, 1, SESSION_SEED_MAX]) {
      expect(gameSessionWriteSchema.parse({ ...storedSession(), seed }).seed).toBe(seed);
    }
    for (const seed of [-1, SESSION_SEED_MAX + 1, 1.5, '42', null, Number.NaN]) {
      expect(gameSessionWriteSchema.safeParse({ ...storedSession(), seed }).success).toBe(false);
      expect(() => readGameSession({ ...storedSession(), seed })).toThrow(DomainReadError);
    }
  });

  it('refuses a schema version it cannot read', () => {
    expect(() => readGameSession({ ...storedSession(), schemaVersion: 2 })).toThrow(/unsupported schemaVersion 2/);
    expect(() => readGameSession(null)).toThrow(DomainReadError);
  });

  describe('server result', () => {
    const processing = { processedAt: at(3), scoringVersion: 1 };

    it('marks an invalid session processed without any gameplay values', () => {
      const invalid = { ...processing, validity: 'invalid', reasons: ['schema-invalid'] };

      expect(serverResultWriteSchema.parse(invalid)).toEqual(invalid);
      expect(readGameSession({ ...storedSession(), result: invalid }).result).toEqual(invalid);
      expect(outcomeFromResult(serverResultWriteSchema.parse(invalid))).toEqual({ validity: 'invalid' });
    });

    it('does not accept invented gameplay values on an invalid result', () => {
      for (const extra of [{ score: 0 }, { accuracy: null }, { personalBest: false }, { domainContributions: {} }]) {
        expect(serverResultWriteSchema.safeParse({ ...processing, validity: 'invalid', reasons: ['schema-invalid'], ...extra }).success)
          .toBe(false);
      }
    });

    it('needs a reason for a flagged or invalid session', () => {
      expect(serverResultWriteSchema.safeParse({ ...processing, validity: 'invalid', reasons: [] }).success).toBe(false);
      const { recordKey: _recordKey, recordValues: _recordValues, personalBest: _personalBest, unlocked: _unlocked, ...scored } = storedResult();
      expect(serverResultWriteSchema.safeParse({ ...scored, validity: 'flagged', reasons: [] }).success).toBe(false);
      expect(serverResultWriteSchema.parse({ ...scored, validity: 'flagged', reasons: ['rt-below-floor'] }).validity).toBe('flagged');
    });

    it('records the trusted peak, record key and record values of a valid session', () => {
      const result = serverResultWriteSchema.parse(storedResult());

      expect(outcomeFromResult(result)).toEqual({
        validity: 'valid',
        peakLevel: 3,
        recordKey: 'endless:2',
        recordValues: { score: 20, correct: 1, peakLevel: 3 },
      });
      const { peakLevel: _peakLevel, ...withoutPeak } = storedResult();
      expect(serverResultWriteSchema.safeParse(withoutPeak).success).toBe(false);
      expect(serverResultWriteSchema.safeParse({ ...storedResult(), recordValues: { correct_answers: 1 } }).success).toBe(false);
    });
  });

  describe('with a game definition', () => {
    it('validates trials and metrics with the game\'s own schemas', () => {
      const session = storedSession();
      const trials = session.trials as object[];

      expect(() => readGameSessionFor(fixtureGame, { ...session, trials: [{ ...trials[0], hint: 'x' }] }))
        .toThrow(DomainReadError);
      expect(() => readGameSessionFor(fixtureGame, { ...session, summary: { ...(session.summary as object), metrics: {} } }))
        .toThrow(DomainReadError);
    });

    it('enforces the game\'s trial cap', () => {
      const trials = Array.from({ length: fixtureGame.limits.maxTrials + 1 }, () => ({ level: 2, correct: true, rtMs: 900 }));

      expect(() => readGameSessionFor(fixtureGame, { ...storedSession(), trials })).toThrow(DomainReadError);
    });

    it('applies only to its own game version', () => {
      const session = storedSession();

      expect(() => readGameSessionFor({ ...fixtureGame, gameVersion: 2 }, session)).toThrow(/gameVersion 2 only/);
      expect(readGameSession(session).gameVersion).toBe(1);
    });

    it('rejects another game, an unknown mode, and a start level beyond the mode', () => {
      const session = storedSession();

      expect(() => readGameSessionFor(fixtureGame, { ...session, gameId: 'other-game' })).toThrow(/gameId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'blitz' })).toThrow(/modeId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'sprint', startLevel: 4, peakLevel: 4 }))
        .toThrow(/startLevel/);
    });

    it('reads a client peak beyond the mode: it is only a diagnostic', () => {
      const session = { ...storedSession(), modeId: 'sprint', startLevel: 3, peakLevel: 4 };

      expect(readGameSessionFor(fixtureGame, session).peakLevel).toBe(4);
    });
  });

  describe('trusted scoring schema', () => {
    const schema = trustedGameSessionSchemaFor(fixtureGame);

    it('checks trials and the envelope with the game version\'s own schemas', () => {
      const session = unprocessedSession();
      const trials = session.trials as object[];

      expect(schema.parse(session)).toEqual(session);
      expect(schema.safeParse({ ...session, trials: [{ ...trials[0], hint: 'x' }] }).success).toBe(false);
      expect(schema.safeParse({ ...session, gameVersion: 2 }).success).toBe(false);
      expect(schema.safeParse({ ...session, modeId: 'sprint', startLevel: 4 }).success).toBe(false);
      expect(schema.safeParse({ ...session, surprise: true }).success).toBe(false);
    });

    it('checks the display summary only for the structure the rules enforce', () => {
      const session = unprocessedSession();
      const summary = session.summary as Record<string, unknown>;
      const withSummary = (change: Record<string, unknown>) => ({ ...session, summary: { ...summary, ...change } });

      // Values the game's own summary schema rejects are never a schema failure here.
      for (const change of [
        { accuracy: 1.5 }, { trialsTotal: -1 }, { trialsCorrect: 0.5 }, { metrics: {} }, { metrics: { lives: 3 } },
        // Firestore doubles the rules accept as numbers, though z.number() refuses them.
        { score: Number.NaN }, { accuracy: Number.POSITIVE_INFINITY }, { trialsTotal: Number.NEGATIVE_INFINITY },
        { responseTime: { medianMs: Number.NaN, meanMs: 1, p90Ms: Number.POSITIVE_INFINITY } },
      ]) {
        expect(schema.safeParse(withSummary(change)).success).toBe(true);
      }
      // The rules' structure still holds: exact keys, value types, at most 32 metrics.
      const tooManyMetrics = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`m${index}`, 1]));
      for (const change of [{ score: '10' }, { accuracy: 'high' }, { extra: 1 }, { responseTime: { medianMs: 1 } }, { metrics: tooManyMetrics }]) {
        expect(schema.safeParse(withSummary(change)).success).toBe(false);
      }
    });
  });

  describe('server processing state', () => {
    const processing = { state: 'failed', reason: 'internal-error', attempts: 1, updatedAt: at(3) };

    it('records why trusted scoring has not written a result yet', () => {
      expect(sessionProcessingWriteSchema.parse(processing)).toEqual(processing);
      expect(gameSessionWriteSchema.parse({ ...unprocessedSession(), processing }).processing).toEqual(processing);
      expect(sessionProcessingWriteSchema.parse({ ...processing, state: 'unsupported' }).state).toBe('unsupported');
      for (const change of [{ state: 'pending' }, { reason: 'Not A Code' }, { attempts: 0 }, { updatedAt: '2026-09-30' }, { extra: 1 }]) {
        expect(sessionProcessingWriteSchema.safeParse({ ...processing, ...change }).success).toBe(false);
      }
    });

    it('is never written together with a result', () => {
      expect(gameSessionWriteSchema.safeParse({ ...storedSession(), processing }).success).toBe(false);
    });

    it('reads a processing state from a newer server that this build does not know', () => {
      const newer = { ...unprocessedSession(), processing: { ...processing, state: 'deferred', note: 'x' } };

      expect(readGameSession(newer).processing?.state).toBe('deferred');
    });
  });

  describe('progress fields', () => {
    it('reads only what progress depends on, from a projection without trials or summary', () => {
      const session = storedSession();
      const projection = Object.fromEntries(SESSION_PROGRESS_FIELDS.map((field) => [field, session[field]]));

      expect(SESSION_PROGRESS_FIELDS).not.toContain('trials');
      expect(SESSION_PROGRESS_FIELDS).not.toContain('summary');
      expect(SESSION_PROGRESS_FIELDS).not.toContain('peakLevel');
      expect(readSessionProgressFields(projection)).toMatchObject({ gameId: 'fixture-game', startLevel: 2, result: session.result });
      expect(readSessionProgressFields(unprocessedSession()).result).toBeUndefined();
      expect(() => readSessionProgressFields({ ...projection, schemaVersion: 2 })).toThrow(DomainReadError);
    });

    it('adds only the local date for the stats (NFCT-13): still no trials, summary or client peak', () => {
      const session = storedSession();
      const projection = Object.fromEntries(SESSION_AGGREGATE_FIELDS.map((field) => [field, session[field]]));

      expect([...SESSION_AGGREGATE_FIELDS].sort()).toEqual([...SESSION_PROGRESS_FIELDS, 'localDate'].sort());
      expect(readSessionAggregateFields(projection)).toMatchObject({ localDate: '2026-09-29', startLevel: 2, result: session.result });
      expect(() => readSessionAggregateFields({ ...projection, localDate: '2026-02-30' })).toThrow(DomainReadError);
    });
  });
});
