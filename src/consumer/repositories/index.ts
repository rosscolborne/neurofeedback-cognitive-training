import { auth, db } from '../../services/firebase';
import type { ConsumerFirestoreContext } from '../firestore/context';
import { createEegRecordingRepository } from './eegRecordingRepository';
import { createGameSessionRepository } from './gameSessionRepository';
import { createProfileRepository } from './profileRepository';
import { createProgressRepository } from './progressRepository';

// The consumer repositories, bound to the app's Firestore (persistent offline
// cache) and Auth. UI code imports these; tests build their own with the
// create* factories and emulator instances.

const context: ConsumerFirestoreContext = { firestore: db, auth };

export const profileRepository = createProfileRepository(context);
export const eegRecordingRepository = createEegRecordingRepository(context);
export const gameSessionRepository = createGameSessionRepository(context, eegRecordingRepository);
export const progressRepository = createProgressRepository(context);

export { SignInRequiredError, InvalidDocumentIdError } from '../firestore/context';
export type { DocumentRead, SnapshotState, UnreadableDocument } from '../firestore/reads';
export { ConsumerWriteValidationError, type PendingWrite } from '../firestore/writes';
export type { ProfileRepository, UserProfileDraft, UserProfilePatch } from './profileRepository';
export type {
  EegRecordingDraft,
  EegRecordingRecord,
  EegRecordingRepository,
  EegRecordingsForSession,
  EegRecordingSkipReason,
} from './eegRecordingRepository';
export {
  GameSessionAlreadySavedError,
  GameSessionOwnerChangedError,
  type EegRecordingOutcome,
  type GameSessionCursor,
  type GameSessionDraft,
  type GameSessionPage,
  type GameSessionRecord,
  type GameSessionRepository,
  type ListGameSessionsOptions,
  type RecentGameSessions,
  type SavedGameSession,
  type SaveGameSessionInput,
  type StartedGameSession,
} from './gameSessionRepository';
export type { ProgressRepository, ProgressWithRecentSessions } from './progressRepository';
