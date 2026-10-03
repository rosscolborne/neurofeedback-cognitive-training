import {
  GAME_MODULE_REGISTRY,
  maxLevelOf,
  unlockedStartLevel,
  upgradeBlocker,
  type GameModeDefinition,
  type GameProgress,
  type ScoredResult,
  type ServerResult,
  type SessionProgressFields,
} from '@nfct/shared';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';
import { currentProgress, previewDecision, previewMode, type ClientSessionDocument, type PreviewGame } from './startLevel';

// The post-session summary (NFCT-22), as a pure view model shared by every
// game. The score, the personal best and the unlocks come from trusted
// scoring's `result` on the session once it arrives. Until then they are a
// provisional preview: the same shared evaluateSession and decideSession run
// on this device against the cached progress and the other pending sessions,
// and the screen says the values are provisional. Each game adds its own run
// statistics on top. Nothing here reads or reports anything about EEG.

/** Where the run's save stands, as the screen reports it. */
export type SaveStatus = 'saving' | 'queued' | 'confirmed' | 'failed';

export type Verification =
  /** No trusted result yet; the values are this device's preview. */
  | { readonly kind: 'provisional'; readonly detail: 'saving' | 'on-device' | 'checking' | 'delayed' }
  | { readonly kind: 'verified' }
  /**
   * Counts in totals, not in records or unlocks. `upgradable`: a finished run
   * whose only flag is its locked start level, so trusted scoring makes it
   * valid, with its records and unlocks, once that level is unlocked (ADR-001
   * decision 12's upgrade).
   */
  | { readonly kind: 'flagged'; readonly reasons: readonly string[]; readonly upgradable: boolean }
  /** Counts nowhere. */
  | { readonly kind: 'invalid'; readonly reasons: readonly string[] }
  | { readonly kind: 'not-saved' };

export type RecordLine<Metric extends string = string> =
  /** The player's records are not loaded yet. */
  | { readonly kind: 'loading' }
  /** The records cannot be previewed (for example progress from a newer app version); the result decides. */
  | { readonly kind: 'pending'; readonly startLevel: number }
  | { readonly kind: 'new-best'; readonly startLevel: number; readonly metrics: readonly Metric[] }
  | { readonly kind: 'best-so-far'; readonly startLevel: number; readonly bestScore: number | null }
  | { readonly kind: 'ineligible'; readonly startLevel: number; readonly reason: 'abandoned' | 'invalid' | 'not-saved'; readonly bestScore: number | null }
  /** `upgradable`: a finished run flagged only for its locked start level, so it can still set a record once that level unlocks. */
  | { readonly kind: 'ineligible'; readonly startLevel: number; readonly reason: 'flagged'; readonly bestScore: number | null; readonly upgradable: boolean };

export type UnlockLine =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unlocked'; readonly levels: readonly number[] }
  /** Reaching `reachLevel` in a valid completed run unlocks start levels up to `nextLevel`. */
  | { readonly kind: 'next'; readonly unlocked: number; readonly nextLevel: number; readonly reachLevel: number }
  | { readonly kind: 'all'; readonly maxLevel: number };

export interface Totals {
  readonly sessionsCompleted: number;
  readonly activeMs: number;
}

export interface RunIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly seed: number;
}

/** The start level reaching `peak` would unlock, from the mode's own policy through the shared clamp. */
function unlockedWithPeak(mode: GameModeDefinition, peak: number): number {
  return unlockedStartLevel(mode, { bestPeakLevel: { [mode.id]: peak } });
}

/** What unlocks next in `mode`, from progress: the lowest peak level that raises the unlocked start level. */
export function nextUnlock(mode: GameModeDefinition, progress: Pick<GameProgress, 'bestPeakLevel'> | null): UnlockLine {
  const maxLevel = maxLevelOf(mode);
  const unlocked = unlockedStartLevel(mode, progress);
  if (unlocked >= maxLevel) return { kind: 'all', maxLevel };
  for (let peak = 1; peak <= maxLevel; peak += 1) {
    const reached = unlockedWithPeak(mode, peak);
    if (reached > unlocked) return { kind: 'next', unlocked, nextLevel: reached, reachLevel: peak };
  }
  return { kind: 'all', maxLevel };
}

/** This record class's bests, in the current game version's record set. */
export function bestsFor(game: PreviewGame, progress: GameProgress | null, startLevel: number): Partial<Record<string, { value: number; sessionId: string }>> {
  const { definition } = game;
  if (progress === null || progress.gameVersion !== definition.gameVersion) return {};
  return progress.bests[definition.recordKey({ modeId: game.modeId, startLevel })] ?? {};
}

/** A flagged run that the start-level upgrade can still make valid: its only flag is `start-level-locked`. */
function upgradableLater(session: SessionProgressFields, progress: GameProgress | null): boolean {
  const blocker = upgradeBlocker(session, progress, GAME_MODULE_REGISTRY);
  return blocker === null || blocker === 'still-locked';
}

export interface RunSummaryCoreInput<Metrics extends object> {
  readonly status: 'completed' | 'abandoned';
  readonly startLevel: number;
  /** The shared scoring of the run on this device. */
  readonly local: ScoredResult<Metrics>;
  /** The session exactly as this device writes it, built only when a preview needs it. */
  readonly document: () => ClientSessionDocument;
  readonly run: RunIdentity;
  readonly save: SaveStatus;
  /** The game's cached progress and recent sessions, or null until they load (or when they cannot be read). */
  readonly state: ProgressWithRecentSessions | null;
}

export interface RunSummaryCore<Metrics extends object> {
  readonly verification: Verification;
  /** The run's metrics: trusted once the result arrives (null when it holds another version's metrics), local until then. */
  readonly metrics: Metrics | null;
  /** Trusted scoring found the run invalid: it has no score. */
  readonly invalid: boolean;
  /** Null when the run does not count (trusted scoring found it invalid). */
  readonly score: number | null;
  readonly accuracy: number | null;
  readonly peakLevel: number;
  readonly record: RecordLine;
  readonly unlock: UnlockLine;
  /** Per-game totals; null until progress is loaded. */
  readonly totals: Totals | null;
}

/**
 * What every game's summary says about a run: its verification, score,
 * record line, unlocks and the game's totals. `game.definition.metricsSchema`
 * reads the trusted metrics; `recordMetrics` are the metrics a new best lists,
 * in display order.
 */
export function runSummaryCore<Metrics extends object>(
  game: PreviewGame & { readonly recordMetrics: readonly string[] },
  { status, startLevel, local, document, run, save, state }: RunSummaryCoreInput<Metrics>,
): RunSummaryCore<Metrics> {
  const mode = previewMode(game);
  const stored = state?.recentSessions.find((record) => record.id === run.sessionId) ?? null;
  const trusted = save === 'failed' ? undefined : stored?.session.result;

  // Progress without this run: the cached progress plus the other runs still pending on this device.
  const base = state === null ? null : currentProgress(game, state, run.sessionId);
  let shown: ServerResult | null = null;
  let after: GameProgress | null = base?.progress ?? null;
  /** The session with the result shown, as the upgrade would judge it. */
  let judged: SessionProgressFields | null = null;
  if (trusted) {
    // Trusted scoring wrote the result and progress in one commit, which the cached progress already holds.
    shown = trusted;
    judged = stored!.session;
  } else if (base !== null && save !== 'failed') {
    const client = document();
    const decision = previewDecision(game, base.progress, run.sessionId, client);
    shown = decision?.result ?? null;
    after = decision?.progress ?? after;
    // The client document holds every field the upgrade reads (game, version, mode, start level).
    if (decision) judged = { ...client, result: decision.result } as unknown as SessionProgressFields;
  }
  // Only a finished run gains records or unlocks when upgraded (applyValidEffects skips the rest).
  const upgradable = shown?.validity === 'flagged' && status === 'completed' && judged !== null && upgradableLater(judged, after);

  const verification: Verification = save === 'failed' ? { kind: 'not-saved' }
    : trusted?.validity === 'valid' ? { kind: 'verified' }
      : trusted?.validity === 'flagged' ? { kind: 'flagged', reasons: trusted.reasons, upgradable }
        : trusted?.validity === 'invalid' ? { kind: 'invalid', reasons: trusted.reasons }
          : {
            kind: 'provisional',
            detail: save === 'saving' ? 'saving'
              : save === 'queued' ? 'on-device'
                : stored?.session.processing ? 'delayed' : 'checking',
          };

  // What the run earned: the trusted values once they arrive. Until then the
  // shared scoring on this device, which is what the preview decided with.
  const trustedMetrics = (result: ServerResult): Metrics | null => {
    if (result.validity === 'invalid') return null;
    const parsed = game.definition.metricsSchema.safeParse(result.metrics);
    return parsed.success ? parsed.data as Metrics : null;
  };
  const metrics = trusted ? trustedMetrics(trusted) : local.metrics;
  const scoredResult = trusted && trusted.validity !== 'invalid' ? trusted : null;
  const invalid = trusted?.validity === 'invalid';

  const bests = bestsFor(game, after, startLevel);
  const bestScore = bests.score?.value ?? null;
  let record: RecordLine;
  if (save === 'failed') record = { kind: 'ineligible', startLevel, reason: 'not-saved', bestScore };
  else if (state === null) record = { kind: 'loading' };
  else if (shown === null) record = { kind: 'pending', startLevel };
  else if (shown.validity === 'invalid') record = { kind: 'ineligible', startLevel, reason: 'invalid', bestScore };
  else if (shown.validity === 'flagged') record = { kind: 'ineligible', startLevel, reason: 'flagged', bestScore, upgradable };
  else if (status !== 'completed') record = { kind: 'ineligible', startLevel, reason: 'abandoned', bestScore };
  else if (shown.personalBest) {
    // Which records it set, as progress shows them now; the result's flag says it set at least one.
    const metricsHeld = game.recordMetrics.filter((metric) => bests[metric]?.sessionId === run.sessionId);
    record = { kind: 'new-best', startLevel, metrics: metricsHeld };
  } else record = { kind: 'best-so-far', startLevel, bestScore };

  const newlyUnlocked = shown?.validity === 'valid'
    ? shown.unlocked.filter((entry) => entry.modeId === game.modeId).map((entry) => entry.startLevel)
    : [];
  const unlock: UnlockLine = state === null ? { kind: 'loading' }
    : newlyUnlocked.length > 0 ? { kind: 'unlocked', levels: newlyUnlocked }
      : nextUnlock(mode, after);

  const totals: Totals | null = state === null ? null : {
    sessionsCompleted: after?.sessionsCompleted ?? 0,
    activeMs: after?.activeMs ?? 0,
  };

  return {
    verification,
    metrics,
    invalid,
    score: invalid ? null : scoredResult ? scoredResult.score : local.score,
    accuracy: scoredResult ? scoredResult.accuracy : local.accuracy,
    peakLevel: scoredResult ? scoredResult.peakLevel : local.peakLevel,
    record,
    unlock,
    totals,
  };
}
