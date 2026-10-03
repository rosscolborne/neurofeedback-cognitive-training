import React, { useLayoutEffect, useRef } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import type { MessageSendViewState } from './messageUiState';

interface MessageComposerProps {
  inputId: string;
  label: string;
  draft: string;
  isSending: boolean;
  isReady: boolean;
  sendView: MessageSendViewState;
  buttonClassName: string;
  onDraftChange: (text: string) => void;
  onSend: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  inputId, label, draft, isSending, isReady, sendView, buttonClassName,
  onDraftChange, onSend, onRetry,
}) => {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = '40px';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 40), 120)}px`;
  }, [draft]);

  return <form onSubmit={(event) => { event.preventDefault(); void onSend(); }} style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-default)' }}>
    <label htmlFor={inputId} style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minWidth: 0 }}>
      <textarea
        ref={inputRef}
        id={inputId}
        rows={1}
        value={draft}
        maxLength={4000}
        disabled={isSending || !isReady}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (sendView.canSend && isReady) event.currentTarget.form?.requestSubmit();
          }
        }}
        style={{ flex: '1 1 auto', minWidth: 0, minHeight: 40, maxHeight: 120, padding: '8px 12px', resize: 'none', overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', outlineColor: 'var(--border-focus)', backgroundColor: 'var(--surface-patient-card)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: '20px' }}
      />
      {sendView.showRetry
        ? <button type="button" className={buttonClassName} onClick={() => void onRetry()} style={{ flexShrink: 0, minHeight: 40, padding: '9px 14px', fontSize: 14, whiteSpace: 'nowrap' }}><RefreshCw size={15} /> Retry</button>
        : <button type="submit" className={buttonClassName} disabled={!sendView.canSend || !isReady} style={{ flexShrink: 0, minHeight: 40, padding: '9px 14px', fontSize: 14, whiteSpace: 'nowrap' }}><Send size={15} /> {isSending ? 'Sending…' : 'Send'}</button>}
    </div>
  </form>;
};
