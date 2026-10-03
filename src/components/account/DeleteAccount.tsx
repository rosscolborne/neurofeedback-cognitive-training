import React from 'react';
import { Trash2 } from 'lucide-react';
import type { AccountDeletion } from './useAccountDeletion';

/** Profile's Delete Account row and its password confirmation. */
export const DeleteAccount: React.FC<{ deletion: AccountDeletion }> = ({ deletion }) => {
  const {
    isDeletingAccount, accountDeletionError, showDeletePassword, deletePassword,
    setDeletePassword, handleDeleteAccount, openAccountDeletion, cancelAccountDeletion,
  } = deletion;

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
