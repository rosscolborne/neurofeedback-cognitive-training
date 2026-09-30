import { describe, expect, it } from 'vitest';
import { DomainReadError, gameSessionSchema, readGameSession, readGameSessionFor } from '@nfct/shared';
import { fixtureGame, storedSession } from './fixtures';

function unrecognizedKeys(raw: unknown): string[] {
  const result = gameSessionSchema.safeParse(raw);
  if (result.success) return [];
  return result.error.issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []));
}

describe('game session schema', () => {
  it('reads a valid stored session', () => {
    const raw = storedSession();

    expect(readGameSession(raw)).toEqual(raw);
    expect(readGameSessionFor(fixtureGame, raw)).toEqual(raw);
  });

  it('reads a session that the server has not processed yet', () => {
    const { result: _result, ...unprocessed } = storedSession();

    expect(readGameSession(unprocessed)).toEqual(unprocessed);
  });

  it('rejects an eegLinked field, whatever its value', () => {
    for (const eegLinked of [true, false]) {
      const raw = { ...storedSession(), eegLinked };

      expect(unrecognizedKeys(raw)).toEqual(['eegLinked']);
      expect(() => readGameSession(raw)).toThrow(DomainReadError);
    }
  });

  it('rejects unknown keys at every level', () => {
    const session = storedSession();
    const cases: Record<string, unknown>[] = [
      { ...session, hadEeg: true },
      { ...session, client: { ...(session.client as object), deviceId: 'abc' } },
      { ...session, summary: { ...(session.summary as object), eegFocus: 0.8 } },
      { ...session, result: { ...(session.result as object), achievementsAwarded: [] } },
      { ...session, result: { ...(session.result as object), responseTime: { medianMs: 1, meanMs: 1, p90Ms: 1, maxMs: 2 } } },
    ];

    for (const raw of cases) {
      expect(unrecognizedKeys(raw)).toHaveLength(1);
    }
  });

  it('keeps performanceIndex nullable and paired with its version', () => {
    const session = storedSession();
    const result = session.result as Record<string, unknown>;

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

    it('rejects another game, an unknown version or mode, and levels beyond the mode', () => {
      const session = storedSession();

      expect(() => readGameSessionFor(fixtureGame, { ...session, gameId: 'other-game' })).toThrow(/gameId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, gameVersion: 2 })).toThrow(/gameVersion/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'blitz' })).toThrow(/modeId/);
      expect(() => readGameSessionFor(fixtureGame, { ...session, modeId: 'sprint', peakLevel: 4 })).toThrow(/peakLevel/);
    });
  });
});
