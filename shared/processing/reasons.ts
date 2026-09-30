import { MAX_RESULT_REASONS, type SessionValidity } from '../schemas/gameSession';

// Trusted scoring's reason codes (NFCT-19), and how they merge with a game
// version's own codes into `result.reasons`.
//
// Every reason has one of three outcomes:
// - 'invalid': the session counts nowhere;
// - 'flagged': it counts in totals but sets no records or unlocks;
// - 'diagnostic': recorded on any result, including a valid one, and never
//   changes validity.
// A game version freezes the outcomes of its own codes (Mental Math v1:
// REASON_OUTCOMES). The codes below are trusted scoring's own, checked by the
// generic pipeline for every game. They must never collide with a game's
// codes (a registry test checks this).

export type ReasonOutcome = 'invalid' | 'flagged' | 'diagnostic';

export type ReasonEntry = {
  readonly code: string;
  readonly outcome: ReasonOutcome;
};

export const SERVER_REASON_OUTCOMES = Object.freeze({
  /** The session fails its game version's schemas (envelope, trials, mode, start level). */
  'schema-invalid': 'invalid',
  /** The session's `userId` is not the uid in its path. */
  'user-id-mismatch': 'invalid',
  /** The session's document ID is not a valid client-generated ID. */
  'session-id-invalid': 'invalid',
  /**
   * `startLevel` was above `unlockedStartLevel(mode, progress)` when the
   * session was processed. The one flag trusted scoring may later lift, when
   * progress unlocks the level (see `upgradeSession`).
   */
  'start-level-locked': 'flagged',
  /** Flagged start-level-locked when first processed, and upgraded to valid when a later-processed session unlocked the level. */
  'start-level-unlocked-later': 'diagnostic',
  /** The device's `endedAt` is more than CLOCK_TOLERANCES.deviceAheadMs after the server's `createdAt`. */
  'device-clock-ahead': 'diagnostic',
  /** The session reached the server more than CLOCK_TOLERANCES.lateUploadMs after it ended (offline play). */
  'late-upload': 'diagnostic',
  /** The device's wall-clock span (endedAt - startedAt) is shorter than the reported active time. */
  'wall-clock-short': 'diagnostic',
  /** `localDate` is more than one day from the date of `endedAt` in the session's `timezone`. */
  'local-date-mismatch': 'diagnostic',
  /** `timezone` is not a time zone this runtime knows, so `localDate` could not be checked. */
  'unknown-timezone': 'diagnostic',
  /** The reason list was cut to MAX_RESULT_REASONS; this marker takes the last slot. */
  'reasons-truncated': 'diagnostic',
} as const satisfies Record<string, ReasonOutcome>);

export type ServerReason = keyof typeof SERVER_REASON_OUTCOMES;

/** An entry for one of trusted scoring's own codes. */
export function serverReason(code: ServerReason): ReasonEntry {
  return { code, outcome: SERVER_REASON_OUTCOMES[code] };
}

/**
 * Why a session has `processing` metadata instead of a result
 * (`processing.reason`). Not result reasons: they say nothing about the
 * session's validity.
 */
export const PROCESSING_REASONS = Object.freeze({
  /** No frozen module for the session's `gameId`. */
  unknownGame: 'unknown-game',
  /** No frozen module for the session's `gameVersion`. */
  unknownGameVersion: 'unknown-game-version',
  /** The session's `schemaVersion` is one this build cannot read. */
  unsupportedSchemaVersion: 'unsupported-schema-version',
  /** The game's progress was written by newer code (schema, aggregate or game version); this build never overwrites it. */
  progressNewerThanCode: 'progress-newer-than-code',
  /** The game's progress document cannot be read and is not from newer code. */
  progressUnreadable: 'progress-unreadable',
  /** A processed session needed for a rebuild cannot be read. */
  sessionUnreadable: 'session-unreadable',
  /** Anything else: a bug or an infrastructure failure. */
  internalError: 'internal-error',
} as const);

export type ProcessingReason = (typeof PROCESSING_REASONS)[keyof typeof PROCESSING_REASONS];

const SEVERITY: Readonly<Record<ReasonOutcome, number>> = { invalid: 0, flagged: 1, diagnostic: 2 };

export type MergedReasons = {
  /** The worst outcome of every entry, before any truncation. */
  readonly validity: SessionValidity;
  /** At most MAX_RESULT_REASONS codes: most severe first, each once. */
  readonly reasons: string[];
};

/**
 * Merges reason entries into what `result.reasons` records, deterministically:
 *
 * - each code once (its first occurrence);
 * - ordered by severity (invalid, then flagged, then diagnostic) and, within a
 *   severity, in the order given (the game version's canonical order first,
 *   then trusted scoring's);
 * - at most MAX_RESULT_REASONS: a longer list keeps its most severe
 *   MAX_RESULT_REASONS - 1 codes and ends with 'reasons-truncated', so a
 *   result write can never fail validation and loop on retries.
 *
 * Validity is the worst outcome of all entries, computed before truncation.
 * Severity order means truncation only ever drops less severe codes, and
 * 'reasons-truncated' blocks the start-level upgrade (upgradeBlocker).
 */
export function mergeReasons(entries: readonly ReasonEntry[]): MergedReasons {
  const seen = new Set<string>();
  const unique: { entry: ReasonEntry; index: number }[] = [];
  for (const entry of entries) {
    if (seen.has(entry.code)) continue;
    seen.add(entry.code);
    unique.push({ entry, index: unique.length });
  }
  unique.sort((a, b) => SEVERITY[a.entry.outcome] - SEVERITY[b.entry.outcome] || a.index - b.index);
  const outcomes = new Set(unique.map(({ entry }) => entry.outcome));
  const validity: SessionValidity = outcomes.has('invalid') ? 'invalid' : outcomes.has('flagged') ? 'flagged' : 'valid';
  const codes = unique.map(({ entry }) => entry.code);
  const reasons = codes.length > MAX_RESULT_REASONS
    ? [...codes.slice(0, MAX_RESULT_REASONS - 1), 'reasons-truncated']
    : codes;
  return { validity, reasons };
}
