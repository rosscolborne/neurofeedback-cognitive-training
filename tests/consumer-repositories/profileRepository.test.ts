import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignInRequiredError } from '../../src/consumer/firestore/context';
import { ConsumerWriteValidationError } from '../../src/consumer/firestore/writes';
import { PROFILE_PHOTO_MAX_LENGTH } from '@nfct/shared';
import { newProfileDraft } from '../../src/consumer/profile/newProfile';
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
  sessionDocument,
  signedInDevice,
  withProfile,
} from './harness';

beforeEach(resetEmulators);
afterEach(closeDevices);
afterAll(closeEnvironment);

const millis = (value: unknown) => (value as Timestamp).toMillis();

describe('creating the profile', () => {
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
      { email: 'player@example.test' },
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

  it('reports an unversioned or newer-schema profile as unreadable instead of throwing', async () => {
    const unversioned = await signedInDevice('unversioned');
    const newer = await signedInDevice('newer');
    await serverWrite({
      [`users/${unversioned.player.uid}`]: { displayName: 'No schema version' },
      [`users/${newer.player.uid}`]: { schemaVersion: 2, displayName: 'From the future' },
    });

    const unversionedRead = await unversioned.profiles.getProfile();
    const newerRead = await newer.profiles.getProfile();

    expect(unversionedRead).toMatchObject({ status: 'unreadable' });
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

describe('the profile the app creates for a new player', () => {
  it('is accepted by the rules and reads back with the typed name, the time zone and nothing else set', async () => {
    const device = await signedInDevice();

    await device.profiles.createProfile(newProfileDraft('  Ada Lovelace  ', 'Europe/London')).acknowledged;

    const read = await device.profiles.getProfile();
    expect(read).toMatchObject({
      status: 'readable',
      data: {
        displayName: 'Ada Lovelace',
        avatar: null,
        preferences: { timezone: 'Europe/London', weeklyGoal: null },
        onboarding: { completedAt: null },
        eeg: { enabled: false, consent: null, preferredDevice: null },
      },
    });
  });

  it('stores a blank name as null and bounds a long one to the schema', async () => {
    const blank = await signedInDevice('blank');
    const long = await signedInDevice('long');

    await blank.profiles.createProfile(newProfileDraft('   ')).acknowledged;
    await long.profiles.createProfile(newProfileDraft(`${'x'.repeat(39)}😀 trailing`)).acknowledged;

    expect((await serverRead(`users/${blank.player.uid}`))?.displayName).toBeNull();
    expect((await serverRead(`users/${long.player.uid}`))?.displayName).toBe('x'.repeat(39));
  });
});

describe('deleting the profile', () => {
  it('deletes only the profile document: the player\'s game sessions stay for server-driven deletion', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const sessionPath = `users/${device.player.uid}/gameSessions/session-kept-000000001`;
    await serverWrite({ [sessionPath]: sessionDocument(device.player.uid) });

    await device.profiles.deleteProfile().acknowledged;

    expect(await serverRead(`users/${device.player.uid}`)).toBeUndefined();
    expect(await serverRead(sessionPath)).toBeDefined();
    expect(await device.profiles.getProfile()).toMatchObject({ status: 'missing' });
  });

  it('succeeds when there is no profile, so a retried deletion repeats cleanly', async () => {
    const device = await signedInDevice();

    await device.profiles.deleteProfile().acknowledged;

    expect(await serverRead(`users/${device.player.uid}`)).toBeUndefined();
  });

  it("cannot delete another player's profile", async () => {
    const owner = await signedInDevice('owner');
    await withProfile(owner);
    const other = await signedInDevice('other');

    await expectDenied(deleteDoc(doc(other.firestore, `users/${owner.player.uid}`)));

    expect(await serverRead(`users/${owner.player.uid}`)).toBeDefined();
  });

  it('lets the player create a fresh profile afterwards, with a new createdAt and no EEG consent', async () => {
    const device = await signedInDevice();
    await withProfile(device, { eegConsent: true });
    const first = await serverRead(`users/${device.player.uid}`);
    await device.profiles.deleteProfile().acknowledged;

    await device.profiles.createProfile(profileDraft({ displayName: 'Again' })).acknowledged;

    const second = await serverRead(`users/${device.player.uid}`);
    expect(second?.displayName).toBe('Again');
    expect(second?.eeg).toEqual({ enabled: false, consent: null, preferredDevice: null });
    expect(millis(second?.createdAt)).toBeGreaterThanOrEqual(millis(first?.createdAt));
  });

  it('needs a signed-in player', async () => {
    const device = await signedInDevice();
    await signOut(device.auth);

    expect(() => device.profiles.deleteProfile()).toThrow(SignInRequiredError);
  });
});

describe('the profile photo', () => {
  const photo = (type: string, length: number) => {
    const prefix = `data:image/${type};base64,`;
    return { kind: 'photo' as const, dataUrl: prefix + 'A'.repeat(length - prefix.length) };
  };

  it('sets a photo avatar and reads it back, replaces it, and clears it to null', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const first = photo('png', 2_000);
    const second = photo('jpeg', PROFILE_PHOTO_MAX_LENGTH);

    await device.profiles.updateProfile({ avatar: first }).acknowledged;
    expect(await device.profiles.getProfile()).toMatchObject({ status: 'readable', data: { avatar: first } });
    expect((await serverRead(`users/${device.player.uid}`))?.avatar).toEqual(first);

    await device.profiles.updateProfile({ avatar: second }).acknowledged;
    expect((await serverRead(`users/${device.player.uid}`))?.avatar).toEqual(second);

    await device.profiles.updateProfile({ avatar: null }).acknowledged;
    expect((await serverRead(`users/${device.player.uid}`))?.avatar).toBeNull();
    expect(await device.profiles.getProfile()).toMatchObject({ status: 'readable', data: { avatar: null } });
  });

  it('refuses an invalid photo on the device, before any write', async () => {
    const device = await signedInDevice();
    await withProfile(device);
    const before = await serverRead(`users/${device.player.uid}`);
    const invalid = [
      photo('png', PROFILE_PHOTO_MAX_LENGTH + 1),
      { kind: 'photo', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { kind: 'photo', dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' },
      { kind: 'photo', dataUrl: 'https://example.test/avatar.png' },
      { kind: 'photo', dataUrl: photo('png', 200).dataUrl, presetId: 'fox' },
      { kind: 'photo', presetId: 'fox' },
    ];

    for (const avatar of invalid) {
      expect(() => device.profiles.updateProfile({ avatar } as unknown as UserProfilePatch)).toThrow(ConsumerWriteValidationError);
    }
    expect(await serverRead(`users/${device.player.uid}`)).toEqual(before);
  });
});
