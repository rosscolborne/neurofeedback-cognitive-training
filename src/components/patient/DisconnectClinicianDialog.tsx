import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface DisconnectClinicianDialogProps {
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

// What disconnecting actually changes; nothing here promises how records are retained elsewhere.
const CONSEQUENCES = [
  'Your connection with your clinician ends.',
  'Messages and Visits leave your menu, and upcoming visits are cancelled.',
  'You manage your own training setup.',
  'Your sessions, progress and journal stay in your account.',
];

export const DisconnectClinicianDialog: React.FC<DisconnectClinicianDialogProps> = ({ onConfirm, onClose }) => {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDisconnecting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDisconnecting, onClose]);

  const confirm = async () => {
    if (isDisconnecting) return;
    setIsDisconnecting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Disconnecting could not finish. Please try again.');
      setIsDisconnecting(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDisconnecting) onClose();
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', background: 'rgba(58, 49, 43, 0.58)', backdropFilter: 'blur(7px)',
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disconnect-clinician-title"
        aria-describedby="disconnect-clinician-consequences"
        style={{
          width: 'min(440px, 100%)', maxHeight: 'min(840px, calc(100dvh - 32px))', overflowY: 'auto',
          borderRadius: '24px', background: 'var(--surface-patient-card)', border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 70px rgba(58, 49, 43, 0.2)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <h2 id="disconnect-clinician-title" className="font-display" style={{ margin: 0, fontSize: '22px', lineHeight: 1.2 }}>
            Disconnect from your clinician?
          </h2>
          <button type="button" onClick={onClose} disabled={isDisconnecting} className="btn btn-ghost" aria-label="Close" style={{ padding: '7px', flexShrink: 0 }}>
            <X size={19} />
          </button>
        </div>

        <ul id="disconnect-clinician-consequences" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {CONSEQUENCES.map((line) => (
            <li key={line} style={{ display: 'flex', gap: '10px', fontSize: '14px', lineHeight: 1.45, color: 'var(--text-primary)' }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: '6px', height: '6px', marginTop: '8px', borderRadius: '50%', background: 'var(--text-tertiary)' }} />
              {line}
            </li>
          ))}
        </ul>

        <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          To connect again, you’ll need a new invitation.
        </p>

        {error && <div role="alert" style={{ fontSize: '13px', color: 'var(--status-alert)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isDisconnecting} autoFocus>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={isDisconnecting} style={{ padding: '12px 22px', fontSize: '15px' }}>
            {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      </section>
    </div>
  );
};
