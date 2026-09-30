import { describe, expect, it } from 'vitest';
import {
  applySession,
  DomainReadError,
  readGameProgress,
  readUserProfile,
  type GameProgress,
} from '@nfct/shared';
import { at, fixtureGame, progressSession, sessionId, storedProfile, valid } from './fixtures';

describe('user profile schema', () => {
  it('reads a valid stored profile', () => {
    const raw = storedProfile();

    expect(readUserProfile(raw)).toEqual(raw);
  });

  it('rejects inherited and unknown fields', () => {
    const raw = storedProfile();
    const cases: Record<string, unknown>[] = [
      { ...raw, role: 'clinician' },
      { ...raw, email: 'sam@example.com' },
      { ...raw, preferences: { ...(raw.preferences as object), theme: 'dark' } },
      { ...raw, eeg: { ...(raw.eeg as object), consentedAt: at(0) } },
    ];

    for (const candidate of cases) {
      expect(() => readUserProfile(candidate)).toThrow(DomainReadError);
    }
  });

  it('bounds the display name and the EEG consent', () => {
    const raw = storedProfile();

    expect(() => readUserProfile({ ...raw, displayName: ' Sam' })).toThrow(/displayName/);
    expect(() => readUserProfile({ ...raw, displayName: 'x'.repeat(41) })).toThrow(/displayName/);
    expect(readUserProfile({
      ...raw,
      eeg: { enabled: true, consent: { version: 'eeg-v1', grantedAt: at(1) }, preferredDevice: { model: 'muse-s' } },
    }).eeg.consent?.version).toBe('eeg-v1');
  });
});

describe('game progress schema', () => {
  const progress = applySession(null, {
    definition: fixtureGame,
    sessionId: sessionId(1),
    session: progressSession({ peakLevel: 3 }),
    outcome: valid(120, 6),
    appliedAt: at(1),
  }) as GameProgress;

  it('reads progress produced by the reducer', () => {
    expect(readGameProgress(progress)).toEqual(progress);
  });

  it('rejects unknown keys, including Stage 2 aggregates', () => {
    for (const key of ['streak', 'dailyStats', 'achievements', 'performanceIndex', 'domains', 'appliedSessionIds']) {
      expect(() => readGameProgress({ ...progress, [key]: null })).toThrow(DomainReadError);
    }
    expect(() => readGameProgress({
      ...progress,
      bests: { 'endless:1': { score: { value: 1, sessionId: sessionId(1), achievedAt: at(1), eeg: 1 } } },
    })).toThrow(DomainReadError);
  });
});
