import { z } from 'zod';
import type { GameDefinition } from '../games/definition';
import { gameSessionSchemaFor, gameSessionWriteSchema } from './gameSession';

// What a client sends to create users/{uid}/gameSessions/{sessionId} (NFCT-20).
//
// It is derived from the session envelope's write schema, never re-listed, so
// every envelope field, bound and refinement applies to a create unchanged,
// including fields added to the envelope later. It differs from the stored
// document in two ways only:
//
// - It has no server-owned fields. `result` and `processing` are written only
//   by trusted scoring (NFCT-19), and the rules refuse a create carrying either.
// - `createdAt` is the writer's server-clock placeholder (the web SDK's
//   `serverTimestamp()`), because the rules require `createdAt == request.time`.
//   shared/ imports no Firebase SDK, so the writer passes the schema that
//   accepts its placeholder.

/** Session fields only trusted server code writes. A client create never carries them. */
export const SERVER_OWNED_GAME_SESSION_KEYS = ['result', 'processing'] as const;
export type ServerOwnedGameSessionKey = (typeof SERVER_OWNED_GAME_SESSION_KEYS)[number];

type CreateShape<Shape extends z.core.$ZodShape, Stamp> =
  Omit<Shape, ServerOwnedGameSessionKey | 'createdAt'> & { createdAt: z.ZodType<Stamp> };

/**
 * The create schema for any session envelope: the envelope's own fields and
 * refinements, minus the server-owned fields, with `createdAt` replaced by the
 * writer's server-clock placeholder. Unknown keys, including `result` and
 * `processing`, are rejected.
 */
export function gameSessionCreateSchemaFrom<Shape extends z.core.$ZodShape, Stamp>(
  envelope: z.ZodObject<Shape>,
  serverTimestamp: z.ZodType<Stamp>,
) {
  const shape: Record<string, z.core.$ZodType> = { ...envelope.shape };
  for (const key of [...SERVER_OWNED_GAME_SESSION_KEYS, 'createdAt']) delete shape[key];
  shape.createdAt = serverTimestamp;
  // The envelope's refinements (for example endedAt after startedAt, and a
  // game's own mode and version checks) read only fields a create keeps.
  const refinements = (envelope.def.checks ?? []) as z.core.$ZodCheck<unknown>[];
  return z.strictObject(shape as CreateShape<Shape, Stamp>).check(...refinements);
}

/** Any game's session create, current schema, strict. */
export function gameSessionCreateSchema<Stamp>(serverTimestamp: z.ZodType<Stamp>) {
  return gameSessionCreateSchemaFrom(gameSessionWriteSchema, serverTimestamp);
}

/**
 * A session create for one game version, with trials and metrics checked by
 * that version's own schemas, as `gameSessionSchemaFor` checks a stored session.
 */
export function gameSessionCreateSchemaFor<Trial, Metrics extends object, Stamp>(
  definition: GameDefinition<Trial, Metrics>,
  serverTimestamp: z.ZodType<Stamp>,
) {
  return gameSessionCreateSchemaFrom(gameSessionSchemaFor(definition, 'write'), serverTimestamp);
}

export type GameSessionCreate<Stamp> = z.output<ReturnType<typeof gameSessionCreateSchema<Stamp>>>;
export type GameSessionCreateOf<Trial, Metrics extends object, Stamp> =
  z.output<ReturnType<typeof gameSessionCreateSchemaFor<Trial, Metrics, Stamp>>>;
