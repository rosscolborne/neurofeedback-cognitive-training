import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameSessionSchemaFor, mentalMath } from '@nfct/shared';
import { summarizeEegWindows } from '../../src/consumer/eeg/eegCapture';
import { playRun } from '../../src/consumer/games/mentalMath/__tests__/fixtures';
import { APP_VERSION, buildSessionDraft } from '../../src/consumer/games/mentalMath/sessionDraft';
import { GameSessionAlreadySavedError } from '../../src/consumer/repositories/gameSessionRepository';
import { closeDevices, closeEnvironment, resetEmulators, serverRead, signedInDevice, withProfile } from './harness';

// NFCT-21: a run played by the Mental Math runner, turned into a session the
// way the game screen does, and saved through the real repository with the
// real rules. The player has a consumer profile with EEG consent, so the
// simulated recording is written with the session and linked to it.

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

describe('saving a played Mental Math run', () => {
  it('writes the run once, reproducible from its seed, with its simulated recording linked', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const started = device.sessions.startGameSession();
    const outcome = playRun({ seed: started.seed, startLevel: 1, correct: 8, wallStartMs: Date.now() - 5 * 60_000 });
    const session = buildSessionDraft(outcome, { timezone: 'America/Toronto', appVersion: APP_VERSION, platform: 'web' });
    const eegRecording = summarizeEegWindows({
      source: 'simulated',
      device: { model: 'unknown', firmwareVersion: null, transport: 'web-bluetooth', channels: ['TP9', 'AF7', 'AF8', 'TP10'], sampleRateHz: 256 },
      processing: { service: 'brainflow-service', serviceVersion: 'demo-mode', featureVersion: 1, windowSeconds: 1 },
      startedAtMs: outcome.startedAtMs,
      endedAtMs: outcome.endedAtMs,
      windows: Array.from({ length: 90 }, (_, index) => ({ mindfulness: 0.5 + (index % 10) / 40, restfulness: 0.6, usable: true })),
    });

    const saved = await started.save({ definition: mentalMath.definition, session, eegRecording });
    await saved.acknowledged;
    await expect(started.save({ definition: mentalMath.definition, session, eegRecording })).rejects.toBeInstanceOf(GameSessionAlreadySavedError);

    const stored = await serverRead(`users/${device.player.uid}/gameSessions/${started.sessionId}`);
    expect(stored).toMatchObject({ status: 'completed', seed: started.seed, activeDurationMs: 90_000, startLevel: 1 });
    expect(stored?.trials).toEqual(outcome.run.trials);
    // What trusted scoring will check: the stored session is a valid v1 run from its seed.
    const parsed = gameSessionSchemaFor(mentalMath.definition, 'read').parse(stored);
    expect(mentalMath.checkSession(parsed)).toMatchObject({ outcome: 'valid', reasons: [] });

    expect(saved.eegRecording.status).toBe('included');
    const recordingId = saved.eegRecording.status === 'included' ? saved.eegRecording.recordingId : '';
    const recording = await serverRead(`users/${device.player.uid}/eegRecordings/${recordingId}`);
    expect(recording).toMatchObject({ gameSessionId: started.sessionId, source: 'simulated', device: { model: 'unknown' } });
  });
});
