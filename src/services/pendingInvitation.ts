/**
 * An invitation code carried from a /connect link through sign-in, scoped to
 * this browser tab. It belongs to the flow that stored it, so every sign-out
 * discards it; otherwise a later, unrelated login would inherit the code.
 */
export const PENDING_INVITATION_STORAGE_KEY = 'waveable_pending_invitation';

export function clearPendingInvitation(): void {
  try {
    window.sessionStorage.removeItem(PENDING_INVITATION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, embedded views); nothing to clear.
  }
}
