import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccountDeletionErrorMessage } from '../accountDeletionErrors';

// Mirrors the shape Firebase Auth and Firestore throw: an Error with a string code.
const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { name: 'FirebaseError', code });

const expectReadable = (message: string) => {
  expect(message).not.toMatch(/firebase/i);
  expect(message).not.toMatch(/auth\//);
  expect(message).not.toMatch(/permission-denied|unavailable\b/);
};

describe('getAccountDeletionErrorMessage', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each(['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'])(
    'reports %s as an incorrect password',
    (code) => {
      const message = getAccountDeletionErrorMessage(firebaseError(code));
      expect(message).toBe('Incorrect password. Please try again.');
      expectReadable(message);
    },
  );

  it('asks the player to wait after too many attempts', () => {
    const message = getAccountDeletionErrorMessage(firebaseError('auth/too-many-requests'));
    expect(message).toBe('Too many attempts. Please wait a few minutes and try again.');
    expectReadable(message);
  });

  it.each(['auth/network-request-failed', 'unavailable'])('asks the player to check their connection after a network failure (%s)', (code) => {
    const message = getAccountDeletionErrorMessage(firebaseError(code));
    expect(message).toBe('Unable to connect. Check your internet connection and try again.');
    expectReadable(message);
  });

  it.each(['auth/user-mismatch', 'auth/user-token-expired', 'auth/requires-recent-login'])(
    'asks the player to sign in again for %s',
    (code) => {
      const message = getAccountDeletionErrorMessage(firebaseError(code));
      expect(message).toBe('Please sign in again, then restart account deletion.');
      expectReadable(message);
    },
  );

  it.each(['permission-denied', 'internal', 'auth/internal-error'])(
    'hides unexpected Firebase code %s behind a generic message and logs the original',
    (code) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = firebaseError(code);
      const message = getAccountDeletionErrorMessage(error);
      expect(message).toBe('Account deletion could not finish. Please try again.');
      expectReadable(message);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);
    },
  );

  it('does not log expected credential mistakes', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getAccountDeletionErrorMessage(firebaseError('auth/invalid-credential'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps app-authored messages, which are written for the player', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getAccountDeletionErrorMessage(new Error('Your signed-in account changed. Restart account deletion.')))
      .toBe('Your signed-in account changed. Restart account deletion.');
    const unavailable = 'Your profile is unavailable. Try again later.';
    expect(getAccountDeletionErrorMessage(new Error(unavailable))).toBe(unavailable);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('hides runtime faults and non-Error values behind the generic message and logs them', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const typeError = new TypeError("Cannot read properties of undefined (reading 'uid')");
    expect(getAccountDeletionErrorMessage(typeError)).toBe('Account deletion could not finish. Please try again.');
    expect(getAccountDeletionErrorMessage('boom')).toBe('Account deletion could not finish. Please try again.');
    expect(getAccountDeletionErrorMessage(new Error(''))).toBe('Account deletion could not finish. Please try again.');
    expect(getAccountDeletionErrorMessage(undefined)).toBe('Account deletion could not finish. Please try again.');
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), typeError);
    expect(consoleError).toHaveBeenCalledTimes(4);
  });
});
