import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineGame, GAME_SESSION_SCHEMA_VERSION, sessionSeedSchema } from '@nfct/shared';
import { SignInRequiredError } from '../../src/consumer/firestore/context';
import { ConsumerWriteValidationError } from '../../src/consumer/firestore/writes';
import {
  GameSessionAlreadySavedError,
  GameSessionOwnerChangedError,
  type GameSessionRecord,
} from '../../src/consumer/repositories/gameSessionRepository';
import {
  closeDevices,
  closeEnvironment,
  eegDraft,
  eventually,
  expectDenied,
  minutesAgo,
  rawClientWrite,
  resetEmulators,
  serverRead,
  serverWrite,
  sessionDocument,
  sessionDraft,
  signedInDevice,
  testGame,
  testTrialSchema,
  timestampAt,
  type TestTrial,
  trustedResult,
  withProfile,
} from './harness';

const SESSION_KEYS = [
  'activeDurationMs', 'client', 'createdAt', 'endedAt', 'gameId', 'gameVersion', 'localDate', 'modeId', 'peakLevel',
  'schemaVersion', 'seed', 'startLevel', 'startedAt', 'status', 'summary', 'timezone', 'trials', 'userId',
];

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

describe('starting a game', () => {
  it('generates the session ID on the device before anything is written', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();

    expect(started.sessionId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(started.userId).toBe(device.player.uid);
    expect(sessionSeedSchema.safeParse(started.seed).success).toBe(true);
    const next = device.sessions.startGameSession();
    expect(next.sessionId).not.toBe(started.sessionId);
    expect(next.seed).not.toBe(started.seed);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();
  });

  it('needs a signed-in user', async () => {
    const device = await signedInDevice();
    await signOut(device.auth);

    expect(() => device.sessions.startGameSession()).toThrow(SignInRequiredError);
  });
});

describe('saving a finished session', () => {
  it('writes it once, under the signed-in user, with the server clock for createdAt', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    const draft = sessionDraft();
    const before = Date.now();

    const saved = await started.save({ definition: testGame, session: draft });
    await saved.acknowledged;

    expect(saved).toMatchObject({ sessionId: started.sessionId, eegRecording: { status: 'none' } });
    const stored = await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`);
    expect(Object.keys(stored ?? {}).sort()).toEqual(SESSION_KEYS);
    expect(stored).toMatchObject({
      schemaVersion: GAME_SESSION_SCHEMA_VERSION,
      userId: device.player.uid,
      seed: started.seed,
      gameId: 'mental-math',
      trials: draft.trials,
      summary: draft.summary,
    });
    expect(stored?.createdAt).toBeInstanceOf(Timestamp);
    expect(timestampAt(stored, 'createdAt').toMillis()).toBeGreaterThanOrEqual(before - 5_000);
    expect(timestampAt(stored, 'startedAt').isEqual(draft.startedAt as Timestamp)).toBe(true);

    const read = await device.sessions.getGameSession(started.sessionId);
    expect(read).toMatchObject({ status: 'readable', data: { id: started.sessionId, awaitingResult: true, hasPendingWrites: false } });
  });

  it('never saves a session twice: a second save is refused before it reaches the server', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;

    await expect(started.save({ definition: testGame, session: sessionDraft({ startLevel: 1, peakLevel: 3 }) }))
      .rejects.toThrow(GameSessionAlreadySavedError);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toMatchObject({ peakLevel: 2 });
  });

  it('refuses concurrent saves of one game, so only one batch is ever queued', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();

    const results = await Promise.allSettled([
      started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() }),
      started.save({ definition: testGame, session: sessionDraft() }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(GameSessionAlreadySavedError);
    await (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof started.save>>>).value.acknowledged;
  });

  it('the rules refuse the update a retried save would be, which is why the repository never retries', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    const draft = sessionDraft();
    await (await started.save({ definition: testGame, session: draft })).acknowledged;
    const path = `users/${device.player.uid}/gameSessions/${started.sessionId}`;
    // Exactly what the save sent: the same document with createdAt = serverTimestamp().
    const resend = { ...draft, schemaVersion: GAME_SESSION_SCHEMA_VERSION, userId: device.player.uid, seed: started.seed, createdAt: serverTimestamp() };

    await expectDenied(rawClientWrite(device, path, resend));
    // The same write to a new ID is a create, and is accepted: only the update is refused.
    await rawClientWrite(device, `users/${device.player.uid}/gameSessions/${device.sessions.startGameSession().sessionId}`, resend);
  });

  it('refuses the server-owned result and processing fields before writing, as the rules would', async () => {
    const device = await signedInDevice();
    for (const serverOwned of [{ result: trustedResult() }, { processing: { state: 'failed' } }]) {
      const started = device.sessions.startGameSession();
      const draft = { ...sessionDraft(), ...serverOwned } as ReturnType<typeof sessionDraft>;

      await expect(started.save({ definition: testGame, session: draft })).rejects.toThrow(ConsumerWriteValidationError);
      expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();

      // The same document without the server-owned field is accepted, so the field alone is what the rules refuse.
      const clientWrite = sessionDocument(device.player.uid, { createdAt: serverTimestamp() });
      await expectDenied(rawClientWrite(device, `users/${device.player.uid}/gameSessions/${device.sessions.startGameSession().sessionId}`, { ...clientWrite, ...serverOwned }));
      await rawClientWrite(device, `users/${device.player.uid}/gameSessions/${device.sessions.startGameSession().sessionId}`, clientWrite);
    }
  });

  it('never writes for another user: the owner comes from the signed-in user only', async () => {
    const owner = await signedInDevice('owner');
    const other = await signedInDevice('other');
    const started = owner.sessions.startGameSession();

    const forged = { ...sessionDraft(), userId: other.player.uid } as ReturnType<typeof sessionDraft>;
    const ownSeed = { ...sessionDraft(), seed: 7 } as ReturnType<typeof sessionDraft>;
    await expect(started.save({ definition: testGame, session: ownSeed })).rejects.toThrow(/seed: is set by the repository/);
    await expect(started.save({ definition: testGame, session: forged })).rejects.toThrow(ConsumerWriteValidationError);

    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;
    expect(await serverRead(`users/${owner.player.uid}/gameSessions/${started.sessionId}`)).toMatchObject({ userId: owner.player.uid });
    expect(await serverRead(`users/${other.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();

    // What the rules would do to a client that tried.
    const stored = await serverRead(`users/${owner.player.uid}/gameSessions/${started.sessionId}`);
    await expectDenied(rawClientWrite(owner, `users/${other.player.uid}/gameSessions/${owner.sessions.startGameSession().sessionId}`,
      { ...stored, userId: other.player.uid, createdAt: serverTimestamp() }));
    // And the other player's repository never sees it.
    expect((await other.sessions.listGameSessions()).sessions).toEqual([]);
    await expectDenied(getDocs(collection(other.firestore, 'users', owner.player.uid, 'gameSessions')));
  });

  it('refuses to save for a different user than the one who started the game', async () => {
    const device = await signedInDevice('first');
    const second = await signedInDevice('second');
    const started = device.sessions.startGameSession();
    await signOut(device.auth);

    await expect(started.save({ definition: testGame, session: sessionDraft() })).rejects.toThrow(SignInRequiredError);
    await signInWithEmailAndPassword(device.auth, second.player.email, second.player.password);
    await expect(started.save({ definition: testGame, session: sessionDraft() })).rejects.toThrow(GameSessionOwnerChangedError);
  });

  it("checks trials and metrics with the game's own schemas, and keeps the handle usable after a refusal", async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    const badTrial = { ...sessionDraft().trials[0]!, level: 11 };

    await expect(started.save({ definition: testGame, session: sessionDraft({ trials: [badTrial] }) }))
      .rejects.toThrow(/trials\.0\.level/);
    await expect(started.save({ definition: testGame, session: sessionDraft({ modeId: 'endless' }) }))
      .rejects.toThrow(/modeId/);
    await expect(started.save({ definition: testGame, session: sessionDraft({ startLevel: 3, peakLevel: 2 }) }))
      .rejects.toThrow(/peakLevel/);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();

    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
  });

  it('refuses a value set to undefined as a validation error, before anything is queued', async () => {
    const device = await signedInDevice();
    // A game whose trials have an optional field: the shared schema accepts it set to undefined.
    const withHint = defineGame({ ...testGame, trialSchema: testTrialSchema.extend({ hint: z.string().optional() }) });
    const started = device.sessions.startGameSession();
    const trials: (TestTrial & { hint?: string })[] = sessionDraft().trials.map((trial, index) => (index === 1 ? { ...trial, hint: undefined } : trial));

    const error = await started.save({ definition: withHint, session: sessionDraft({ trials }) }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConsumerWriteValidationError);
    expect((error as ConsumerWriteValidationError).issues.map((issue) => issue.path.join('.'))).toEqual(['trials.1.hint']);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeUndefined();
    const withoutHint = trials.map(({ hint: _hint, ...trial }) => trial);
    await (await started.save({ definition: withHint, session: sessionDraft({ trials: withoutHint }) })).acknowledged;
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
  });

  it('stores structural timestamps as Firestore timestamps, which the rules require', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    const endedAt = minutesAgo(1);
    const structural = (value: Timestamp) => ({ seconds: value.seconds, nanoseconds: value.nanoseconds, toMillis: () => value.toMillis() });

    await (await started.save({
      definition: testGame,
      session: sessionDraft({ startedAt: structural(minutesAgo(3)), endedAt: structural(endedAt) }),
    })).acknowledged;

    const stored = await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`);
    expect(stored?.endedAt).toBeInstanceOf(Timestamp);
    expect(timestampAt(stored, 'endedAt').isEqual(endedAt)).toBe(true);
  });
});

describe('saving with an optional EEG recording', () => {
  it('writes the session and its recording in one batch, linked only by the recording', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft({ source: 'simulated' }) });
    await saved.acknowledged;

    expect(saved.eegRecording.status).toBe('included');
    const recordingId = saved.eegRecording.status === 'included' ? saved.eegRecording.recordingId : '';
    const recording = await serverRead(`users/${device.player.uid}/eegRecordings/${recordingId}`);
    expect(recording).toMatchObject({ schemaVersion: 1, userId: device.player.uid, gameSessionId: started.sessionId, source: 'simulated' });
    expect(recording?.createdAt).toBeInstanceOf(Timestamp);
    // The session carries no EEG flag.
    const stored = await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`);
    expect(Object.keys(stored ?? {}).sort()).toEqual(SESSION_KEYS);
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(true);
  });

  it('writes measured recordings as measured', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft({ source: 'measured' }) });
    await saved.acknowledged;

    const { recordings } = await device.eeg.listForGameSession(started.sessionId);
    expect(recordings.map((record) => record.recording.source)).toEqual(['measured']);
  });

  it('still saves the session when EEG consent is missing, and says the recording was skipped', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
    await saved.acknowledged;

    expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'consent-required' });
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('treats a missing profile as no consent', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft() });
    await saved.acknowledged;

    expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'consent-required' });
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });

  it('skips a recording with no valid source, or any other schema problem, and still saves the session', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const invalid = [
      { ...eegDraft(), source: undefined },
      { ...eegDraft(), source: 'demo' },
      { ...eegDraft(), device: { ...eegDraft().device, model: 'simulated' } },
      { ...eegDraft(), valence: 0.4 },
      { ...eegDraft(), gameSessionId: 'another-session-000001' },
    ] as unknown as ReturnType<typeof eegDraft>[];

    for (const eegRecording of invalid) {
      const started = device.sessions.startGameSession();
      const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording });
      await saved.acknowledged;

      expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'invalid' });
      expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
      expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
    }
  });
});

describe('an EEG value set to undefined', () => {
  it('leaves only the recording out, and still saves the session', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const summary = { ...eegDraft().summary, relativeBandPower: { delta: 0.3, theta: undefined } };

    const saved = await started.save({ definition: testGame, session: sessionDraft(), eegRecording: eegDraft({ summary }) });
    await saved.acknowledged;

    expect(saved.eegRecording).toMatchObject({ status: 'skipped', reason: 'invalid' });
    expect(saved.eegRecording.status === 'skipped' && saved.eegRecording.message).toMatch(/summary\.relativeBandPower\.theta/);
    expect(await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`)).toBeDefined();
    expect(await device.eeg.hasEegRecording(started.sessionId)).toBe(false);
  });
});

describe('reading history', () => {
  async function saveSessions(device: Awaited<ReturnType<typeof signedInDevice>>, endedMinutesAgo: number[], gameOverrides = {}) {
    const ids: string[] = [];
    for (const minutes of endedMinutesAgo) {
      const started = device.sessions.startGameSession();
      await (await started.save({ definition: testGame, session: sessionDraft(gameOverrides, minutes) })).acknowledged;
      ids.push(started.sessionId);
    }
    return ids;
  }

  const ids = (records: GameSessionRecord[]) => records.map((record) => record.id);

  it('pages newest first by endedAt, with a cursor, until there are no more', async () => {
    const device = await signedInDevice();
    // Saved oldest first: ended 50, 40, 30, 20 and 10 minutes ago.
    const saved = await saveSessions(device, [50, 40, 30, 20, 10]);
    const newestFirst = [...saved].reverse();

    const first = await device.sessions.listGameSessions({ pageSize: 2 });
    const second = await device.sessions.listGameSessions({ pageSize: 2, cursor: first.nextCursor });
    const third = await device.sessions.listGameSessions({ pageSize: 2, cursor: second.nextCursor });

    expect(ids(first.sessions)).toEqual(newestFirst.slice(0, 2));
    expect(ids(second.sessions)).toEqual(newestFirst.slice(2, 4));
    expect(ids(third.sessions)).toEqual(newestFirst.slice(4));
    expect(third.nextCursor).toBeNull();
    expect(first.nextCursor).not.toBeNull();
    expect(first.unreadable).toEqual([]);
  });

  it('gives an exact last page no cursor', async () => {
    const device = await signedInDevice();
    await saveSessions(device, [20, 10]);

    const page = await device.sessions.listGameSessions({ pageSize: 2 });

    expect(page.sessions).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('orders sessions that ended at the same instant by document ID, without repeating or skipping one', async () => {
    const device = await signedInDevice();
    const endedAt = minutesAgo(5);
    const saved: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = device.sessions.startGameSession();
      await (await started.save({ definition: testGame, session: sessionDraft({ endedAt, startedAt: minutesAgo(8) }) })).acknowledged;
      saved.push(started.sessionId);
    }

    const seen: string[] = [];
    let cursor = null;
    do {
      const page: Awaited<ReturnType<typeof device.sessions.listGameSessions>> = await device.sessions.listGameSessions({ pageSize: 2, cursor });
      seen.push(...ids(page.sessions));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...saved].sort().reverse());
  });

  it("filters one game's history on the composite index shape (gameId, endedAt desc)", async () => {
    const device = await signedInDevice();
    const mentalMath = await saveSessions(device, [30, 10]);
    // Another game's sessions, as trusted setup writes them (the rules allow only Mental Math today).
    const otherId = 'other-game-session-0001';
    await serverWrite({
      [`users/${device.player.uid}/gameSessions/${otherId}`]: {
        ...sessionDocument(device.player.uid, { gameId: 'word-ladder' }, 20),
      },
    });

    const all = await device.sessions.listGameSessions();
    const game = await device.sessions.listGameSessions({ gameId: 'mental-math' });

    expect(ids(all.sessions)).toEqual([mentalMath[1], otherId, mentalMath[0]]);
    expect(ids(game.sessions)).toEqual([mentalMath[1], mentalMath[0]]);
    const { nextCursor } = await device.sessions.listGameSessions({ gameId: 'mental-math', pageSize: 1 });
    expect(nextCursor).not.toBeNull();
    await expect(device.sessions.listGameSessions({ gameId: 'word-ladder', cursor: nextCursor })).rejects.toThrow(/different list/);
    await expect(device.sessions.listGameSessions({ cursor: nextCursor })).rejects.toThrow(/different list/);
  });

  it('skips unreadable sessions, reports them, and pages past them from the raw last document', async () => {
    const device = await signedInDevice();
    const saved = await saveSessions(device, [50, 40, 10]);
    const uid = device.player.uid;
    // Ended 20 minutes ago: a newer schema this build cannot read.
    const unreadableId = 'unreadable-session-0001';
    // Ended 30 minutes ago: passes the rules' shape but not the reader (not a real calendar date).
    const badDateId = 'bad-date-session-000001';
    await serverWrite({
      [`users/${uid}/gameSessions/${unreadableId}`]: sessionDocument(uid, { schemaVersion: 99 }, 20),
      [`users/${uid}/gameSessions/${badDateId}`]: sessionDocument(uid, { localDate: '2026-02-30' }, 30),
    });

    const pages = [];
    let cursor = null;
    do {
      const page: Awaited<ReturnType<typeof device.sessions.listGameSessions>> = await device.sessions.listGameSessions({ pageSize: 2, cursor });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor && pages.length < 10);

    // Raw order, newest first: 10, [20 unreadable], [30 bad date], 40, 50 minutes ago. An unreadable
    // document ends the first page, so the cursor must come from it, not from the last readable one.
    expect(pages.map((page) => ids(page.sessions))).toEqual([[saved[2]], [saved[1]], [saved[0]]]);
    expect(pages.map((page) => page.unreadable.map((item) => item.id))).toEqual([[unreadableId], [badDateId], []]);
    expect(pages[0]!.unreadable[0]!.error.name).toBe('DomainReadError');
    expect(await device.sessions.getGameSession(unreadableId)).toMatchObject({ status: 'unreadable', id: unreadableId });
    expect(await device.sessions.getGameSession('missing-session-000001')).toMatchObject({ status: 'missing' });
  });

  it('pages past a page with nothing readable on it', async () => {
    const device = await signedInDevice();
    const saved = await saveSessions(device, [30]);
    const uid = device.player.uid;
    await serverWrite({
      [`users/${uid}/gameSessions/unreadable-session-0010`]: sessionDocument(uid, { schemaVersion: 99 }, 10),
      [`users/${uid}/gameSessions/unreadable-session-0020`]: sessionDocument(uid, { schemaVersion: 99 }, 20),
    });

    const first = await device.sessions.listGameSessions({ pageSize: 2 });
    const second = await device.sessions.listGameSessions({ pageSize: 2, cursor: first.nextCursor });

    expect(first.sessions).toEqual([]);
    expect(first.unreadable).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(ids(second.sessions)).toEqual(saved);
    expect(second.nextCursor).toBeNull();
  });

  it('bounds the page size', async () => {
    const device = await signedInDevice();
    await saveSessions(device, [3, 2, 1]);

    expect((await device.sessions.listGameSessions({ pageSize: 0 })).sessions).toHaveLength(1);
    expect((await device.sessions.listGameSessions({ pageSize: Number.NaN })).sessions).toHaveLength(3);
  });

  it('shows when trusted scoring has handled a session', async () => {
    const device = await signedInDevice();
    const started = device.sessions.startGameSession();
    await (await started.save({ definition: testGame, session: sessionDraft() })).acknowledged;
    const reads: boolean[] = [];
    const stop = device.sessions.subscribeToGameSession(started.sessionId, (read) => {
      if (read.status === 'readable') reads.push(read.data.awaitingResult);
    }, (error) => { throw error; });

    await eventually(() => expect(reads).toContain(true));
    const path = `users/${device.player.uid}/gameSessions/${started.sessionId}`;
    await serverWrite({ [path]: { ...(await serverRead(path)), result: trustedResult() } });
    await eventually(() => expect(reads.at(-1)).toBe(false));
    stop();

    const read = await device.sessions.getGameSession(started.sessionId);
    expect(read.status === 'readable' && read.data.session.result?.validity).toBe('valid');
  });
});
