import React, { useCallback, useRef, useState } from 'react';
import type { LogoutOutcome } from '../../contexts/AuthContext';
import { UnsyncedSignOutDialog } from './UnsyncedSignOutDialog';

type Logout = (options?: { discardUnsyncedWrites?: boolean }) => Promise<LogoutOutcome | void>;

export type SignOutPhase = 'idle' | 'checking' | 'unsynced' | 'signing-out';

/**
 * Sign-out for a shell's Log Out buttons: checks for writes that have not
 * uploaded, asks before discarding them, and ignores repeated clicks while a
 * sign-out is running. Render `dialog` somewhere in the shell.
 */
export function useSignOut(logout: Logout): { phase: SignOutPhase; busy: boolean; requestSignOut: () => void; dialog: React.ReactNode } {
  const [phase, setPhase] = useState<SignOutPhase>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const running = useRef(false);
  // The control that started sign-out. It is disabled while the check runs
  // (which takes focus off it), so remember it to give focus back later.
  const opener = useRef<HTMLElement | null>(null);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);

  const run = useCallback(async (discardUnsyncedWrites: boolean) => {
    if (running.current) return;
    running.current = true;
    setPhase(discardUnsyncedWrites ? 'signing-out' : 'checking');
    try {
      const outcome = await logout(discardUnsyncedWrites ? { discardUnsyncedWrites: true } : undefined);
      if (outcome === 'unsynced') {
        running.current = false;
        setPhase('unsynced');
        setReturnFocusTo(opener.current);
        setDialogOpen(true);
      } else {
        // The app is loading afresh; keep the buttons disabled until it does.
        setPhase('signing-out');
      }
    } catch (error) {
      console.warn('Sign-out could not start:', error);
      running.current = false;
      setPhase('idle');
      setDialogOpen(false);
    }
  }, [logout]);

  const requestSignOut = useCallback(() => {
    if (!running.current) opener.current = (typeof document === 'undefined' ? null : document.activeElement) as HTMLElement | null;
    void run(false);
  }, [run]);
  const stay = useCallback(() => {
    if (running.current) return;
    setPhase('idle');
    setDialogOpen(false);
  }, []);
  const signOutAnyway = useCallback(() => { void run(true); }, [run]);

  const dialog = dialogOpen
    ? <UnsyncedSignOutDialog signingOut={phase === 'signing-out'} returnFocusTo={returnFocusTo} onStaySignedIn={stay} onSignOutAnyway={signOutAnyway} />
    : null;

  return { phase, busy: phase === 'checking' || phase === 'signing-out', requestSignOut, dialog };
}
