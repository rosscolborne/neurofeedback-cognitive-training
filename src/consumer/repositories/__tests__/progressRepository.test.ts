import { deleteApp, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressRepository, ProgressReadError } from '../progressRepository';

// Which read failed, offline: the two listeners are replaced, so no request
// is made. The emulator suite (tests/consumer-repositories) covers the reads
// themselves; real Firestore alone enforces composite indexes.

type Listener = { next: (snapshot: unknown) => void; error: (error: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> };
const listeners: Listener[] = [];

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  onSnapshot: vi.fn((_target: unknown, _options: unknown, next: Listener['next'], error: Listener['error']) => {
    const unsubscribe = vi.fn();
    listeners.push({ next, error, unsubscribe });
    return unsubscribe;
  }),
  onSnapshotsInSync: vi.fn(() => () => {}),
}));

const app = initializeApp({ projectId: 'demo-nfct-unit', apiKey: 'demo-nfct-unit-key' }, 'progress-read-errors');
const repository = createProgressRepository({ firestore: getFirestore(app), auth: { currentUser: { uid: 'player-1' } } });
afterAll(() => deleteApp(app));
beforeEach(() => { listeners.length = 0; });

/** Shaped like the SDK's FirestoreError, whose constructor is not public. */
const firestoreError = (code: string, message: string) => Object.assign(new Error(message), { name: 'FirebaseError', code });

function subscribe() {
  const errors: Error[] = [];
  repository.subscribeToProgressWithRecentSessions('mental-math', {}, () => { throw new Error('no state expected'); }, (error) => errors.push(error));
  // Subscribed in this order: the progress document, then the recent sessions.
  const [progressListener, sessionsListener] = listeners;
  if (!progressListener || !sessionsListener) throw new Error('expected two listeners');
  return { errors, progressListener, sessionsListener };
}

describe('subscribeToProgressWithRecentSessions failures', () => {
  it('names the recent-sessions read and keeps the Firestore code, for a missing or building index', () => {
    const { errors, progressListener, sessionsListener } = subscribe();
    const indexBuilding = firestoreError('failed-precondition', 'The query requires an index. That index is currently building and cannot be used yet.');
    sessionsListener.error(indexBuilding);

    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error).toBeInstanceOf(ProgressReadError);
    expect(error).toMatchObject({ read: 'recent sessions', code: 'failed-precondition', message: indexBuilding.message, cause: indexBuilding });
    // A failed read stops both listeners; the other one's later error is not reported again.
    expect(progressListener.unsubscribe).toHaveBeenCalled();
    expect(sessionsListener.unsubscribe).toHaveBeenCalled();
    progressListener.error(firestoreError('permission-denied', 'Missing or insufficient permissions.'));
    expect(errors).toHaveLength(1);
  });

  it('names the progress read when the progress document fails', () => {
    const { errors, progressListener } = subscribe();
    progressListener.error(firestoreError('permission-denied', 'Missing or insufficient permissions.'));
    expect(errors).toEqual([expect.objectContaining({ read: 'progress', code: 'permission-denied', message: 'Missing or insufficient permissions.' })]);
  });

  it('keeps a non-Firestore failure, with no code', () => {
    const { errors, sessionsListener } = subscribe();
    sessionsListener.error('socket closed');
    expect(errors).toEqual([expect.objectContaining({ read: 'recent sessions', code: undefined, message: 'socket closed' })]);
  });
});
