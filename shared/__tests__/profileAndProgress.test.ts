import { describe, expect, it } from 'vitest';
import {
  applySession,
  canApplyToProgress,
  gameProgressWriteSchema,
  readGameProgress,
  readUserProfile,
  userProfileWriteSchema,
  validOutcome,
  type GameProgress,
} from '@nfct/shared';
import { at, fixtureGame, progressSession, scored, sessionId, storedProfile } from './fixtures';

describe('user profile schema', () => {
  it('reads and writes a valid stored profile', () => {
    const raw = storedProfile();

    expect(userProfileWriteSchema.parse(raw)).toEqual(raw);
    expect(readUserProfile(raw)).toEqual(raw);
  });

  it('refuses to write inherited or unknown fields, and reads past them', () => {
    const raw = storedProfile();
    const cases: Record<string, unknown>[] = [
      { ...raw, role: 'clinician' },
      { ...raw, email: 'sam@example.com' },
      { ...raw, preferences: { ...(raw.preferences as object), theme: 'dark' } },
      { ...raw, eeg: { ...(raw.eeg as object), consentedAt: at(0) } },
    ];

    for (const candidate of cases) {
      expect(userProfileWriteSchema.safeParse(candidate).success).toBe(false);
      expect(readUserProfile(candidate)).toEqual(raw);
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
    session: progressSession(),
    outcome: validOutcome(fixtureGame, { modeId: 'endless', startLevel: 1 }, scored(120, { correct: 6, peakLevel: 3 })),
    appliedAt: at(1),
  }) as GameProgress;

  it('reads and writes progress produced by the reducer', () => {
    expect(gameProgressWriteSchema.parse(progress)).toEqual(progress);
    expect(readGameProgress(progress)).toEqual(progress);
  });

  it('refuses to write unknown keys, including Stage 2 aggregates', () => {
    for (const key of ['streak', 'dailyStats', 'achievements', 'performanceIndex', 'domains', 'appliedSessionIds']) {
      expect(gameProgressWriteSchema.safeParse({ ...progress, [key]: null }).success).toBe(false);
    }
    expect(gameProgressWriteSchema.safeParse({
      ...progress,
      bests: { 'endless:1': { score: { value: 1, sessionId: sessionId(1), achievedAt: at(1), eeg: 1 } } },
    }).success).toBe(false);
  });

  it('reads progress from a newer reducer without failing, and declines to apply to it', () => {
    const newer = { ...progress, aggregateVersion: 2, domains: { math: { index: null } } };

    const read = readGameProgress(newer);

    expect(read).toEqual({ ...progress, aggregateVersion: 2 });
    expect(canApplyToProgress(read, fixtureGame)).toBe(false);
  });
});
