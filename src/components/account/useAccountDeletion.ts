import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, firestoreCache } from '../../services/firebase';
import { profileRepository } from '../../consumer/repositories';
import { getAccountDeletionErrorMessage } from './accountDeletionErrors';

/**
 * Account deletion's state and steps. Its owner must outlive the Profile tab
 * (the app shell holds it), so a deletion still running, or its error, is
 * shown again when the player comes back to Profile.
 */
export function useAccountDeletion(playerId: string) {
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

  return {
    isDeletingAccount, accountDeletionError, showDeletePassword, deletePassword,
    setDeletePassword, handleDeleteAccount, openAccountDeletion, cancelAccountDeletion,
  };
}

export type AccountDeletion = ReturnType<typeof useAccountDeletion>;
