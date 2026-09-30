import { Timestamp } from 'firebase/firestore';
import { GAME_PROGRESS_SCHEMA_VERSION, PROGRESS_AGGREGATE_VERSION, mentalMath, type GameProgress, type GameSession } from '@nfct/shared';
import type { GameSessionRecord } from '../../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../../repositories/progressRepository';
import { FEEDBACK_MS, MentalMathRunController, type RunOutcome } from '../runController';
import { buildSessionDraft } from '../sessionDraft';
import { ManualClock } from './manualClock';

/** The expected answer of a rendered question, parsed back from its text and evaluated by the shared evaluator. */
export function answerOf(text: string): number {
  const tokens = text.replace(/[()]/g, '').split(' ');
  const value = mentalMath.evaluate({
    operands: tokens.filter((_, index) => index % 2 === 0).map(Number),
    operators: tokens.filter((_, index) => index % 2 === 1) as mentalMath.Operator[],
    grouped: text.startsWith('('),
  });
  if (value === null) throw new Error(`unexpected question ${text}`);
  return value;
}

/** Plays a whole run: the first `correct` answers right, the rest wrong, 900 ms each. */
export function playRun({ seed, startLevel, correct, wallStartMs }: { seed: number; startLevel: number; correct: number; wallStartMs?: number }): RunOutcome {
  const clock = new ManualClock(wallStartMs);
  let outcome: RunOutcome | null = null;
  const controller = new MentalMathRunController({ seed, startLevel, clock, onEnd: (ended) => { outcome = ended; } });
  controller.start();
  let answered = 0;
  while (outcome === null) {
    clock.advance(900);
    const { question, phase } = controller.getSnapshot();
    if (phase === 'question' && question) {
      const answer = answerOf(question.text);
      for (const digit of String(answered < correct ? answer : answer + 1)) controller.pressDigit(Number(digit));
      controller.submit(question.id);
      answered += 1;
    }
    clock.advance(FEEDBACK_MS);
  }
  return outcome;
}

export function sessionRecord(id: string, outcome: RunOutcome, { awaitingResult = true, seed }: { awaitingResult?: boolean; seed: number }): GameSessionRecord {
  const draft = buildSessionDraft(outcome, { timezone: 'UTC', appVersion: '0.0.0', platform: 'web' });
  const session = { ...draft, schemaVersion: 1, userId: 'player-1', seed, createdAt: Timestamp.fromMillis(outcome.endedAtMs) } as unknown as GameSession;
  return { id, session, awaitingResult, hasPendingWrites: awaitingResult };
}

export function progressWith(bestPeakLevel: number | null, overrides: Partial<GameProgress> = {}): GameProgress {
  const at = Timestamp.fromMillis(1_790_000_000_000);
  return {
    schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
    aggregateVersion: PROGRESS_AGGREGATE_VERSION,
    updatedAt: at,
    gameId: mentalMath.GAME_ID,
    gameVersion: mentalMath.GAME_VERSION,
    sessionsCompleted: bestPeakLevel === null ? 0 : 1,
    activeMs: 0,
    lastPlayedAt: at,
    bestPeakLevel: bestPeakLevel === null ? {} : { [mentalMath.MODE_ID]: bestPeakLevel },
    unlocked: {},
    bests: {},
    bestsArchive: {},
    ...overrides,
  };
}

export function pickerState(progress: GameProgress | null, recentSessions: GameSessionRecord[] = []): ProgressWithRecentSessions {
  return {
    progress: progress === null ? { status: 'missing', id: 'mental-math', fromCache: true, hasPendingWrites: false } : { status: 'readable', id: 'mental-math', data: progress, fromCache: true, hasPendingWrites: false },
    recentSessions,
    pendingSessions: recentSessions.filter((record) => record.awaitingResult),
    unreadableSessions: [],
    fromCache: true,
  } as ProgressWithRecentSessions;
}
