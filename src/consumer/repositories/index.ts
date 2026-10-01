import { auth, db } from '../../services/firebase';
import type { ConsumerFirestoreContext } from '../firestore/context';
import { createEegRecordingRepository } from './eegRecordingRepository';
import { createGameSessionRepository } from './gameSessionRepository';
import { createProfileRepository } from './profileRepository';
import { createProgressRepository } from './progressRepository';

// The consumer repositories, bound to the app's Firestore (persistent offline
// cache) and Auth. UI code imports these; tests build their own with the
// create* factories and emulator instances.
//
// Consumer UI that uses them belongs under src/consumer/, where the import
// boundary test (src/__tests__/consumerImportBoundary.test.ts) keeps it away
// from the clinical model; UI elsewhere must add its root to CONSUMER_ROOTS.

const context: ConsumerFirestoreContext = { firestore: db, auth };

export const profileRepository = createProfileRepository(context);
export const eegRecordingRepository = createEegRecordingRepository(context);
export const gameSessionRepository = createGameSessionRepository(context);
export const progressRepository = createProgressRepository(context);

export { SignInRequiredError, InvalidDocumentIdError } from '../firestore/context';
export type { DocumentRead, SnapshotState, UnreadableDocument } from '../firestore/reads';
export { ConsumerWriteValidationError, type PendingWrite } from '../firestore/writes';
export type { ProfileRepository, UserProfileDraft, UserProfilePatch } from './profileRepository';
export {
  EegRecordingAlreadySavedError,
  type EegRecordingDraft,
  type EegRecordingRecord,
  type EegRecordingRefusalReason,
  type EegRecordingRepository,
  type EegRecordingSave,
  type EegRecordingServerOutcome,
  type EegRecordingsForSession,
  type EegRecordingSkipReason,
} from './eegRecordingRepository';
export {
  GameSessionAlreadySavedError,
  GameSessionOwnerChangedError,
  InvalidSessionSeedError,
  type GameSessionCursor,
  type GameSessionDraft,
  type GameSessionPage,
  type GameSessionRecord,
  type GameSessionRepository,
  type GameSessionRepositoryOptions,
  type ListGameSessionsOptions,
  type RecentGameSessions,
  type SavedGameSession,
  type SaveGameSessionInput,
  type StartedGameSession,
} from './gameSessionRepository';
export type { ProgressRepository, ProgressWithRecentSessions } from './progressRepository';
