import React, { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { Trash2 } from 'lucide-react';
import { auth, firestoreCache } from '../../services/firebase';
import { profileRepository } from '../../consumer/repositories';
import { getAccountDeletionErrorMessage } from './accountDeletionErrors';

interface DeleteAccountProps {
  /** The signed-in player whose account this deletes. */
  playerId: string;
}

/** Profile's Delete Account row and its password confirmation. */
export const DeleteAccount: React.FC<DeleteAccountProps> = ({ playerId }) => {
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const handleDeleteAccount = async () => {
    if (isDeletingAccount || !deletePassword) return;
    // Submitting is the final confirmation. Hand the password to reauthentication
    // and drop it from state so teardown never re-renders it.
    const password = deletePassword;
    setDeletePassword('');
    const signedIn = auth.currentUser;
    if (!signedIn?.email || signedIn.uid !== playerId) {
      setAccountDeletionError('Your signed-in account changed. Restart account deletion.');
      return;
    }
    const ensureSameAccount = () => {
      if (auth.currentUser !== signedIn) throw new Error('Your signed-in account changed. Restart account deletion.');
    };
    setIsDeletingAccount(true);
    setAccountDeletionError(null);
    try {
      await reauthenticateWithCredential(signedIn, EmailAuthProvider.credential(signedIn.email, password));
      ensureSameAccount();
      // The profile goes first, and the Auth account only once the server has
      // accepted that; offline the profile deletion fails rather than waiting
      // (see deleteProfile). If the Auth deletion then fails, trying again
      // repeats both steps. Game sessions, EEG recordings and the server-owned
      // aggregates under users/{uid} stay until server-driven deletion (NFCT-23).
      await profileRepository.deleteProfile().acknowledged;
      ensureSameAccount();
      // Deleting the Auth account runs inside the cache cleanup, so its
      // sign-out is not mistaken for an account change. Once it succeeds the
      // deleted account's cached data and queued writes are removed from this
      // device, and the app loads afresh at the welcome screen.
      await firestoreCache.endSession({
        reason: 'account-deleted',
        signOut: false,
        destination: '/welcome',
        before: async () => {
          await signedIn.delete();
        },
      });
    } catch (err) {
      setAccountDeletionError(getAccountDeletionErrorMessage(err));
      // Only failure leaves the pending state; success keeps it until the redirect lands.
      setIsDeletingAccount(false);
    }
  };

  const openAccountDeletion = () => {
    setAccountDeletionError(null);
    setShowDeletePassword(true);
  };

  const cancelAccountDeletion = () => {
    setShowDeletePassword(false);
    setDeletePassword('');
    setAccountDeletionError(null);
  };

  const deletionPasswordForm = showDeletePassword && (isDeletingAccount ? (
    <div className="account-deletion-confirmation account-deletion-status" role="status" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
      Deleting your account…
    </div>
  ) : (
    <form
      className="account-deletion-confirmation"
      onSubmit={(event) => { event.preventDefault(); void handleDeleteAccount(); }}
    >
      <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
        Are you sure you want to delete your account? This action cannot be undone.
      </p>
      <label className="account-deletion-label" htmlFor="account-deletion-password">
        Enter your password to confirm account deletion
        <input
          className="account-deletion-password"
          id="account-deletion-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={deletePassword}
          onChange={(event) => setDeletePassword(event.target.value)}
          aria-invalid={!!accountDeletionError}
          aria-describedby={accountDeletionError ? 'account-deletion-error' : undefined}
        />
      </label>
      {accountDeletionError && <p className="account-deletion-error" id="account-deletion-error" role="alert">{accountDeletionError}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px' }}>
        <button className="btn account-deletion-submit" type="submit" disabled={!deletePassword}>
          Confirm account deletion
        </button>
        <button className="btn btn-ghost" type="button" onClick={cancelAccountDeletion} style={{ minHeight: '42px', marginTop: '4px' }}>
          Cancel
        </button>
      </div>
    </form>
  ));

  return (
    <div className="list-group">
      <button
        onClick={openAccountDeletion}
        disabled={isDeletingAccount}
        className="list-row list-row-danger account-deletion-trigger"
        type="button"
      >
        <Trash2 size={18} className="list-row-icon" aria-hidden="true" />
        Delete Account
      </button>
      {deletionPasswordForm && <div style={{ padding: '0 16px 16px' }}>{deletionPasswordForm}</div>}
    </div>
  );
};
