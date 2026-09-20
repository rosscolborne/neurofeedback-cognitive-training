import React, { useEffect, useRef } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { MessageBubble } from '../clinician/MessagingView';
import { messageRepository, type MessageRepository } from '../../services/messageRepository';
import { getMessageSendViewState } from '../messaging/messageUiState';
import { useMessageConversation } from '../messaging/useMessageConversation';

interface PatientMessagingViewProps { patientId: string; clinicianName?: string; repository?: MessageRepository; }

export const PatientMessagingView: React.FC<PatientMessagingViewProps> = ({ patientId, clinicianName = 'Your clinician', repository = messageRepository }) => {
  const conversation = useMessageConversation(patientId, repository);
  const endRef = useRef<HTMLDivElement | null>(null);
  const sendView = getMessageSendViewState(conversation.draft, conversation.isSending, conversation.failedAttempt, conversation.sendError);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [conversation.messages]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); void conversation.send(); };

  return <section aria-label="Messages" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 150px)' }}>
    <header style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-default)' }}><h1 style={{ margin: 0 }}>Messages</h1><div>{clinicianName}</div></header>
    <div aria-live="polite" style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {conversation.cursor && <button type="button" className="btn btn-ghost" disabled={conversation.isLoadingOlder} onClick={() => void conversation.loadOlder()}>{conversation.isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
      {conversation.loadState === 'loading' && <div>Loading messages…</div>}
      {conversation.loadState === 'error' && <div role="alert" style={{ color: 'var(--status-alert)' }}>{conversation.loadError}<button type="button" className="btn btn-ghost" onClick={conversation.retryLoad}><RefreshCw size={14} /> Retry</button></div>}
      {conversation.loadState === 'ready' && conversation.messages.length === 0 && <div style={{ margin: 'auto', textAlign: 'center' }}>No messages yet. You can start a conversation with your clinician here.</div>}
      {conversation.messages.map((message) => <MessageBubble key={`${message.source}:${message.id}`} message={message} ownRole="patient" />)}<div ref={endRef} />
    </div>
    {sendView.statusText && !conversation.isSending && <div role="alert" style={{ padding: 8, color: 'var(--status-alert)' }}>{sendView.statusText}</div>}
    <form onSubmit={submit} style={{ padding: 12, display: 'flex', gap: 8 }}><label className="sr-only" htmlFor="patient-message-input">Message your clinician</label><input id="patient-message-input" value={conversation.draft} maxLength={4000} disabled={conversation.isSending || conversation.loadState !== 'ready'} onChange={(event) => conversation.setDraft(event.target.value)} style={{ flex: 1 }} />{sendView.showRetry ? <button type="button" className="btn btn-primary" onClick={() => void conversation.retry()}><RefreshCw size={16} /> Retry</button> : <button type="submit" className="btn btn-primary" disabled={!sendView.canSend || conversation.loadState !== 'ready'}><Send size={16} /> {conversation.isSending ? 'Sending…' : 'Send'}</button>}</form>
  </section>;
};
