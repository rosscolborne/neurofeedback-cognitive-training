export interface PasswordChangeValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const validatePasswordChange = ({
  currentPassword,
  newPassword,
  confirmPassword,
}: PasswordChangeValues): string | null => {
  if (!currentPassword || !newPassword || !confirmPassword) {
    return 'Enter your current password, new password, and password confirmation.';
  }
  if (newPassword.length < 6) {
    return 'Your new password must be at least 6 characters.';
  }
  if (newPassword === currentPassword) {
    return 'Choose a new password that is different from your current password.';
  }
  if (newPassword !== confirmPassword) {
    return 'The new passwords do not match.';
  }
  return null;
};

export const getPasswordChangeErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string })?.code;

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Your current password is incorrect.';
  }
  if (code === 'auth/weak-password') {
    return 'Your new password does not meet the password requirements.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'We could not change your password. Please try again.';
};
