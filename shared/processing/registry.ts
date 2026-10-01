import type { z } from 'zod';
import type { GameDefinition, ScoredResult } from '../games/definition';
import { recordValuesFor } from '../progress/applySession';
import {
  sessionSummarySchemaFor,
  trustedGameSessionSchemaFor,
  type GameSession,
  type TrustedGameSessionOf,
} from '../schemas/gameSession';
import { SERVER_REASON_OUTCOMES, type ReasonOutcome } from './reasons';

// The frozen game-version module registry (NFCT-19): (gameId, gameVersion) ->
// the module that validates, rescores and checks sessions of exactly that
// version. A session is only ever judged by its own version's module, never
// revalidated or rescored with a later one (ADR-001 decision 8).
//
// A version with no module is not invalid: trusted scoring marks the session
// `processing.state = 'unsupported'`, and a later deploy that registers the
// module re-drives it. The rules' supportedGameVersions() window must stay
// inside this registry (a test checks it).

/**
 * A game definition whose trial and metrics types are erased. The registry
 * holds definitions of different games and versions; each module's own code
 * keeps its types.
 */
export type AnyGameDefinition = GameDefinition<any, any>;

/** A session's envelope as its version's schema accepted it: everything but trials, summary and server fields. */
export type SessionEnvelope = Omit<GameSession, 'trials' | 'summary' | 'result' | 'processing'>;

/** The trusted values a valid or flagged result stores. */
export type StoredScoredValues = {
  readonly score: number;
  readonly accuracy: number | null;
  readonly responseTime: ScoredResult<object>['responseTime'];
  readonly peakLevel: number;
  readonly metrics: Readonly<Record<string, unknown>>;
};

export type ModuleEvaluation =
  | {
    /** The session fails the version's schemas. */
    readonly ok: false;
    readonly issues: readonly z.core.$ZodIssue[];
  }
  | {
    readonly ok: true;
    readonly session: SessionEnvelope;
    /** Rescored from the trials by the version's pure score(). */
    readonly scored: ScoredResult<Record<string, unknown>>;
    /** The worst outcome of the version's own checks. */
    readonly outcome: 'valid' | 'flagged' | 'invalid';
    /** The version's own reason codes, each once, in its canonical order. */
    readonly reasons: readonly string[];
  };

export interface GameVersionModule {
  readonly gameId: string;
  readonly gameVersion: number;
  readonly definition: AnyGameDefinition;
  /** The frozen outcome of every reason code this version's checks report. */
  readonly reasonOutcomes: Readonly<Record<string, ReasonOutcome>>;
  /**
   * Validates a client-written session of exactly this version (server fields
   * removed), rescores it from its trials and runs the version's plausibility
   * checks. Pure and deterministic.
   */
  evaluate(clientSession: unknown): ModuleEvaluation;
  /**
   * The record values a stored flagged or valid result of this version
   * competes with, computed from its stored trusted values (never by
   * rescoring). Null when the stored metrics are not this version's.
   */
  recordValuesFromStored(stored: StoredScoredValues): Record<string, number> | null;
}

export type GameVersionCheck<Trial, Metrics extends object> = (
  session: TrustedGameSessionOf<Trial, Metrics>,
  context: {
    readonly scored: ScoredResult<Metrics>;
    /** The display summary, when the version's own summary schema accepts it; null otherwise. */
    readonly summary: z.infer<ReturnType<typeof sessionSummarySchemaFor<Trial, Metrics>>> | null;
  },
) => { readonly outcome: 'valid' | 'flagged' | 'invalid'; readonly reasons: readonly string[] };

/**
 * Builds a registry module from a game version's frozen definition, reason
 * table and checks. The session schema is `trustedGameSessionSchemaFor`: the
 * version's trial schema, with the display summary checked only for the
 * structure the rules enforce.
 */
export function defineGameVersionModule<Trial, Metrics extends object>(spec: {
  readonly definition: GameDefinition<Trial, Metrics>;
  readonly reasonOutcomes: Readonly<Record<string, ReasonOutcome>>;
  readonly check: GameVersionCheck<Trial, Metrics>;
}): GameVersionModule {
  const { definition, reasonOutcomes, check } = spec;
  const collisions = Object.keys(reasonOutcomes).filter((code) => Object.hasOwn(SERVER_REASON_OUTCOMES, code));
  if (collisions.length > 0) {
    throw new Error(`${definition.id} v${definition.gameVersion} reuses trusted scoring's reason codes: ${collisions.join(', ')}`);
  }
  const sessionSchema = trustedGameSessionSchemaFor(definition);
  const summarySchema = sessionSummarySchemaFor(definition);

  return Object.freeze({
    gameId: definition.id,
    gameVersion: definition.gameVersion,
    definition,
    reasonOutcomes,
    evaluate(clientSession: unknown): ModuleEvaluation {
      const parsed = sessionSchema.safeParse(clientSession);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues };
      const session = parsed.data;
      const scored = definition.score(session.trials, { modeId: session.modeId, startLevel: session.startLevel });
      const summary = summarySchema.safeParse(session.summary);
      const report = check(session, { scored, summary: summary.success ? summary.data : null });
      for (const code of report.reasons) {
        if (!Object.hasOwn(reasonOutcomes, code)) {
          throw new Error(`${definition.id} v${definition.gameVersion} reported an unregistered reason '${code}'`);
        }
      }
      const { trials: _trials, summary: _summary, result: _result, processing: _processing, ...envelope } = session;
      return {
        ok: true,
        session: envelope,
        scored: scored as ScoredResult<Record<string, unknown>>,
        outcome: report.outcome,
        reasons: report.reasons,
      };
    },
    recordValuesFromStored(stored: StoredScoredValues): Record<string, number> | null {
      const metrics = definition.metricsSchema.safeParse(stored.metrics);
      if (!metrics.success) return null;
      return recordValuesFor(definition, { ...stored, metrics: metrics.data });
    },
  });
}

export interface GameModuleRegistry {
  readonly modules: readonly GameVersionModule[];
  /** The module of exactly this game version, if this build has one. */
  find(gameId: string, gameVersion: number): GameVersionModule | undefined;
  /** The newest registered version of the game: the definition progress is maintained with. */
  current(gameId: string): GameVersionModule | undefined;
}

/** A registry over the given modules; each (gameId, gameVersion) at most once. */
export function createGameModuleRegistry(modules: readonly GameVersionModule[]): GameModuleRegistry {
  const byKey = new Map<string, GameVersionModule>();
  for (const module of modules) {
    const key = `${module.gameId}@${module.gameVersion}`;
    if (byKey.has(key)) throw new Error(`Game module ${key} is registered twice`);
    byKey.set(key, module);
  }
  return Object.freeze({
    modules: Object.freeze([...modules]),
    find: (gameId: string, gameVersion: number) => byKey.get(`${gameId}@${gameVersion}`),
    current: (gameId: string) => modules
      .filter((module) => module.gameId === gameId)
      .reduce<GameVersionModule | undefined>((newest, module) => (
        newest === undefined || module.gameVersion > newest.gameVersion ? module : newest
      ), undefined),
  });
}

/** The outcome of a reason code on a result of `module`'s version: the version's own codes, then trusted scoring's. */
export function reasonOutcomeFor(module: GameVersionModule, code: string): ReasonOutcome | undefined {
  if (Object.hasOwn(module.reasonOutcomes, code)) return module.reasonOutcomes[code];
  if (Object.hasOwn(SERVER_REASON_OUTCOMES, code)) return SERVER_REASON_OUTCOMES[code as keyof typeof SERVER_REASON_OUTCOMES];
  return undefined;
}
