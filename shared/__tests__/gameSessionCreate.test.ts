import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  gameSessionCreateSchema,
  gameSessionCreateSchemaFor,
  gameSessionCreateSchemaFrom,
  gameSessionWriteSchema,
  SERVER_OWNED_GAME_SESSION_KEYS,
} from '@nfct/shared';
import { at, fixtureGame, storedSession, unprocessedSession } from './fixtures';

/** Stands in for the web SDK's serverTimestamp() sentinel, which shared/ never imports. */
class ServerClock {
  readonly kind = 'server-clock';
}
const serverClock = z.custom<ServerClock>((value) => value instanceof ServerClock, 'Expected the server clock');

const createSchema = gameSessionCreateSchema(serverClock);

/** A client create: an unprocessed session whose createdAt is the server clock. */
function sessionCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...unprocessedSession(), createdAt: new ServerClock(), ...overrides };
}

function issueCodes(schema: z.ZodType, raw: unknown): string[] {
  const result = schema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`);
}

describe('game session create schema', () => {
  it('accepts an unprocessed session and keeps the server clock placeholder as given', () => {
    const raw = sessionCreate();
    const parsed = createSchema.parse(raw);

    expect(parsed).toEqual(raw);
    expect(parsed.createdAt).toBe(raw.createdAt);
  });

  it('has exactly the envelope keys, minus the server-owned ones', () => {
    const envelopeKeys = Object.keys(gameSessionWriteSchema.shape)
      .filter((key) => !(SERVER_OWNED_GAME_SESSION_KEYS as readonly string[]).includes(key));

    expect(Object.keys(createSchema.shape).sort()).toEqual(envelopeKeys.sort());
    expect(Object.keys(createSchema.shape)).not.toContain('result');
    expect(Object.keys(createSchema.shape)).not.toContain('processing');
  });

  it('refuses the server-owned result and processing fields, whatever their value', () => {
    expect(issueCodes(createSchema, sessionCreate({ result: storedSession().result }))).toEqual([':unrecognized_keys']);
    expect(issueCodes(createSchema, sessionCreate({ result: null }))).toEqual([':unrecognized_keys']);
    expect(issueCodes(createSchema, sessionCreate({ processing: { state: 'failed' } }))).toEqual([':unrecognized_keys']);
  });

  it('requires createdAt to be the server clock, never a client timestamp', () => {
    expect(issueCodes(createSchema, sessionCreate({ createdAt: at(5) }))).toEqual(['createdAt:custom']);
    const { createdAt: _createdAt, ...withoutCreatedAt } = sessionCreate();
    expect(issueCodes(createSchema, withoutCreatedAt)).toEqual(['createdAt:custom']);
  });

  it("keeps the envelope's field rules and refinements", () => {
    expect(issueCodes(createSchema, sessionCreate({ startLevel: 0 }))).toEqual(['startLevel:too_small']);
    expect(issueCodes(createSchema, sessionCreate({ userId: 'a/b' }))).toEqual(['userId:invalid_format']);
    expect(issueCodes(createSchema, sessionCreate({ eegLinked: true }))).toEqual([':unrecognized_keys']);
    expect(issueCodes(createSchema, sessionCreate({ startedAt: at(5), endedAt: at(5) }))).toEqual(['endedAt:custom']);
  });

  it('carries a field added to the envelope through to the create without listing it', () => {
    // How a new envelope field (for example NFCT-17's session seed) reaches the create.
    const extended = gameSessionWriteSchema.safeExtend({ addedLater: z.string().min(1) });
    const schema = gameSessionCreateSchemaFrom(extended, serverClock);

    expect(issueCodes(schema, sessionCreate())).toEqual(['addedLater:invalid_type']);
    expect(schema.parse(sessionCreate({ addedLater: 'value' }))).toMatchObject({ addedLater: 'value' });
    // The envelope's refinements still apply after the extension.
    expect(issueCodes(schema, sessionCreate({ addedLater: 'value', startedAt: at(5), endedAt: at(5) }))).toEqual(['endedAt:custom']);
  });

  it("checks one game version's trials, metrics, mode and version", () => {
    const schema = gameSessionCreateSchemaFor(fixtureGame, serverClock);

    expect(schema.safeParse(sessionCreate()).success).toBe(true);
    expect(issueCodes(schema, sessionCreate({ trials: [{ level: 2, correct: 'yes', rtMs: 900 }] })))
      .toEqual(['trials.0.correct:invalid_type']);
    expect(issueCodes(schema, sessionCreate({ gameId: 'other-game' }))).toEqual(['gameId:custom']);
    expect(issueCodes(schema, sessionCreate({ gameVersion: 2 }))).toEqual(['gameVersion:custom']);
    expect(issueCodes(schema, sessionCreate({ modeId: 'unknown' }))).toEqual(['modeId:custom']);
    expect(issueCodes(schema, sessionCreate({ result: storedSession().result }))).toEqual([':unrecognized_keys']);
  });
});
