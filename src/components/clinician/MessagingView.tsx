import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, MessageSquare, RefreshCw, Search, Send } from 'lucide-react';
import type { MessageThread } from '../../types';
import { messageRepository, type MessageRepository } from '../../services/messageRepository';
import { formatMessageTime, type ProductionMessage, type ProductionMessageThread } from '../../services/messageMappers';
import { getMessageSendViewState } from '../messaging/messageUiState';
import { useMessageConversation } from '../messaging/useMessageConversation';

export interface MessagingParticipant { patientId: string; name: string; }
interface MessagingViewProps {
  threads?: MessageThread[]; selectedClientId?: string;
  onSendMessage?: (clientId: string, text: string) => void | Promise<void>;
  participants?: MessagingParticipant[]; repository?: MessageRepository;
}

const QUICK_TEMPLATES = [
  'How did your most recent training session feel?',
  'Please let me know if you had any trouble with your headset.',
  'Would you like to schedule a protocol check-in?',
];

export const MessagingView: React.FC<MessagingViewProps> = ({ threads = [], participants = [], selectedClientId, repository = messageRepository }) => {
  const [threadSummaries, setThreadSummaries] = useState<ProductionMessageThread[]>([]);
  const [threadState, setThreadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadRetry, setThreadRetry] = useState(0);
  const [activePatientId, setActivePatientId] = useState<string | null>(selectedClientId ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const endRef = useRef<HTMLDivElement | null>(null);
  const conversation = useMessageConversation(activePatientId, repository);
  const sendView = getMessageSendViewState(conversation.draft, conversation.isSending, conversation.failedAttempt, conversation.sendError);

  useEffect(() => { const resize = () => setIsMobile(window.innerWidth < 768); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    let disposed = false; let unsubscribe = () => {};
    // oxlint-disable-next-line react/set-state-in-effect -- a retry begins a new external subscription lifecycle
    setThreadState('loading'); setThreadError(null);
    void repository.listThreads().then((items) => {
      if (disposed) return;
      setThreadSummaries(items); setThreadState('ready');
    }).catch((error) => {
      if (!disposed) { setThreadState('error'); setThreadError(error instanceof Error ? error.message : 'Conversations are unavailable.'); }
    }).finally(() => {
      if (disposed) return;
      unsubscribe = repository.subscribeToThreads((items) => { if (!disposed) { setThreadSummaries(items); setThreadState('ready'); setThreadError(null); } }, (error) => { if (!disposed) { setThreadState('error'); setThreadError(error.message); } });
    });
    return () => { disposed = true; unsubscribe(); };
  }, [repository, threadRetry]);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize explicit navigation from patient detail
    if (selectedClientId) setActivePatientId(selectedClientId);
  }, [selectedClientId]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [conversation.messages]);

  const legacyMetadata = useMemo(() => new Map(threads.map((item) => [item.clientId, item])), [threads]);
  const names = useMemo(() => new Map(participants.map((item) => [item.patientId, item.name])), [participants]);
  const conversationIds = useMemo(() => {
    const ids = new Set(threadSummaries.map((item) => item.patientId)); participants.forEach((item) => ids.add(item.patientId)); if (selectedClientId) ids.add(selectedClientId); return [...ids];
  }, [participants, selectedClientId, threadSummaries]);
  const filtered = conversationIds.filter((id) => (names.get(id) || legacyMetadata.get(id)?.clientName || 'Patient').toLowerCase().includes(searchQuery.trim().toLowerCase()));
  const activeName = activePatientId ? names.get(activePatientId) || legacyMetadata.get(activePatientId)?.clientName || 'Patient' : null;
  const submit = (event: React.FormEvent) => { event.preventDefault(); void conversation.send(); };

  return <div className="card-clinician" style={{ padding: 0, height: 'calc(100vh - 160px)', minHeight: 520, display: 'flex', overflow: 'hidden' }}>
    <section style={{ width: activePatientId && !isMobile ? 320 : '100%', display: activePatientId && isMobile ? 'none' : 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-default)' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Patient Messages</h2><label style={{ display: 'flex', gap: 6, padding: '6px 10px' }}><Search size={14} /><span className="sr-only">Search conversations</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search conversations" /></label></div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {threadState === 'loading' && <StatusNotice text="Loading conversations…" />}
        {threadState === 'error' && <ErrorNotice message={threadError || 'Conversations are unavailable.'} onRetry={() => setThreadRetry((value) => value + 1)} />}
        {threadState === 'ready' && filtered.length === 0 && <StatusNotice text="No conversations yet. Open a linked patient and choose Message to begin." />}
        {filtered.map((patientId) => { const summary = threadSummaries.find((item) => item.patientId === patientId); return <button key={patientId} type="button" onClick={() => setActivePatientId(patientId)} style={{ width: '100%', padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', background: patientId === activePatientId ? 'var(--surface-patient-base)' : '#fff' }}><strong>{names.get(patientId) || legacyMetadata.get(patientId)?.clientName || 'Patient'}</strong><span style={{ display: 'block', fontSize: 12 }}>{summary?.lastMessageText || 'No messages yet'}</span>{summary?.lastMessageAt && <span style={{ fontSize: 10 }}>{formatMessageTime(summary.lastMessageAt)}</span>}</button>; })}
      </div>
    </section>
    <section style={{ flex: 1, minWidth: 0, display: activePatientId || !isMobile ? 'flex' : 'none', flexDirection: 'column' }}>
      {activePatientId ? <>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', gap: 10 }}>{isMobile && <button type="button" className="btn btn-ghost" aria-label="Back to conversations" onClick={() => setActivePatientId(null)}><ArrowLeft size={18} /></button>}<div><strong>{activeName}</strong><div style={{ fontSize: 11 }}>Private care-team conversation</div></div></header>
        <div aria-live="polite" style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {conversation.cursor && <button type="button" className="btn btn-ghost" disabled={conversation.isLoadingOlder} onClick={() => void conversation.loadOlder()}>{conversation.isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
          {conversation.loadState === 'loading' && <StatusNotice text="Loading messages…" />}
          {conversation.loadState === 'error' && <ErrorNotice message={conversation.loadError || 'Messages are unavailable.'} onRetry={conversation.retryLoad} />}
          {conversation.loadState === 'ready' && conversation.messages.length === 0 && <StatusNotice text="No messages yet. Send the first message when you are ready." />}
          {conversation.messages.map((message) => <MessageBubble key={`${message.source}:${message.id}`} message={message} ownRole="clinician" />)}<div ref={endRef} />
        </div>
        <div style={{ padding: 8, display: 'flex', gap: 6, overflowX: 'auto' }}><MessageSquare size={14} />{QUICK_TEMPLATES.map((template) => <button key={template} type="button" onClick={() => conversation.setDraft(template)}>{template}</button>)}</div>
        {sendView.statusText && !conversation.isSending && <div role="alert" style={{ padding: 8, color: 'var(--status-alert)' }}>{sendView.statusText}</div>}
        <form onSubmit={submit} style={{ padding: 10, display: 'flex', gap: 8 }}><label className="sr-only" htmlFor="clinician-message-input">Message {activeName}</label><input id="clinician-message-input" value={conversation.draft} onChange={(event) => conversation.setDraft(event.target.value)} maxLength={4000} disabled={conversation.isSending || conversation.loadState !== 'ready'} style={{ flex: 1 }} />{sendView.showRetry ? <button type="button" className="btn btn-dense" onClick={() => void conversation.retry()}><RefreshCw size={14} /> Retry</button> : <button type="submit" className="btn btn-dense" disabled={!sendView.canSend || conversation.loadState !== 'ready'}><Send size={14} /> {conversation.isSending ? 'Sending…' : 'Send'}</button>}</form>
      </> : <StatusNotice text="Select a conversation" />}
    </section>
  </div>;
};

export const MessageBubble = ({ message, ownRole }: { message: ProductionMessage; ownRole: 'clinician' | 'patient' }) => {
  const own = message.senderRole === ownRole;
  return <div style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '82%' }}><div style={{ padding: '10px 14px', borderRadius: 8, background: own ? '#3A4B58' : '#fff', color: own ? '#fff' : 'var(--text-primary)' }}>{message.text}</div><div style={{ fontSize: 10 }}>{formatMessageTime(message.createdAt)}{message.readOnly ? ' • Previous correspondence (read-only)' : ''}</div></div>;
};
const StatusNotice = ({ text }: { text: string }) => <div style={{ margin: 'auto', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)' }}>{text}</div>;
const ErrorNotice = ({ message, onRetry }: { message: string; onRetry: () => void }) => <div role="alert" style={{ margin: 16, padding: 12, color: 'var(--status-alert)' }}><AlertCircle size={16} /> {message} <button type="button" className="btn btn-ghost" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>;
