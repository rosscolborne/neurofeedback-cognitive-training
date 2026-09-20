import React, { useState } from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getPasswordChangeErrorMessage,
  validatePasswordChange,
} from './passwordChange';

interface ChangePasswordFormProps {
  variant?: 'patient' | 'clinician';
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)',
  background: '#FFFFFF',
  color: 'var(--text-primary)',
  fontSize: '13px',
};

export const ChangePasswordForm: React.FC<ChangePasswordFormProps> = ({
  variant = 'patient',
}) => {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const isDemoAccount = user?.uid === 'demo-clinician';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsComplete(false);

    const validationError = validatePasswordChange({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsComplete(true);
    } catch (changeError) {
      setError(getPasswordChangeErrorMessage(changeError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={variant === 'patient' ? 'card-patient' : 'card-clinician'}
      style={{ padding: variant === 'patient' ? undefined : '20px', backgroundColor: '#FFFFFF' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <KeyRound size={18} color="var(--brand-primary)" aria-hidden="true" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Account security
        </h2>
      </div>
      <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Change the password you use to sign in. Your current password is required to verify your identity.
      </p>

      {isDemoAccount ? (
        <div
          role="status"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-patient-recessed)',
            color: 'var(--text-secondary)',
            fontSize: '12px',
          }}
        >
          Password changes are not available for the demo account.
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={isSubmitting}
              style={inputStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={isSubmitting}
                aria-describedby="new-password-requirements"
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSubmitting}
                style={inputStyle}
              />
            </label>
          </div>
          <div id="new-password-requirements" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Use at least 6 characters.
          </div>

          {error && (
            <div role="alert" style={{ fontSize: '12px', color: 'var(--status-alert)' }}>
              {error}
            </div>
          )}
          {isComplete && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--status-active)' }}>
              <CheckCircle2 size={15} aria-hidden="true" /> Password changed successfully.
            </div>
          )}

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
              style={{ padding: '9px 14px', fontSize: '12px', opacity: isSubmitting ? 0.7 : 1 }}
            >
              {isSubmitting ? 'Changing password…' : 'Change password'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
