import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignInRequiredError } from '../../src/consumer/firestore/context';
import { ConsumerWriteValidationError } from '../../src/consumer/firestore/writes';
import type { UserProfileDraft, UserProfilePatch } from '../../src/consumer/repositories/profileRepository';
import {
  acceptedConsentVersion,
  closeDevices,
  closeEnvironment,
  expectDenied,
  newDevice,
  profileDraft,
  rawClientWrite,
  resetEmulators,
  serverRead,
  serverWrite,
  signedInDevice,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

const millis = (value: unknown) => (value as Timestamp).toMillis();

describe('creating the profile at sign-up', () => {
  it('writes the exact profile with server-clock createdAt and updatedAt', async () => {
    const device = await signedInDevice();
    const before = Date.now();

    await device.profiles.createProfile(profileDraft()).acknowledged;

    const stored = await serverRead(`users/${device.player.uid}`);
    expect(stored).toEqual({
      schemaVersion: 1,
      createdAt: expect.any(Timestamp),
      updatedAt: expect.any(Timestamp),
      displayName: 'Player',
      avatar: { kind: 'preset', presetId: 'fox' },
      preferences: { timezone: 'America/Toronto', soundEnabled: true, hapticsEnabled: false, weeklyGoal: null },
      onboarding: { version: 1, completedAt: null },
      eeg: { enabled: false, consent: null, preferredDevice: null },
    });
    expect(millis(stored?.createdAt)).toBe(millis(stored?.updatedAt));
    expect(millis(stored?.createdAt)).toBeGreaterThanOrEqual(before - 5_000);

    const read = await device.profiles.getProfile();
    expect(read).toMatchObject({ status: 'readable', id: device.player.uid, data: { displayName: 'Player' } });
  });

  it('refuses an invalid draft before writing anything', async () => {
    const device = await signedInDevice();
    const invalid: UserProfileDraft[] = [
      profileDraft({ displayName: 'x'.repeat(41) }),
      profileDraft({ displayName: ' padded ' }),
      profileDraft({ preferences: { ...profileDraft().preferences, weeklyGoal: { kind: 'activeDays', target: 8 } } }),
      { ...profileDraft(), preferences: { ...profileDraft().preferences, theme: 'dark' } } as UserProfileDraft,
      profileDraft({ eeg: { enabled: true, preferredDevice: { model: 'simulated' } } } as unknown as UserProfileDraft),
    ];

    for (const draft of invalid) {
      expect(() => device.profiles.createProfile(draft)).toThrow(ConsumerWriteValidationError);
    }
    expect(await serverRead(`users/${device.player.uid}`)).toBeUndefined();
  });

  it('is refused by the rules when a profile already exists, leaving it unchanged', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;
    const first = await serverRead(`users/${device.player.uid}`);

    await expectDenied(device.profiles.createProfile(profileDraft({ displayName: 'Second' })).acknowledged);

    expect(await serverRead(`users/${device.player.uid}`)).toEqual(first);
  });

  it('needs a signed-in user', () => {
    const device = newDevice();

    expect(() => device.profiles.createProfile(profileDraft())).toThrow(SignInRequiredError);
  });
});

describe('field-level updates', () => {
  it('writes only the named fields plus a server-clock updatedAt, and never createdAt', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;
    const before = await serverRead(`users/${device.player.uid}`);

    await device.profiles.updateProfile({ preferences: { soundEnabled: false }, displayName: null }).acknowledged;

    const after = await serverRead(`users/${device.player.uid}`);
    expect(after).toEqual({
      ...before,
      displayName: null,
      preferences: { ...before?.preferences, soundEnabled: false },
      updatedAt: expect.any(Timestamp),
    });
    expect(millis(after?.createdAt)).toBe(millis(before?.createdAt));
    expect(millis(after?.updatedAt)).toBeGreaterThanOrEqual(millis(before?.updatedAt));
  });

  it('keeps concurrent changes to different fields from two devices (no read-modify-write)', async () => {
    const phone = await signedInDevice();
    await phone.profiles.createProfile(profileDraft()).acknowledged;
    const tablet = newDevice();
    await signInWithEmailAndPassword(tablet.auth, phone.player.email, phone.player.password);
    // Both devices have read the same version.
    await phone.profiles.getProfile();
    await tablet.profiles.getProfile();

    await Promise.all([
      phone.profiles.updateProfile({ preferences: { soundEnabled: false } }).acknowledged,
      tablet.profiles.updateProfile({ preferences: { hapticsEnabled: true }, eeg: { enabled: true } }).acknowledged,
    ]);

    expect(await serverRead(`users/${phone.player.uid}`)).toMatchObject({
      preferences: { soundEnabled: false, hapticsEnabled: true, timezone: 'America/Toronto', weeklyGoal: null },
      eeg: { enabled: true, consent: null },
    });
  });

  it('updates the weekly goal, avatar and preferred device as whole values', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;

    await device.profiles.updateProfile({
      avatar: { kind: 'preset', presetId: 'owl' },
      preferences: { weeklyGoal: { kind: 'minutes', target: 60 }, timezone: 'Europe/London' },
      eeg: { preferredDevice: { model: 'muse-s-athena' } },
    }).acknowledged;

    expect(await serverRead(`users/${device.player.uid}`)).toMatchObject({
      avatar: { kind: 'preset', presetId: 'owl' },
      preferences: { weeklyGoal: { kind: 'minutes', target: 60 }, timezone: 'Europe/London', soundEnabled: true },
      eeg: { preferredDevice: { model: 'muse-s-athena' } },
    });
  });

  it('refuses empty, unknown or out-of-range changes before writing', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;
    const before = await serverRead(`users/${device.player.uid}`);
    const invalid = [
      {},
      { preferences: {} },
      { role: 'clinician' },
      { createdAt: Timestamp.now() },
      { eeg: { consent: { version: acceptedConsentVersion, grantedAt: Timestamp.now() } } },
      { preferences: { weeklyGoal: { kind: 'activeDays', target: 9 } } },
      { preferences: { timezone: '' } },
      { onboarding: { version: 2 } },
    ] as unknown as UserProfilePatch[];

    for (const patch of invalid) {
      expect(() => device.profiles.updateProfile(patch)).toThrow(ConsumerWriteValidationError);
    }
    expect(await serverRead(`users/${device.player.uid}`)).toEqual(before);
  });

  it('completes onboarding with a server-clock completedAt', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;

    await device.profiles.completeOnboarding(2).acknowledged;

    const stored = await serverRead(`users/${device.player.uid}`);
    expect(stored?.onboarding).toEqual({ version: 2, completedAt: expect.any(Timestamp) });
    expect(millis(stored?.onboarding.completedAt)).toBe(millis(stored?.updatedAt));
    expect(() => device.profiles.completeOnboarding(-1)).toThrow(ConsumerWriteValidationError);
  });

  it('records and withdraws EEG consent with the server clock', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;

    await device.profiles.grantEegConsent(acceptedConsentVersion).acknowledged;
    const granted = await serverRead(`users/${device.player.uid}`);
    expect(granted?.eeg.consent).toEqual({ version: acceptedConsentVersion, grantedAt: expect.any(Timestamp) });
    expect(millis(granted?.eeg.consent.grantedAt)).toBe(millis(granted?.updatedAt));

    await device.profiles.withdrawEegConsent().acknowledged;
    expect((await serverRead(`users/${device.player.uid}`))?.eeg.consent).toBeNull();
  });

  it('leaves the accepted consent versions to the rules: an unapproved version is refused there', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;

    await expectDenied(device.profiles.grantEegConsent('unapproved-copy-9').acknowledged);
    expect(() => device.profiles.grantEegConsent('')).toThrow(ConsumerWriteValidationError);
    expect((await serverRead(`users/${device.player.uid}`))?.eeg.consent).toBeNull();
  });

  it('is refused for a profile that does not exist yet, and creates nothing', async () => {
    const device = await signedInDevice();

    const error = await device.profiles.updateProfile({ displayName: 'Nobody' }).acknowledged.catch((reason: unknown) => reason);

    expect(['not-found', 'permission-denied']).toContain((error as { code?: string }).code);
    expect(await serverRead(`users/${device.player.uid}`)).toBeUndefined();
  });

  it('the rules refuse a client write that changes createdAt, which is why updates never rewrite the document', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;
    const stored = await serverRead(`users/${device.player.uid}`);

    await expectDenied(rawClientWrite(device, `users/${device.player.uid}`, { ...stored, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe('reading the profile', () => {
  it('reports a missing profile', async () => {
    const device = await signedInDevice();

    expect(await device.profiles.getProfile()).toMatchObject({ status: 'missing', id: device.player.uid });
  });

  it('reports a legacy or newer-schema profile as unreadable instead of throwing', async () => {
    const legacy = await signedInDevice('legacy');
    const newer = await signedInDevice('newer');
    await serverWrite({
      [`users/${legacy.player.uid}`]: { email: 'legacy@example.test', displayName: 'Legacy', createdAt: '2026-01-15T12:00:00.000Z', role: 'patient' },
      [`users/${newer.player.uid}`]: { schemaVersion: 2, displayName: 'From the future' },
    });

    const legacyRead = await legacy.profiles.getProfile();
    const newerRead = await newer.profiles.getProfile();

    expect(legacyRead).toMatchObject({ status: 'unreadable' });
    expect(newerRead).toMatchObject({ status: 'unreadable' });
    expect(newerRead.status === 'unreadable' && newerRead.error.name).toBe('DomainReadError');
  });

  it('only ever reads the signed-in user', async () => {
    const device = await signedInDevice();
    await device.profiles.createProfile(profileDraft()).acknowledged;
    await signOut(device.auth);

    await expect(device.profiles.getProfile()).rejects.toThrow(SignInRequiredError);
  });
});
