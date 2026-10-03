import { Timestamp } from 'firebase/firestore';
import {
  GAME_MODULE_REGISTRY,
  GAME_SESSION_SCHEMA_VERSION,
  maxLevelOf,
  mentalMath,
  unlockedStartLevel,
  upgradeBlocker,
  type GameModeDefinition,
  type GameProgress,
  type ServerResult,
  type SessionProgressFields,
} from '@nfct/shared';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';
import type { RunOutcome } from './runController';
import { buildSessionDraft, type SessionEnvironment } from './sessionDraft';
import { currentProgress, previewDecision, timed90, type ClientSessionDocument } from './startLevel';

// The post-session summary (NFCT-22), as a pure view model. The score, the
// personal best and the unlocks come from trusted scoring's `result` on the
// session once it arrives. Until then they are a provisional preview: the same
// shared evaluateSession and decideSession run on this device against the
// cached progress and the other pending sessions, and the screen says the
// values are provisional. Nothing here reads or reports anything about EEG.

const { definition } = mentalMath;

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

export type RecordMetric = 'score' | 'correct' | 'peakLevel';

export type RecordLine =
  /** The player's records are not loaded yet. */
  | { readonly kind: 'loading' }
  /** The records cannot be previewed (for example progress from a newer app version); the result decides. */
  | { readonly kind: 'pending'; readonly startLevel: number }
  | { readonly kind: 'new-best'; readonly startLevel: number; readonly metrics: readonly RecordMetric[] }
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

export interface RunStats {
  readonly correct: number;
  readonly attempted: number;
  readonly accuracy: number | null;
  readonly peakLevel: number;
  readonly longestStreak: number;
}

export interface Totals {
  readonly sessionsCompleted: number;
  readonly activeMs: number;
}

export interface RunSummaryModel {
  readonly status: RunOutcome['status'];
  readonly startLevel: number;
  readonly verification: Verification;
  /** Null when the run does not count (trusted scoring found it invalid). */
  readonly score: number | null;
  /** How the score adds up: difficulty points plus speed bonus. */
  readonly breakdown: { readonly difficultyPoints: number; readonly speedBonusPoints: number } | null;
  readonly stats: RunStats;
  readonly record: RecordLine;
  readonly unlock: UnlockLine;
  /** Per-game totals; null until progress is loaded. */
  readonly totals: Totals | null;
}

export interface RunIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly seed: number;
}

/** The session exactly as this device writes it, with the server clock estimated as the run's end. */
export function clientSessionDocument(outcome: RunOutcome, environment: SessionEnvironment, run: RunIdentity): ClientSessionDocument {
  return {
    ...buildSessionDraft(outcome, environment),
    schemaVersion: GAME_SESSION_SCHEMA_VERSION,
    userId: run.userId,
    seed: run.seed,
    createdAt: Timestamp.fromMillis(outcome.endedAtMs),
  };
}

/** Trusted metrics as Mental Math v1 defines them, or null when they are not (another version's result). */
function metricsOf(result: ServerResult): mentalMath.MentalMathMetrics | null {
  if (result.validity === 'invalid') return null;
  const parsed = mentalMath.metricsSchema.safeParse(result.metrics);
  return parsed.success ? parsed.data : null;
}

/** The start level reaching `peak` would unlock, from the mode's own policy through the shared clamp. */
function unlockedWithPeak(mode: GameModeDefinition, peak: number): number {
  return unlockedStartLevel(mode, { bestPeakLevel: { [mode.id]: peak } });
}

/** What unlocks next, from progress: the lowest peak level that raises the unlocked start level. */
export function nextUnlock(progress: Pick<GameProgress, 'bestPeakLevel'> | null): UnlockLine {
  const mode = timed90();
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
export function bestsFor(progress: GameProgress | null, startLevel: number): Partial<Record<RecordMetric, { value: number; sessionId: string }>> {
  if (progress === null || progress.gameVersion !== definition.gameVersion) return {};
  return progress.bests[definition.recordKey({ modeId: mentalMath.MODE_ID, startLevel })] ?? {};
}

const RECORD_METRICS: readonly RecordMetric[] = ['score', 'correct', 'peakLevel'];

/** A flagged run that the start-level upgrade can still make valid: its only flag is `start-level-locked`. */
function upgradableLater(session: SessionProgressFields, progress: GameProgress | null): boolean {
  const blocker = upgradeBlocker(session, progress, GAME_MODULE_REGISTRY);
  return blocker === null || blocker === 'still-locked';
}

export interface RunSummaryInput {
  readonly outcome: RunOutcome;
  readonly environment: SessionEnvironment;
  readonly run: RunIdentity;
  readonly save: SaveStatus;
  /** The game's cached progress and recent sessions, or null until they load (or when they cannot be read). */
  readonly state: ProgressWithRecentSessions | null;
}

export function runSummary({ outcome, environment, run, save, state }: RunSummaryInput): RunSummaryModel {
  const { startLevel } = outcome.run;
  const ctx = { modeId: mentalMath.MODE_ID, startLevel };
  const local = mentalMath.score(outcome.run.trials, ctx);
  const stored = state?.recentSessions.find((record) => record.id === run.sessionId) ?? null;
  const trusted = save === 'failed' ? undefined : stored?.session.result;

  // Progress without this run: the cached progress plus the other runs still pending on this device.
  const base = state === null ? null : currentProgress(state, run.sessionId);
  let shown: ServerResult | null = null;
  let after: GameProgress | null = base?.progress ?? null;
  /** The session with the result shown, as the upgrade would judge it. */
  let judged: SessionProgressFields | null = null;
  if (trusted) {
    // Trusted scoring wrote the result and progress in one commit, which the cached progress already holds.
    shown = trusted;
    judged = stored!.session;
  } else if (base !== null && save !== 'failed') {
    const document = clientSessionDocument(outcome, environment, run);
    const decision = previewDecision(base.progress, run.sessionId, document);
    shown = decision?.result ?? null;
    after = decision?.progress ?? after;
    // The client document holds every field the upgrade reads (game, version, mode, start level).
    if (decision) judged = { ...document, result: decision.result } as unknown as SessionProgressFields;
  }
  // Only a finished run gains records or unlocks when upgraded (applyValidEffects skips the rest).
  const upgradable = shown?.validity === 'flagged' && outcome.status === 'completed' && judged !== null && upgradableLater(judged, after);

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
  const metrics = trusted ? metricsOf(trusted) : local.metrics;
  const scoredResult = trusted && trusted.validity !== 'invalid' ? trusted : null;
  const invalid = trusted?.validity === 'invalid';
  const score = invalid ? null : scoredResult ? scoredResult.score : local.score;
  const breakdown = invalid || metrics === null ? null : { difficultyPoints: metrics.difficultyPoints, speedBonusPoints: metrics.speedBonusPoints };
  const stats: RunStats = {
    correct: metrics?.correct ?? local.metrics.correct,
    attempted: metrics?.attempted ?? local.metrics.attempted,
    accuracy: scoredResult ? scoredResult.accuracy : local.accuracy,
    peakLevel: scoredResult ? scoredResult.peakLevel : local.peakLevel,
    longestStreak: metrics?.longestStreak ?? local.metrics.longestStreak,
  };

  const bests = bestsFor(after, startLevel);
  const bestScore = bests.score?.value ?? null;
  let record: RecordLine;
  if (save === 'failed') record = { kind: 'ineligible', startLevel, reason: 'not-saved', bestScore };
  else if (state === null) record = { kind: 'loading' };
  else if (shown === null) record = { kind: 'pending', startLevel };
  else if (shown.validity === 'invalid') record = { kind: 'ineligible', startLevel, reason: 'invalid', bestScore };
  else if (shown.validity === 'flagged') record = { kind: 'ineligible', startLevel, reason: 'flagged', bestScore, upgradable };
  else if (outcome.status !== 'completed') record = { kind: 'ineligible', startLevel, reason: 'abandoned', bestScore };
  else if (shown.personalBest) {
    // Which records it set, as progress shows them now; the result's flag says it set at least one.
    const metricsHeld = RECORD_METRICS.filter((metric) => bests[metric]?.sessionId === run.sessionId);
    record = { kind: 'new-best', startLevel, metrics: metricsHeld };
  } else record = { kind: 'best-so-far', startLevel, bestScore };

  const newlyUnlocked = shown?.validity === 'valid'
    ? shown.unlocked.filter((entry) => entry.modeId === mentalMath.MODE_ID).map((entry) => entry.startLevel)
    : [];
  const unlock: UnlockLine = state === null ? { kind: 'loading' }
    : newlyUnlocked.length > 0 ? { kind: 'unlocked', levels: newlyUnlocked }
      : nextUnlock(after);

  const totals: Totals | null = state === null ? null : {
    sessionsCompleted: after?.sessionsCompleted ?? 0,
    activeMs: after?.activeMs ?? 0,
  };

  return { status: outcome.status, startLevel, verification, score, breakdown, stats, record, unlock, totals };
}
