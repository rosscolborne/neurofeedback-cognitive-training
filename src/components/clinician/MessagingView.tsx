import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, MessageSquare, RefreshCw, Search, Send } from 'lucide-react';
import type { MessageThread } from '../../types';
import { messageRepository, type MessagePageCursor, type MessageRepository, type PreparedMessage } from '../../services/messageRepository';
import { compareMessagesAscending, formatMessageTime, type ProductionMessage, type ProductionMessageThread } from '../../services/messageMappers';
import { getMessageSendViewState } from '../messaging/messageUiState';

export interface MessagingParticipant {
  patientId: string;
  name: string;
}

interface MessagingViewProps {
  /** Legacy metadata only. Canonical messages are always loaded from the repository. */
  threads?: MessageThread[];
  selectedClientId?: string;
  /** Retained until central App/ClinicianShell wiring removes the legacy callback. */
  onSendMessage?: (clientId: string, text: string) => void | Promise<void>;
  participants?: MessagingParticipant[];
  repository?: MessageRepository;
}

const QUICK_TEMPLATES = [
  'How did your most recent training session feel?',
  'Please let me know if you had any trouble with your headset.',
  'Would you like to schedule a protocol check-in?',
];

type SendState = 'idle' | 'sending' | 'failed';

export const MessagingView: React.FC<MessagingViewProps> = ({
  threads = [], participants = [], selectedClientId, repository = messageRepository,
}) => {
  const [threadSummaries, setThreadSummaries] = useState<ProductionMessageThread[]>([]);
  const [activePatientId, setActivePatientId] = useState<string | null>(selectedClientId ?? null);
  const [messages, setMessages] = useState<ProductionMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [failedAttempt, setFailedAttempt] = useState<PreparedMessage | null>(null);
  const [pagination, setPagination] = useState<{ patientId: string; cursor: MessagePageCursor | null } | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    return repository.subscribeToThreads((nextThreads) => {
      setThreadSummaries(nextThreads);
      setLoadError(null);
    }, (error) => setLoadError(error.message));
  }, [repository]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- synchronize explicit navigation from the patient detail route
    if (selectedClientId) setActivePatientId(selectedClientId);
  }, [selectedClientId]);

  useEffect(() => {
    if (!activePatientId) {
      return;
    }
    void repository.listMessages(activePatientId, 50).then((page) => {
      setMessages((current) => mergeMessages(current, page.messages));
      setPagination({ patientId: activePatientId, cursor: page.nextCursor });
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Messages are unavailable.'));
    return repository.subscribeToMessages(activePatientId, (nextMessages) => {
      setMessages((current) => mergeMessages(current, nextMessages));
      setLoadError(null);
    }, (error) => setLoadError(error.message), 50);
  }, [activePatientId, repository]);

  useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  const legacyMetadata = useMemo(() => new Map(threads.map((thread) => [thread.clientId, thread])), [threads]);
  const participantNames = useMemo(() => new Map(participants.map((participant) => [participant.patientId, participant.name])), [participants]);
  const conversationIds = useMemo(() => {
    const ids = new Set(threadSummaries.map((thread) => thread.patientId));
    participants.forEach((participant) => ids.add(participant.patientId));
    if (selectedClientId) ids.add(selectedClientId);
    return [...ids];
  }, [participants, threadSummaries, selectedClientId]);
  const filteredConversationIds = conversationIds.filter((patientId) => {
    const name = participantNames.get(patientId) || legacyMetadata.get(patientId)?.clientName || 'Patient';
    return name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });
  const activeName = activePatientId ? participantNames.get(activePatientId) || legacyMetadata.get(activePatientId)?.clientName || 'Patient' : null;
  const sendView = getMessageSendViewState(inputText, sendState === 'sending', failedAttempt, sendError);
  const visibleMessages = activePatientId ? messages.filter((message) => message.patientId === activePatientId) : [];

  const loadOlder = async () => {
    if (!activePatientId || pagination?.patientId !== activePatientId || !pagination.cursor) return;
    setIsLoadingOlder(true);
    try {
      const page = await repository.listMessages(activePatientId, 50, pagination.cursor);
      setMessages((current) => mergeMessages(current, page.messages));
      setPagination({ patientId: activePatientId, cursor: page.nextCursor });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Older messages are unavailable.');
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const sendAttempt = async (attempt: PreparedMessage) => {
    setSendState('sending');
    setSendError(null);
    try {
      await repository.sendPreparedMessage(attempt);
      setInputText('');
      setFailedAttempt(null);
      setSendState('idle');
    } catch (error) {
      setFailedAttempt(attempt);
      setSendState('failed');
      setSendError(error instanceof Error ? error.message : 'Message not sent. Try again.');
    }
  };

  const handleSend = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activePatientId || !inputText.trim() || sendState === 'sending') return;
    try {
      void sendAttempt(repository.prepareMessage(activePatientId, inputText));
    } catch (error) {
      setSendState('failed');
      setSendError(error instanceof Error ? error.message : 'Message not sent. Try again.');
    }
  };

  return (
    <div className="card-clinician" style={{ padding: 0, height: 'calc(100vh - 160px)', minHeight: 520, display: 'flex', overflow: 'hidden' }}>
      <section style={{ width: activePatientId && !isMobile ? 320 : '100%', display: activePatientId && isMobile ? 'none' : 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-default)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Patient Messages</h2>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', background: 'var(--surface-clinician-sidebar)', borderRadius: 'var(--radius-sm)' }}>
            <Search size={14} /><span className="sr-only">Search conversations</span>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search conversations" style={{ border: 0, outline: 0, background: 'transparent', width: '100%' }} />
          </label>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadError && !activePatientId && <ErrorNotice message={loadError} />}
          {!loadError && filteredConversationIds.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No conversations yet. Open a linked patient and choose Message to begin.</div>}
          {filteredConversationIds.map((patientId) => {
            const metadata = legacyMetadata.get(patientId);
            const summary = threadSummaries.find((thread) => thread.patientId === patientId);
            return (
              <button key={patientId} type="button" onClick={() => setActivePatientId(patientId)} style={{ width: '100%', padding: '12px 16px', border: 0, borderBottom: '1px solid var(--border-subtle)', background: patientId === activePatientId ? 'var(--surface-patient-base)' : '#fff', textAlign: 'left', cursor: 'pointer' }}>
                <strong style={{ display: 'block', fontSize: 13 }}>{participantNames.get(patientId) || metadata?.clientName || 'Patient'}</strong>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{summary?.lastMessageText || 'No messages yet'}</span>
                {summary?.lastMessageAt && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatMessageTime(summary.lastMessageAt)}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section style={{ flex: 1, minWidth: 0, display: activePatientId || !isMobile ? 'flex' : 'none', flexDirection: 'column' }}>
        {activePatientId ? <>
          <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile && <button type="button" className="btn btn-ghost" aria-label="Back to conversations" onClick={() => setActivePatientId(null)}><ArrowLeft size={18} /></button>}
            <div><strong style={{ fontSize: 14 }}>{activeName}</strong><div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Private care-team conversation</div></div>
          </header>
          <div aria-live="polite" style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface-clinician-base)' }}>
            {pagination?.patientId === activePatientId && pagination.cursor && <button type="button" className="btn btn-ghost" disabled={isLoadingOlder} onClick={() => void loadOlder()} style={{ alignSelf: 'center' }}>{isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
            {loadError ? <ErrorNotice message={loadError} /> : visibleMessages.length === 0 ? <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No messages yet. Send the first message when you are ready.</div> : visibleMessages.map((message) => <MessageBubble key={message.id} message={message} ownRole="clinician" />)}
            <div ref={messagesEndRef} />
          </div>
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 6, overflowX: 'auto' }}>
            <MessageSquare size={14} style={{ flexShrink: 0 }} />
            {QUICK_TEMPLATES.map((template) => <button key={template} type="button" onClick={() => setInputText(template)} disabled={sendState === 'sending'} style={{ whiteSpace: 'nowrap', border: '1px solid var(--border-default)', borderRadius: 999, background: '#fff', padding: '4px 10px' }}>{template}</button>)}
          </div>
          {sendView.statusText && sendState === 'failed' && <div role="alert" style={{ padding: '8px 14px', color: 'var(--status-alert)', fontSize: 12 }}>{sendView.statusText}</div>}
          <form onSubmit={handleSend} style={{ padding: '10px 14px', borderTop: '1px solid var(--border-default)', display: 'flex', gap: 8 }}>
            <label className="sr-only" htmlFor="clinician-message-input">Message {activeName}</label>
            <input id="clinician-message-input" value={inputText} onChange={(event) => { setInputText(event.target.value); if (sendState === 'failed') { setSendState('idle'); setFailedAttempt(null); setSendError(null); } }} maxLength={4000} placeholder={`Message ${activeName}`} disabled={sendState === 'sending'} style={{ flex: 1, padding: '9px 12px' }} />
            {sendView.showRetry && failedAttempt ? <button type="button" className="btn btn-dense" onClick={() => void sendAttempt(failedAttempt)}><RefreshCw size={14} /> Retry</button> : <button type="submit" className="btn btn-dense" disabled={!sendView.canSend}><Send size={14} /> {sendState === 'sending' ? 'Sending…' : 'Send'}</button>}
          </form>
        </> : <div style={{ margin: 'auto', color: 'var(--text-tertiary)', textAlign: 'center' }}><MessageSquare size={32} /><div>Select a conversation</div></div>}
      </section>
    </div>
  );
};

export const MessageBubble = ({ message, ownRole }: { message: ProductionMessage; ownRole: 'clinician' | 'patient' }) => {
  const isOwn = message.senderRole === ownRole;
  return <div style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
    <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: isOwn ? '#3A4B58' : '#fff', color: isOwn ? '#fff' : 'var(--text-primary)', border: isOwn ? 0 : '1px solid var(--border-default)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</div>
    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, textAlign: isOwn ? 'right' : 'left' }}>{formatMessageTime(message.createdAt)}</div>
  </div>;
};

const ErrorNotice = ({ message }: { message: string }) => <div role="alert" style={{ margin: 16, padding: 12, color: 'var(--status-alert)', background: 'var(--status-alert-bg)', borderRadius: 'var(--radius-sm)', display: 'flex', gap: 8 }}><AlertCircle size={16} /> <span>{message}</span></div>;

const mergeMessages = (current: ProductionMessage[], incoming: ProductionMessage[]): ProductionMessage[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort(compareMessagesAscending);
};
