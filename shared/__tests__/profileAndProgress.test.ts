import { describe, expect, it } from 'vitest';
import {
  applySession,
  canApplyToProgress,
  gameProgressWriteSchema,
  PROFILE_PHOTO_DATA_URL_PATTERN,
  PROFILE_PHOTO_MAX_LENGTH,
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

describe('user profile photo avatar', () => {
  /** An image data URL of exactly `length` characters that is otherwise valid. */
  const dataUrl = (length: number, type = 'png') => {
    const prefix = `data:image/${type};base64,`;
    return prefix + 'A'.repeat(length - prefix.length);
  };
  const withAvatar = (avatar: unknown) => ({ ...storedProfile(), avatar });
  // The rules' values (firestore.rules, validAvatar); tests/firestore-rules checks the rules against these constants.
  const RULES_MAX_LENGTH = 100_000;
  const RULES_PATTERN = '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$';

  it('agrees with the rules on the bound and the pattern', () => {
    expect(PROFILE_PHOTO_MAX_LENGTH).toBe(RULES_MAX_LENGTH);
    expect(PROFILE_PHOTO_DATA_URL_PATTERN.source.replace(/\(\?:/g, '(').replace(/\\\//g, '/')).toBe(RULES_PATTERN);
  });

  it('writes and reads a valid photo, up to exactly the bound', () => {
    for (const avatar of [
      { kind: 'photo', dataUrl: dataUrl(200) },
      { kind: 'photo', dataUrl: dataUrl(200, 'jpeg') },
      { kind: 'photo', dataUrl: dataUrl(200, 'webp') },
      { kind: 'photo', dataUrl: dataUrl(RULES_MAX_LENGTH) },
      { kind: 'preset', presetId: 'fox' },
      null,
    ]) {
      const raw = withAvatar(avatar);
      expect(userProfileWriteSchema.parse(raw)).toEqual(raw);
      expect(readUserProfile(raw).avatar).toEqual(avatar);
    }
  });

  it('refuses the photos the rules refuse', () => {
    const refusedByValue = [
      { kind: 'photo', dataUrl: dataUrl(RULES_MAX_LENGTH + 1) },
      { kind: 'photo', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { kind: 'photo', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
      { kind: 'photo', dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' },
      { kind: 'photo', dataUrl: 'https://example.test/avatar.png' },
      { kind: 'photo', dataUrl: 'data:image/png;base64,not base64!' },
      { kind: 'photo', dataUrl: '' },
      { kind: 'photo', presetId: 'fox' },
      { kind: 'photo', dataUrl: 42 },
      { kind: 'preset', dataUrl: dataUrl(200) },
    ];
    for (const avatar of refusedByValue) {
      expect(userProfileWriteSchema.safeParse(withAvatar(avatar)).success).toBe(false);
      expect(() => readUserProfile(withAvatar(avatar))).toThrow(/avatar/);
    }

    // An extra key is a write error; reads tolerate it, as for every other field, and drop it.
    const extraKey = { kind: 'photo', dataUrl: dataUrl(200), presetId: 'fox' };
    expect(userProfileWriteSchema.safeParse(withAvatar(extraKey)).success).toBe(false);
    expect(readUserProfile(withAvatar(extraKey)).avatar).toEqual({ kind: 'photo', dataUrl: dataUrl(200) });
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
