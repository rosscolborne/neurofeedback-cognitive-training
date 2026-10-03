import React, { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { MessageBubble } from '../messaging/MessageBubble';
import { messageRepository, type MessageRepository } from '../../services/messageRepository';
import { getMessageSendViewState } from '../messaging/messageUiState';
import { useMessageConversation } from '../messaging/useMessageConversation';
import { MessageComposer } from '../messaging/MessageComposer';
import { useMarkVisibleMessageRead } from '../messaging/useMessageUnread';

interface PatientMessagingViewProps { patientId: string; clinicianName?: string; repository?: MessageRepository; unreadMessageId?: string | null; notificationError?: string | null; }

export const PatientMessagingView: React.FC<PatientMessagingViewProps> = ({ patientId, clinicianName = 'Your clinician', repository = messageRepository, unreadMessageId, notificationError }) => {
  const conversation = useMessageConversation(patientId, repository);
  const endRef = useRef<HTMLDivElement | null>(null);
  const sendView = getMessageSendViewState(conversation.draft, conversation.isSending, conversation.failedAttempt, conversation.sendError);
  const readError = useMarkVisibleMessageRead(conversation.relationship, conversation.messages, conversation.loadState, unreadMessageId, repository);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conversation.messages]);

  return <section aria-label="Messages" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 150px)' }}>
    <header style={{ padding: '0 0 14px', borderBottom: '1px solid var(--border-default)' }}><h1 className="font-display" style={{ margin: 0, fontSize: 28, fontWeight: 400, color: 'var(--text-primary)' }}>Messages</h1><div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{clinicianName}</div></header>
    <div aria-live="polite" style={{ flex: 1, padding: '16px 0', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {conversation.cursor && <button type="button" className="btn btn-ghost" disabled={conversation.isLoadingOlder} onClick={() => void conversation.loadOlder()}>{conversation.isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
      {conversation.loadState === 'loading' && <div>Loading messages…</div>}
      {conversation.loadState === 'error' && <div role="alert" style={{ color: 'var(--status-alert)' }}>{conversation.loadError}<button type="button" className="btn btn-ghost" onClick={conversation.retryLoad}><RefreshCw size={14} /> Retry</button></div>}
      {conversation.loadState === 'ready' && conversation.messages.length === 0 && <div style={{ margin: 'auto', textAlign: 'center' }}>No messages yet. You can start a conversation with your clinician here.</div>}
      {conversation.messages.map((message) => <MessageBubble key={`${message.source}:${message.id}`} message={message} ownRole="patient" />)}<div ref={endRef} />
    </div>
    {(notificationError || readError) && <div role="alert" style={{ padding: 8, color: 'var(--status-alert)' }}>Message notifications are unavailable: {notificationError || readError}</div>}
    {sendView.statusText && !conversation.isSending && <div role="alert" style={{ padding: 8, color: 'var(--status-alert)' }}>{sendView.statusText}</div>}
    <MessageComposer inputId="patient-message-input" label="Message your clinician" draft={conversation.draft} isSending={conversation.isSending} isReady={conversation.loadState === 'ready'} sendView={sendView} buttonClassName="btn btn-primary" onDraftChange={conversation.setDraft} onSend={conversation.send} onRetry={conversation.retry} />
  </section>;
};
