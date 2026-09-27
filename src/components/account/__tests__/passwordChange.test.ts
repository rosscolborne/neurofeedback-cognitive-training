import { describe, expect, it } from 'vitest';
import {
  getPasswordChangeErrorMessage,
  validatePasswordChange,
} from '../passwordChange';

describe('validatePasswordChange', () => {
  it('requires all password fields', () => {
    expect(validatePasswordChange({ currentPassword: '', newPassword: '', confirmPassword: '' }))
      .toBe('Enter your current password, new password, and password confirmation.');
  });

  it('rejects short, reused, and mismatched passwords', () => {
    expect(validatePasswordChange({ currentPassword: 'old-pass', newPassword: 'short', confirmPassword: 'short' }))
      .toBe('Your new password must be at least 6 characters.');
    expect(validatePasswordChange({ currentPassword: 'same-password', newPassword: 'same-password', confirmPassword: 'same-password' }))
      .toBe('Choose a new password that is different from your current password.');
    expect(validatePasswordChange({ currentPassword: 'old-pass', newPassword: 'new-password', confirmPassword: 'different-password' }))
      .toBe('The new passwords do not match.');
  });

  it('accepts a valid password change', () => {
    expect(validatePasswordChange({ currentPassword: 'old-pass', newPassword: 'new-password', confirmPassword: 'new-password' }))
      .toBeNull();
  });
});

describe('getPasswordChangeErrorMessage', () => {
  it('translates Firebase credential errors', () => {
    expect(getPasswordChangeErrorMessage({ code: 'auth/invalid-credential' }))
      .toBe('Your current password is incorrect.');
  });
});
