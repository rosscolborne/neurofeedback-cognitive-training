import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@nfct/shared';
import type { User } from 'firebase/auth';

const state = vi.hoisted(() => ({
  muted: false,
  auth: { currentUser: null as null | { uid: string; email: string; delete: () => Promise<void> } },
  reauthenticate: vi.fn(),
  deleteProfile: vi.fn(),
  updateProfile: vi.fn(),
  photoFromFile: vi.fn(),
  logout: vi.fn(),
  // The cache lifecycle (firestoreCacheLifecycle.test.ts) runs `before` (the
  // Auth deletion) and, only if it succeeds, clears and navigates.
  endSession: vi.fn(async ({ before, destination }: { before?: () => Promise<void>; destination: string | null }) => {
    await before?.();
    (globalThis as { window?: { location: { href: string } } }).window!.location.href = destination ?? '';
  }),
}));

vi.mock('../../../services/firebase', () => ({ auth: state.auth, db: {}, firestoreCache: { endSession: state.endSession } }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), reauthenticateWithCredential: state.reauthenticate,
  EmailAuthProvider: { credential: (email: string, password: string) => ({ email, password }) } }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { getMuted: () => state.muted, setMuted: vi.fn() } }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('../../../consumer/repositories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../consumer/repositories')>()),
  profileRepository: { deleteProfile: state.deleteProfile },
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ logout: state.logout, updateProfile: state.updateProfile }) }));
vi.mock('../../../consumer/profile/profilePhoto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../consumer/profile/profilePhoto')>()),
  profilePhotoFromFile: state.photoFromFile,
}));

import { ProfileScreen } from '../ProfileScreen';
import { useProfileScreenState } from '../useProfileScreenState';
import { ProfilePhotoError } from '../../../consumer/profile/profilePhoto';

const player = { uid: 'player-1', email: 'player@example.com' } as User;
const profile = { schemaVersion: 1, displayName: 'Sam Player' } as UserProfile;

// Firebase Auth and Firestore throw an Error carrying a string code.
const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { name: 'FirebaseError', code });
const accepted = () => ({ acknowledged: Promise.resolve() });
const refused = (error: unknown) => {
  const acknowledged = Promise.reject(error);
  acknowledged.catch(() => undefined);
  return { acknowledged };
};
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

const stubWindow = (overrides: Record<string, unknown>) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...originalWindow, ...overrides } });
  return () => Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
};

type ScreenProps = Partial<Omit<React.ComponentProps<typeof ProfileScreen>, 'state'>> & { shown?: boolean };
/** Holds the screen's state as the app shell does, so the tab can come and go while it lives on. */
const Holder = ({ shown = true, ...props }: ScreenProps) => {
  const state = useProfileScreenState(player.uid);
  return shown ? <ProfileScreen user={player} profile={profile} state={state} {...props} /> : null;
};
const screen = (props: ScreenProps = {}) => <Holder {...props} />;
const rendered = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());
const textContent = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textContent).join('');
const deletionTrigger = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button')
  .find((button) => button.children.some((child) => typeof child === 'string' && child.includes('Delete Account')))!;
const openProfileDeletion = (renderer: ReactTestRenderer) => act(() => deletionTrigger(renderer).props.onClick());
const deletionPasswordInputs = (renderer: ReactTestRenderer) => renderer.root.findAllByProps({ id: 'account-deletion-password' });
const typeDeletionPassword = (renderer: ReactTestRenderer, value: string) =>
  act(() => renderer.root.findByProps({ id: 'account-deletion-password' }).props.onChange({ target: { value } }));
const submitDeletion = (renderer: ReactTestRenderer) =>
  renderer.root.findByProps({ className: 'account-deletion-confirmation' }).props.onSubmit({ preventDefault: vi.fn() });
const deletionError = (renderer: ReactTestRenderer) => renderer.root.findByProps({ id: 'account-deletion-error' }).children.join('');
const deletionStatusText = (renderer: ReactTestRenderer) => renderer.root
  .findAll((node) => typeof node.type === 'string' && node.props.role === 'status' && String(node.props.className).includes('account-deletion-status'))
  .map((node) => node.children.join(''));

describe('Profile and account deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.reauthenticate.mockReset();
    state.deleteProfile.mockReset();
    state.deleteProfile.mockReturnValue(accepted());
    state.updateProfile.mockReset();
    state.updateProfile.mockResolvedValue(undefined);
    state.photoFromFile.mockReset();
    state.auth.currentUser = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('does not delete a different account when Auth changes during password confirmation', async () => {
    const oldUser = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.auth.currentUser = oldUser;
    let finishReauth!: () => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((resolve) => { finishReauth = resolve; }));
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(screen()); });
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'secret');
      await act(async () => {
        submitDeletion(renderer);
        await Promise.resolve();
      });
      state.auth.currentUser = { uid: 'other-player', email: 'other@example.com', delete: vi.fn(async () => {}) };
      await act(async () => { finishReauth(); await Promise.resolve(); });
      expect(state.deleteProfile).not.toHaveBeenCalled();
      expect(oldUser.delete).not.toHaveBeenCalled();
      // App-authored guard messages are written for the player and stay verbatim.
      expect(deletionError(renderer)).toBe('Your signed-in account changed. Restart account deletion.');
    } finally {
      renderer?.unmount();
    }
  });

  it('opens deletion in-app, holds a pending status, and turns a wrong password into a readable retry', async () => {
    const confirm = vi.fn(() => true);
    const restoreWindow = stubWindow({ confirm });
    const user = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.auth.currentUser = user;
    let rejectReauth!: (reason: unknown) => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectReauth = reject; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    try {
      openProfileDeletion(renderer);
      // The in-app step is the only confirmation: no browser dialog first.
      expect(confirm).not.toHaveBeenCalled();
      expect(rendered(renderer)).toContain('This action cannot be undone.');
      const password = () => renderer.root.findByProps({ id: 'account-deletion-password' });
      const submit = () => renderer.root.findByProps({ className: 'btn account-deletion-submit' });
      expect(password().props.type).toBe('password');
      expect(password().props.autoComplete).toBe('current-password');
      expect(password().props.className).toBe('account-deletion-password');
      expect(submit().children.join('')).toBe('Confirm account deletion');
      expect(submit().props.disabled).toBe(true);
      typeDeletionPassword(renderer, 'Wrong-Horse-7731');
      expect(submit().props.disabled).toBe(false);

      await act(async () => { submitDeletion(renderer); await Promise.resolve(); });
      expect(state.reauthenticate).toHaveBeenCalledWith(user, { email: player.email, password: 'Wrong-Horse-7731' });
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(renderer.root.findAllByProps({ className: 'account-deletion-confirmation' })).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Wrong-Horse-7731');
      expect(deletionTrigger(renderer).props.disabled).toBe(true);

      await act(async () => {
        rejectReauth(firebaseError('auth/invalid-credential'));
        await Promise.resolve();
      });
      expect(deletionStatusText(renderer)).toEqual([]);
      expect(deletionError(renderer)).toBe('Incorrect password. Please try again.');
      expect(rendered(renderer)).not.toMatch(/Firebase|auth\//);
      expect(password().props.value).toBe('');
      expect(password().props.disabled).toBeFalsy();
      expect(password().props['aria-invalid']).toBe(true);
      expect(password().props['aria-describedby']).toBe('account-deletion-error');
      expect(submit().props.disabled).toBe(true);
      expect(deletionTrigger(renderer).props.disabled).toBe(false);
      expect(state.deleteProfile).not.toHaveBeenCalled();
      expect(user.delete).not.toHaveBeenCalled();
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      expect(submit().props.disabled).toBe(false);
    } finally {
      await act(async () => { renderer.unmount(); });
      restoreWindow();
    }
  });

  it('Cancel closes the deletion step and clears the password and error', async () => {
    state.auth.currentUser = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.reauthenticate.mockRejectedValueOnce(firebaseError('auth/wrong-password'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Wrong-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(deletionError(renderer)).toBe('Incorrect password. Please try again.');
      typeDeletionPassword(renderer, 'Half-Typed-7731');

      act(() => renderer.root.findByProps({ className: 'account-deletion-confirmation' }).findAllByType('button')
        .find((button) => button.children.join('') === 'Cancel')!.props.onClick());
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(renderer.root.findAllByProps({ id: 'account-deletion-error' })).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Half-Typed-7731');

      act(() => deletionTrigger(renderer).props.onClick());
      const password = renderer.root.findByProps({ id: 'account-deletion-password' });
      expect(password.props.value).toBe('');
      expect(password.props['aria-invalid']).toBe(false);
      expect(renderer.root.findAllByProps({ id: 'account-deletion-error' })).toHaveLength(0);
      expect(state.deleteProfile).not.toHaveBeenCalled();
    } finally {
      await act(async () => { renderer.unmount(); });
    }
  });

  it('deletes the profile, then the Auth account once the server has accepted that, with one pending status throughout', async () => {
    const location = { href: '' };
    const restoreWindow = stubWindow({ location });
    let finishAuthDeletion!: () => void;
    const user = { uid: player.uid, email: player.email!, delete: vi.fn(() => new Promise<void>((resolve) => { finishAuthDeletion = resolve; })) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    let acceptProfileDeletion!: () => void;
    state.deleteProfile.mockReturnValueOnce({ acknowledged: new Promise<void>((resolve) => { acceptProfileDeletion = resolve; }) });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(state.deleteProfile).toHaveBeenCalledOnce();
      // Not until the server has accepted the profile deletion.
      expect(user.delete).not.toHaveBeenCalled();
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);

      await act(async () => { acceptProfileDeletion(); await flush(); });
      expect(user.delete).toHaveBeenCalledTimes(1);
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
      expect(rendered(renderer)).not.toContain('Correct-Horse-7731');

      await act(async () => { finishAuthDeletion(); await flush(); });
      expect(state.endSession).toHaveBeenCalledOnce();
      expect(state.endSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'account-deleted', signOut: false, destination: '/welcome' }));
      expect(location.href).toBe('/welcome');
      // Success leaves the status up until the browser navigates away.
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionPasswordInputs(renderer)).toHaveLength(0);
    } finally {
      await act(async () => { renderer.unmount(); });
      restoreWindow();
    }
  });

  it('keeps the Auth account when the profile deletion is refused: Firebase errors read generically and are logged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    const permissionDenied = firebaseError('permission-denied');
    state.deleteProfile.mockReturnValueOnce(refused(permissionDenied));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    try {
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'Correct-Horse-7731');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(deletionError(renderer)).toBe('Account deletion could not finish. Please try again.');
      expect(rendered(renderer)).not.toMatch(/Firebase|permission-denied/);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), permissionDenied);
      expect(user.delete).not.toHaveBeenCalled();
      expect(state.endSession).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ id: 'account-deletion-password' }).props.value).toBe('');
    } finally {
      await act(async () => { renderer.unmount(); });
      consoleError.mockRestore();
    }
  });

  it('after a failed Auth deletion, trying again repeats both steps and finishes, with no recovery screen', async () => {
    const location = { href: '' };
    const restoreWindow = stubWindow({ location });
    const user = { uid: player.uid, email: player.email!, delete: vi.fn()
      .mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
      .mockResolvedValueOnce(undefined) };
    state.auth.currentUser = user;
    state.reauthenticate.mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(screen()); });
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'secret');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(user.delete).toHaveBeenCalledTimes(1);
      expect(deletionError(renderer)).toBe('Unable to connect. Check your internet connection and try again.');
      expect(rendered(renderer)).not.toMatch(/Finish deleting|Finish account deletion/);
      // The rest of the profile stays usable.
      expect(rendered(renderer)).toContain('Log Out');

      typeDeletionPassword(renderer, 'secret');
      await act(async () => { submitDeletion(renderer); await flush(); });
      expect(state.deleteProfile).toHaveBeenCalledTimes(2);
      expect(user.delete).toHaveBeenCalledTimes(2);
      // The failed attempt cleared nothing; only the successful one ends the session.
      expect(state.endSession).toHaveBeenCalledTimes(2);
      expect(location.href).toBe('/welcome');
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
    } finally {
      renderer?.unmount();
      restoreWindow();
    }
  });

  it('keeps a deletion in progress, and its error, when the player leaves Profile and comes back', async () => {
    const signedIn = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.auth.currentUser = signedIn;
    let finishReauth!: (error: unknown) => void;
    state.reauthenticate.mockReturnValueOnce(new Promise<void>((_, reject) => { finishReauth = reject; }));
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(screen()); });
      openProfileDeletion(renderer);
      typeDeletionPassword(renderer, 'secret');
      await act(async () => { submitDeletion(renderer); await Promise.resolve(); });
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);

      // The player switches tab while it runs.
      act(() => { renderer.update(screen({ shown: false })); });
      act(() => { renderer.update(screen()); });
      expect(deletionStatusText(renderer)).toEqual(['Deleting your account…']);
      expect(deletionTrigger(renderer).props.disabled).toBe(true);

      act(() => { renderer.update(screen({ shown: false })); });
      await act(async () => { finishReauth(firebaseError('auth/wrong-password')); await flush(); });
      act(() => { renderer.update(screen()); });
      expect(deletionError(renderer)).toBe('Incorrect password. Please try again.');
      expect(deletionTrigger(renderer).props.disabled).toBe(false);
      expect(state.deleteProfile).not.toHaveBeenCalled();
    } finally {
      renderer?.unmount();
    }
  });

  it('shows the profile name, initials and sign-in email when there is no photo, and offers an upload', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    // Titled like Home, Train and Progress: one level-1 heading.
    expect(renderer.root.findAllByType('h1').map(textContent)).toEqual(['Profile']);
    const text = textContent(renderer.root);
    expect(text).toContain('SP');
    expect(text).toContain('Sam Player');
    expect(text).toContain('player@example.com');
    expect(renderer.root.findAllByProps({ 'aria-label': 'Upload profile photo' })).toHaveLength(1);
    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    const input = renderer.root.findByProps({ 'data-testid': 'profile-photo-input' });
    expect(input.props.type).toBe('file');
    expect(input.props.accept).toBe('image/*');
    renderer.unmount();
  });

  it('shows the player’s photo instead of initials, and offers to change it', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen({ profile: { ...profile, avatar: { kind: 'photo', dataUrl } } })); });
    expect(renderer.root.findAllByType('img').map((img) => img.props.src)).toEqual([dataUrl]);
    expect(textContent(renderer.root.findByProps({ 'aria-label': 'Change profile photo' }))).not.toContain('SP');
    renderer.unmount();
  });

  it('saves a chosen photo to the profile, and retries the same photo after a failed save', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dataUrl = 'data:image/jpeg;base64,BBBB';
    const file = { type: 'image/png', size: 100 };
    state.auth.currentUser = { uid: player.uid, email: player.email!, delete: vi.fn(async () => {}) };
    state.photoFromFile.mockResolvedValueOnce(dataUrl);
    state.updateProfile.mockRejectedValueOnce(firebaseError('unavailable')).mockResolvedValueOnce(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    const input = renderer.root.findByProps({ 'data-testid': 'profile-photo-input' });
    await act(async () => { input.props.onChange({ target: { files: [file], value: 'C:\\fakepath\\me.png' } }); await flush(); });

    expect(state.photoFromFile).toHaveBeenCalledWith(file);
    expect(state.updateProfile).toHaveBeenCalledWith({ avatar: { kind: 'photo', dataUrl } });
    const alert = renderer.root.findByProps({ role: 'alert' });
    expect(textContent(alert)).toContain('The profile photo couldn’t be saved.');
    expect(rendered(renderer)).not.toMatch(/Firebase|unavailable\)/);

    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry')!;
    await act(async () => { retry.props.onClick(); await flush(); });
    expect(state.updateProfile).toHaveBeenCalledTimes(2);
    expect(state.updateProfile.mock.calls[1][0]).toEqual({ avatar: { kind: 'photo', dataUrl } });
    expect(state.photoFromFile).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    renderer.unmount();
    consoleWarn.mockRestore();
  });

  it('never saves the photo to a different account that is signed in now', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.auth.currentUser = { uid: 'other-player', email: 'other@example.com', delete: vi.fn(async () => {}) };
    state.photoFromFile.mockResolvedValueOnce('data:image/jpeg;base64,CCCC');
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    const input = renderer.root.findByProps({ 'data-testid': 'profile-photo-input' });
    await act(async () => { input.props.onChange({ target: { files: [{ type: 'image/png', size: 100 }], value: '' } }); await flush(); });
    expect(state.updateProfile).not.toHaveBeenCalled();
    expect(textContent(renderer.root.findByProps({ role: 'alert' }))).toContain('The profile photo couldn’t be saved.');
    renderer.unmount();
    consoleWarn.mockRestore();
  });

  it('tells the player why a chosen file cannot be their photo, and saves nothing', async () => {
    state.photoFromFile.mockRejectedValueOnce(new ProfilePhotoError('Choose an image file.'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen()); });
    const input = renderer.root.findByProps({ 'data-testid': 'profile-photo-input' });
    await act(async () => { input.props.onChange({ target: { files: [{ type: 'application/pdf', size: 10 }], value: '' } }); await flush(); });
    expect(textContent(renderer.root.findByProps({ role: 'alert' }))).toBe('Choose an image file.');
    expect(state.updateProfile).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('button').map((button) => button.children.join(''))).not.toContain('Retry');
    renderer.unmount();
  });

  it('shows a player who gave no name their email and its initial', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen({ profile: { ...profile, displayName: null } })); });
    expect(renderer.root.findAllByType('h2').map(textContent)).not.toContain('Sam Player');
    expect(textContent(renderer.root)).toContain('Pplayer@example.com');
    renderer.unmount();
  });

  it('offers headset setup, and shows no calibration, protocol or session data', async () => {
    const onSetUpHeadset = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(screen({ onSetUpHeadset })); });
    const text = textContent(renderer.root);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Neural Imprint' })).toHaveLength(0);
    expect(text).not.toMatch(/protocol|calibrat|imprint|training setup|sessions total|Export Data|patient|clinic/i);
    const setUp = renderer.root.findAllByType('button').find((button) => textContent(button).includes('Set Up Headset'))!;
    act(() => setUp.props.onClick());
    expect(onSetUpHeadset).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});
