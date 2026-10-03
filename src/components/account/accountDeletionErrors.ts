const ACCOUNT_DELETION_FALLBACK = 'Account deletion could not finish. Please try again.';

const INCORRECT_PASSWORD_CODES = new Set([
  'auth/invalid-credential',
  'auth/wrong-password',
  'auth/invalid-login-credentials',
]);

const SIGN_IN_AGAIN_CODES = new Set([
  'auth/user-mismatch',
  'auth/user-token-expired',
  'auth/requires-recent-login',
]);

const logUnexpected = (error: unknown) => {
  console.error('Account deletion failed', error);
};

/**
 * Turns an account-deletion failure into text a player can act on.
 *
 * Firebase Auth and Firestore errors carry a string `code`; their messages are
 * raw diagnostics ("Firebase: Error (auth/...)"), so only known codes get a
 * specific message and the rest are logged and shown generically. Plain
 * app-authored `Error`s (no code) are written for the player and kept.
 */
export const getAccountDeletionErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

  if (typeof code === 'string') {
    if (INCORRECT_PASSWORD_CODES.has(code)) return 'Incorrect password. Please try again.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a few minutes and try again.';
    // `unavailable`: Firestore could not reach the server, so nothing was deleted.
    if (code === 'auth/network-request-failed' || code === 'unavailable') return 'Unable to connect. Check your internet connection and try again.';
    if (SIGN_IN_AGAIN_CODES.has(code)) return 'Please sign in again, then restart account deletion.';
    logUnexpected(error);
    return ACCOUNT_DELETION_FALLBACK;
  }

  // Built-in subclasses (TypeError, RangeError, ...) are runtime faults, not player-facing text.
  if (error instanceof Error && error.name === 'Error' && error.message) return error.message;

  logUnexpected(error);
  return ACCOUNT_DELETION_FALLBACK;
};
