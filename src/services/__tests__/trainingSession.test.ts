import { describe, expect, it } from 'vitest';
import {
  NEUROGAMBIT_SESSION_SECONDS,
  advanceSessionClock,
  assessSessionCompletionReadiness,
  createSessionCompletionId,
  getCompletedSessionDuration,
} from '../trainingSession';

describe('headset session rules', () => {
  it('requires secure completion IDs', () => {
    expect(createSessionCompletionId()).toMatch(/^sess-[0-9a-f-]{36}$/i);
  });

  it('needs live headset data for 80% of a real-headset session, and nothing EEG-specific', () => {
    const base = { isDemo: false, elapsedSeconds: 10, measuredSeconds: 8, hardwareConnected: true, sourceFresh: true };
    expect(assessSessionCompletionReadiness(base)).toEqual({ ok: true });
    expect(assessSessionCompletionReadiness({ ...base, measuredSeconds: 7 }))
      .toMatchObject({ ok: false, error: expect.stringContaining('7 of 10') });
    expect(assessSessionCompletionReadiness({ ...base, hardwareConnected: false }))
      .toMatchObject({ ok: false, error: expect.stringContaining('disconnected') });
    expect(assessSessionCompletionReadiness({ ...base, sourceFresh: false }))
      .toMatchObject({ ok: false, error: expect.stringContaining('stopped') });
    expect(assessSessionCompletionReadiness({ ...base, elapsedSeconds: 0, measuredSeconds: 0 })).toMatchObject({ ok: false });
  });

  it('lets a Demo session save without headset data', () => {
    expect(assessSessionCompletionReadiness({
      isDemo: true, elapsedSeconds: 0, measuredSeconds: 0, hardwareConnected: false, sourceFresh: false,
    })).toEqual({ ok: true });
  });

  it('completes a one-minute session on tick 60 with an exact 60-second saved duration', () => {
    let elapsed = 0;
    let complete = false;
    while (!complete) ({ elapsed, complete } = advanceSessionClock(elapsed, 60));
    expect(elapsed).toBe(60);
    expect(getCompletedSessionDuration(elapsed, 59)).toBe(60);
    expect(getCompletedSessionDuration(undefined, 42)).toBe(42);
  });

  it('runs NeuroGambit sessions for 25 minutes', () => {
    expect(NEUROGAMBIT_SESSION_SECONDS).toBe(1_500);
  });
});
