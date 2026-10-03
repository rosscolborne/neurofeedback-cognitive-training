import React, { useEffect, useRef } from 'react';

interface UnsyncedSignOutDialogProps {
  signingOut: boolean;
  /** Where focus goes when the dialog closes (the Log Out control). */
  returnFocusTo?: HTMLElement | null;
  onStaySignedIn: () => void;
  onSignOutAnyway: () => void;
}

/**
 * Shown when sign-out finds writes the server has not accepted yet. Signing
 * out clears this device's cache, which deletes them, so the user chooses.
 * Staying signed in is the default: it is focused first and is what Escape
 * and a click outside do.
 */
export const UnsyncedSignOutDialog: React.FC<UnsyncedSignOutDialogProps> = ({ signingOut, returnFocusTo, onStaySignedIn, onSignOutAnyway }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus the safe choice, and give focus back to Log Out when the dialog closes.
    const opener = returnFocusTo ?? (document.activeElement as HTMLElement | null);
    stayRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus?.();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !signingOut) {
        event.preventDefault();
        onStaySignedIn();
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep focus on the dialog's two actions while it is open.
      const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!buttons.includes(document.activeElement as HTMLButtonElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStaySignedIn, signingOut]);

  return (
    <div
      role="presentation"
      className="overlay-safe-area"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !signingOut) onStaySignedIn();
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(58, 49, 43, 0.58)', backdropFilter: 'blur(7px)',
      }}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsynced-sign-out-title"
        aria-describedby="unsynced-sign-out-description"
        style={{
          width: 'min(440px, 100%)', maxHeight: '100%', overflowY: 'auto',
          borderRadius: '24px', background: 'var(--surface-patient-card)', border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 70px rgba(58, 49, 43, 0.2)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <h2 id="unsynced-sign-out-title" className="font-display" style={{ margin: 0, fontSize: '22px', lineHeight: 1.2 }}>
          Some activity hasn’t uploaded yet
        </h2>
        <div id="unsynced-sign-out-description" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
            Some of your recent activity hasn’t finished uploading, usually because this device is offline.
            Signing out now will delete it from this device, and it can’t be recovered.
          </p>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            Stay signed in to keep it. It uploads when you’re back online.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={onSignOutAnyway} disabled={signingOut} style={{ minHeight: '44px' }}>
            {signingOut ? 'Signing out…' : 'Sign out anyway'}
          </button>
          <button ref={stayRef} type="button" className="btn btn-primary" onClick={onStaySignedIn} disabled={signingOut} style={{ minHeight: '44px', padding: '12px 22px', fontSize: '15px' }}>
            Stay signed in
          </button>
        </div>
      </section>
    </div>
  );
};
