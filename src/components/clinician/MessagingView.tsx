import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, RefreshCw, Search } from 'lucide-react';
import type { MessageThread } from '../../types';
import { messageRepository, type MessageRepository } from '../../services/messageRepository';
import { formatMessageTime, type MessageUnreadStatus, type ProductionMessage } from '../../services/messageMappers';
import { getMessageSendViewState } from '../messaging/messageUiState';
import { useMessageConversation } from '../messaging/useMessageConversation';
import { MessageComposer } from '../messaging/MessageComposer';
import { useMarkVisibleMessageRead } from '../messaging/useMessageUnread';
import { PatientAvatar } from './PatientAvatar';

export interface MessagingParticipant { patientId: string; name: string; avatarUrl?: string; }
interface MessagingViewProps {
  threads?: MessageThread[]; selectedClientId?: string;
  onSendMessage?: (clientId: string, text: string) => void | Promise<void>;
  participants?: MessagingParticipant[]; repository?: MessageRepository;
  unreadByPatient?: Record<string, MessageUnreadStatus>; notificationError?: string | null;
}

const QUICK_TEMPLATES = [
  'How did your most recent training session feel?',
  'Please let me know if you had any trouble with your headset.',
  'Would you like to schedule a protocol check-in?',
];

export const MessagingView: React.FC<MessagingViewProps> = ({ participants = [], selectedClientId, repository = messageRepository, unreadByPatient = {}, notificationError }) => {
  const [activePatientId, setActivePatientId] = useState<string | null>(selectedClientId ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const endRef = useRef<HTMLDivElement | null>(null);
  const participantIds = useMemo(() => new Set(participants.map((item) => item.patientId)), [participants]);
  const currentActivePatientId = activePatientId && participantIds.has(activePatientId) ? activePatientId : null;
  const conversation = useMessageConversation(currentActivePatientId, repository);
  const sendView = getMessageSendViewState(conversation.draft, conversation.isSending, conversation.failedAttempt, conversation.sendError);
  const unreadMessageId = currentActivePatientId && unreadByPatient[currentActivePatientId]?.unread ? unreadByPatient[currentActivePatientId].latestIncomingMessageId : null;
  const readError = useMarkVisibleMessageRead(conversation.relationship, conversation.messages, conversation.loadState, unreadMessageId, repository);

  useEffect(() => { const resize = () => setIsMobile(window.innerWidth < 768); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize explicit navigation from patient detail
    if (selectedClientId && participantIds.has(selectedClientId)) setActivePatientId(selectedClientId);
  }, [participantIds, selectedClientId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [conversation.messages]);

  const participantsById = useMemo(() => new Map(participants.map((item) => [item.patientId, item])), [participants]);
  const filtered = participants.filter((item) => item.name.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  const activeParticipant = currentActivePatientId ? participantsById.get(currentActivePatientId) : null;
  const activeName = activeParticipant?.name || 'Patient';

  return <div className="card-clinician" style={{ width: '100%', padding: 0, height: currentActivePatientId ? 'min(880px, max(560px, calc(100dvh - 160px)))' : undefined, display: 'flex', overflow: 'hidden' }}>
      <section style={{ width: currentActivePatientId && !isMobile ? 320 : '100%', flexShrink: 0, display: currentActivePatientId && isMobile ? 'none' : 'flex', flexDirection: 'column', borderRight: currentActivePatientId && !isMobile ? '1px solid var(--border-default)' : undefined }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border-default)' }}>
        <h2 style={{ fontSize: 17, margin: '0 0 12px', fontFamily: 'var(--font-body)' }}>Patient Messages</h2>
        <label className="messaging-search">
          <Search size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
          <input type="search" aria-label="Search conversations" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search conversations" />
        </label>
      </div>
      {notificationError && <div role="alert" style={{ padding: '8px 16px', color: 'var(--status-alert)', fontSize: 12 }}>Message notifications are unavailable: {notificationError}</div>}
      <div style={{ flex: currentActivePatientId ? 1 : undefined, overflowY: currentActivePatientId ? 'auto' : undefined }}>
        {filtered.length === 0 && <div style={{ padding: '24px 16px', color: 'var(--text-secondary)', fontSize: 14 }}>{participants.length ? 'No conversations match your search.' : 'No linked patients are available for messaging.'}</div>}
        {filtered.map((participant) => <button key={participant.patientId} className="messaging-participant" type="button" aria-label={`${participant.name} Open conversation${unreadByPatient[participant.patientId]?.unread ? ', unread message' : ''}`} aria-current={participant.patientId === currentActivePatientId ? 'true' : undefined} onClick={() => setActivePatientId(participant.patientId)}><PatientAvatar avatarUrl={participant.avatarUrl} size={36} /><span className="messaging-participant-copy"><strong>{participant.name}</strong><span>Open conversation</span></span>{unreadByPatient[participant.patientId]?.unread && <span className="messaging-unread-label" aria-hidden="true">Unread</span>}</button>)}
      </div>
    </section>
    {currentActivePatientId && <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 10 }}>{isMobile && <button type="button" className="btn btn-ghost" aria-label="Back to conversations" onClick={() => setActivePatientId(null)}><ArrowLeft size={18} /></button>}<PatientAvatar avatarUrl={activeParticipant?.avatarUrl} size={36} /><div><strong>{activeName}</strong><div style={{ fontSize: 11 }}>Private care-team conversation</div></div></header>
        <div aria-live="polite" style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {conversation.cursor && <button type="button" className="btn btn-ghost" disabled={conversation.isLoadingOlder} onClick={() => void conversation.loadOlder()}>{conversation.isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
          {conversation.loadState === 'loading' && <StatusNotice text="Loading messages…" />}
          {conversation.loadState === 'error' && <ErrorNotice message={conversation.loadError || 'Messages are unavailable.'} onRetry={conversation.retryLoad} />}
          {conversation.loadState === 'ready' && conversation.messages.length === 0 && <StatusNotice text="No messages yet. Send the first message when you are ready." />}
          {conversation.messages.map((message) => <MessageBubble key={`${message.source}:${message.id}`} message={message} ownRole="clinician" />)}<div ref={endRef} />
        </div>
        {readError && <div role="alert" style={{ padding: '8px 16px', color: 'var(--status-alert)', fontSize: 12 }}>Could not update message notification: {readError}</div>}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-default)', background: 'var(--surface-clinician-base)' }}>
          <div style={{ marginBottom: 8, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>Suggested messages</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
            {QUICK_TEMPLATES.map((template) => <button key={template} type="button" className="messaging-suggestion" aria-pressed={conversation.draft === template} onClick={() => conversation.setDraft(template)}>{template}</button>)}
          </div>
        </div>
        {sendView.statusText && !conversation.isSending && <div role="alert" style={{ padding: 8, color: 'var(--status-alert)' }}>{sendView.statusText}</div>}
        <MessageComposer inputId="clinician-message-input" label={`Message ${activeName}`} draft={conversation.draft} isSending={conversation.isSending} isReady={conversation.loadState === 'ready'} sendView={sendView} buttonClassName="btn btn-dense" onDraftChange={conversation.setDraft} onSend={conversation.send} onRetry={conversation.retry} />
    </section>}
  </div>;
};

export const MessageBubble = ({ message, ownRole }: { message: ProductionMessage; ownRole: 'clinician' | 'patient' }) => {
  const own = message.senderRole === ownRole;
  return <div style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '82%' }}><div style={{ padding: '10px 14px', borderRadius: 8, background: own ? '#3A4B58' : '#fff', color: own ? '#fff' : 'var(--text-primary)' }}>{message.text}</div><div style={{ fontSize: 10 }}>{formatMessageTime(message.createdAt)}{message.readOnly ? ' • Previous correspondence (read-only)' : ''}</div></div>;
};
const StatusNotice = ({ text }: { text: string }) => <div style={{ margin: 'auto', padding: 20, textAlign: 'center', color: 'var(--text-tertiary)' }}>{text}</div>;
const ErrorNotice = ({ message, onRetry }: { message: string; onRetry: () => void }) => <div role="alert" style={{ margin: 16, padding: 12, color: 'var(--status-alert)' }}><AlertCircle size={16} /> {message} <button type="button" className="btn btn-ghost" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>;
