import { mentalMath, type Decision, type GameModeDefinition, type GameProgress } from '@nfct/shared';
import type { GameSessionRecord } from '../../repositories/gameSessionRepository';
import type { ProgressWithRecentSessions } from '../../repositories/progressRepository';
import * as preview from '../common/startLevel';
import type { ClientSessionDocument, CurrentProgress, PreviewGame, StartLevelChoices } from '../common/startLevel';

// Mental Math's client preview of trusted scoring: the games' common preview
// (common/startLevel.ts) bound to the current Mental Math definition and its
// one mode.

export type { ClientSessionDocument, CurrentProgress, StartLevelChoices } from '../common/startLevel';
export { defaultStartLevel } from '../common/startLevel';

const game: PreviewGame = { definition: mentalMath.definition, modeId: mentalMath.MODE_ID };

/** Mental Math's one mode. */
export function timed90(): GameModeDefinition {
  return preview.previewMode(game);
}

export function previewDecision(progress: GameProgress | null, sessionId: string, session: ClientSessionDocument): Decision | null {
  return preview.previewDecision(game, progress, sessionId, session);
}

export function previewProgress(progress: GameProgress | null, pending: readonly GameSessionRecord[]): GameProgress | null {
  return preview.previewProgress(game, progress, pending);
}

export function currentProgress(state: ProgressWithRecentSessions, exceptSessionId: string | null = null): CurrentProgress {
  return preview.currentProgress(game, state, exceptSessionId);
}

export function startLevelChoices(state: ProgressWithRecentSessions | null): StartLevelChoices {
  return preview.startLevelChoices(game, state);
}
