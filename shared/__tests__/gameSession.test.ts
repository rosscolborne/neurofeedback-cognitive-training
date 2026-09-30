import { describe, expect, it } from 'vitest';
import {
  DomainReadError,
  gameSessionWriteSchema,
  outcomeFromResult,
  readGameSession,
  readGameSessionFor,
  serverResultWriteSchema,
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

  it('requires startLevel and peakLevel, with the peak at or above the start', () => {
    const { startLevel: _startLevel, ...withoutStart } = storedSession();

    expect(() => readGameSession(withoutStart)).toThrow(DomainReadError);
    expect(() => readGameSession({ ...storedSession(), startLevel: 4, peakLevel: 3 })).toThrow(/peakLevel/);
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

    it('rejects another game, an unknown mode, and levels beyond the mode', () => {
      const session = storedSession();

      expect(() => readGameSessionFor(fixtureGame, { ...session, gameId: 'other-game' })).toThrow(/gameId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'blitz' })).toThrow(/modeId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'sprint', peakLevel: 4 })).toThrow(/peakLevel/);
    });
  });
});
