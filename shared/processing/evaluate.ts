import type { z } from 'zod';
import type { ScoredResult } from '../games/definition';
import { documentIdSchema } from '../primitives';
import { GAME_SESSION_SCHEMA_VERSION } from '../schemas/gameSession';
import { clockDiagnostics } from './clock';
import { GAME_MODULE_REGISTRY } from './modules';
import { mergeReasons, PROCESSING_REASONS, serverReason, type ProcessingReason, type ReasonEntry } from './reasons';
import { reasonOutcomeFor, type GameModuleRegistry, type GameVersionModule, type SessionEnvelope } from './registry';

// Trusted scoring, step by step (NFCT-19, card order): validate the session
// with its own game version's schemas, rescore it from its trials, run the
// version's plausibility checks and trusted scoring's own checks. Pure: it
// reads only the session document, never progress, a clock or anything about
// EEG. The start-level unlock needs progress, so it is decided afterwards, in
// the processing transaction (decideSession).

/** Where the session document lives: trusted, from its path. */
export type SessionLocation = {
  readonly uid: string;
  readonly sessionId: string;
};

export type SessionEvaluation =
  | {
    /** No module can process it: `processing.state = 'unsupported'`, never a result. */
    readonly kind: 'unsupported';
    readonly reason: ProcessingReason;
  }
  | {
    /** Counts nowhere. Its result records only the reasons. */
    readonly kind: 'invalid';
    readonly module: GameVersionModule;
    readonly reasons: string[];
  }
  | {
    /** Valid or flagged by the checks so far; the start-level unlock is still to decide. */
    readonly kind: 'scored';
    readonly module: GameVersionModule;
    readonly session: SessionEnvelope;
    readonly scored: ScoredResult<Record<string, unknown>>;
    /** The version's reasons (canonical order), then trusted scoring's clock diagnostics. */
    readonly entries: readonly ReasonEntry[];
  };

/** The fields trusted scoring writes; never part of what the client submitted. */
const SERVER_FIELDS = new Set(['result', 'processing']);

function clientFields(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !SERVER_FIELDS.has(key)));
}

/**
 * Whether the only problem is fields this build does not know in the
 * envelope, `client` or `summary`. The rules gate those with exact key sets,
 * so a client cannot add such a field: it only appears when a new optional
 * field reached the rules or clients before a Functions deploy that knows it.
 * That is this build's gap, not the session's fault, so the session is
 * unsupported (re-driven after the deploy) rather than invalid. Trials are
 * different: the rules do not check them, and a version's trial shape is
 * frozen, so an unknown trial field stays a schema failure.
 */
function onlyUnknownEnvelopeFields(issues: readonly z.core.$ZodIssue[]): boolean {
  return issues.length > 0 && issues.every((issue) => issue.code === 'unrecognized_keys' && issue.path[0] !== 'trials');
}

/**
 * Evaluates one session document as the client wrote it (any `result` or
 * `processing` is ignored). Deterministic: the same document always gives the
 * same evaluation.
 *
 * - unsupported: its `schemaVersion`, `gameId` or `gameVersion` has no module
 *   in this build (including values it cannot even read), or its only fault
 *   is envelope fields this build does not know (a deploy-order problem);
 * - invalid: it fails its version's schemas ('schema-invalid'), its path does
 *   not match it, or the version's checks find a contract violation;
 * - scored: everything else, with the version's reasons and the clock
 *   diagnostics.
 */
export function evaluateSession(
  raw: unknown,
  location: SessionLocation,
  registry: GameModuleRegistry = GAME_MODULE_REGISTRY,
): SessionEvaluation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { kind: 'unsupported', reason: PROCESSING_REASONS.unsupportedSchemaVersion };
  }
  const document = raw as Record<string, unknown>;
  if (document.schemaVersion !== GAME_SESSION_SCHEMA_VERSION) {
    return { kind: 'unsupported', reason: PROCESSING_REASONS.unsupportedSchemaVersion };
  }
  const { gameId, gameVersion } = document;
  if (typeof gameId !== 'string' || !registry.current(gameId)) {
    return { kind: 'unsupported', reason: PROCESSING_REASONS.unknownGame };
  }
  const module = typeof gameVersion === 'number' ? registry.find(gameId, gameVersion) : undefined;
  if (!module) return { kind: 'unsupported', reason: PROCESSING_REASONS.unknownGameVersion };

  const locationReasons: ReasonEntry[] = [
    ...(document.userId === location.uid ? [] : [serverReason('user-id-mismatch')]),
    ...(documentIdSchema.safeParse(location.sessionId).success ? [] : [serverReason('session-id-invalid')]),
  ];

  const evaluation = module.evaluate(clientFields(document));
  if (!evaluation.ok) {
    if (onlyUnknownEnvelopeFields(evaluation.issues)) {
      return { kind: 'unsupported', reason: PROCESSING_REASONS.unknownSessionField };
    }
    return { kind: 'invalid', module, reasons: mergeReasons([serverReason('schema-invalid'), ...locationReasons]).reasons };
  }

  const entries: ReasonEntry[] = [
    ...evaluation.reasons.map((code) => ({ code, outcome: reasonOutcomeFor(module, code)! })),
    ...locationReasons,
    ...clockDiagnostics(evaluation.session),
  ];
  const merged = mergeReasons(entries);
  if (evaluation.outcome === 'invalid' || merged.validity === 'invalid') {
    return { kind: 'invalid', module, reasons: merged.reasons };
  }
  return { kind: 'scored', module, session: evaluation.session, scored: evaluation.scored, entries };
}
