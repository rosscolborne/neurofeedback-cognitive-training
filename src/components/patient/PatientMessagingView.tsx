import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { MessageBubble } from '../clinician/MessagingView';
import { messageRepository, type MessagePageCursor, type MessageRepository, type PreparedMessage } from '../../services/messageRepository';
import { compareMessagesAscending, type ProductionMessage } from '../../services/messageMappers';
import { getMessageSendViewState } from '../messaging/messageUiState';

interface PatientMessagingViewProps { patientId: string; clinicianName?: string; repository?: MessageRepository; }

export const PatientMessagingView: React.FC<PatientMessagingViewProps> = ({ patientId, clinicianName = 'Your clinician', repository = messageRepository }) => {
  const [messages, setMessages] = useState<ProductionMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [failedAttempt, setFailedAttempt] = useState<PreparedMessage | null>(null);
  const [nextCursor, setNextCursor] = useState<MessagePageCursor | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const sendView = getMessageSendViewState(inputText, isSending, failedAttempt, sendError);

  useEffect(() => {
    void repository.listMessages(patientId, 50).then((page) => {
      setMessages((current) => mergeMessages(current, page.messages));
      setNextCursor(page.nextCursor);
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Messages are unavailable.'));
    return repository.subscribeToMessages(patientId, (nextMessages) => {
      setMessages((current) => mergeMessages(current, nextMessages));
      setLoadError(null);
    }, (error) => setLoadError(error.message), 50);
  }, [patientId, repository]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  const send = async (attempt: PreparedMessage) => {
    setIsSending(true); setSendError(null);
    try { await repository.sendPreparedMessage(attempt); setInputText(''); setFailedAttempt(null); }
    catch (error) { setFailedAttempt(attempt); setSendError(error instanceof Error ? error.message : 'Message not sent. Try again.'); }
    finally { setIsSending(false); }
  };
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputText.trim() || isSending) return;
    try { void send(repository.prepareMessage(patientId, inputText)); }
    catch (error) { setSendError(error instanceof Error ? error.message : 'Message not sent. Try again.'); }
  };
  const loadOlder = async () => {
    if (!nextCursor) return;
    setIsLoadingOlder(true);
    try {
      const page = await repository.listMessages(patientId, 50, nextCursor);
      setMessages((current) => mergeMessages(current, page.messages));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Older messages are unavailable.');
    } finally {
      setIsLoadingOlder(false);
    }
  };
  const visibleMessages = messages.filter((message) => message.patientId === patientId);

  return <section aria-label="Messages" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 150px)', background: 'var(--surface-patient-base)' }}>
    <header style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-default)' }}><h1 style={{ margin: 0, fontSize: 20 }}>Messages</h1><div style={{ marginTop: 3, color: 'var(--text-secondary)', fontSize: 13 }}>{clinicianName}</div></header>
    <div aria-live="polite" style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {nextCursor && <button type="button" className="btn btn-ghost" disabled={isLoadingOlder} onClick={() => void loadOlder()} style={{ alignSelf: 'center' }}>{isLoadingOlder ? 'Loading…' : 'Load older messages'}</button>}
      {loadError ? <div role="alert" style={{ color: 'var(--status-alert)' }}>{loadError}</div> : visibleMessages.length === 0 ? <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-tertiary)' }}>No messages yet. You can start a conversation with your clinician here.</div> : visibleMessages.map((message) => <MessageBubble key={message.id} message={message} ownRole="patient" />)}<div ref={endRef} />
    </div>
    {sendView.statusText && !isSending && <div role="alert" style={{ padding: '8px 16px', color: 'var(--status-alert)' }}>{sendView.statusText}</div>}
    <form onSubmit={handleSubmit} style={{ padding: 12, borderTop: '1px solid var(--border-default)', display: 'flex', gap: 8, background: '#fff' }}>
      <label className="sr-only" htmlFor="patient-message-input">Message your clinician</label>
      <input id="patient-message-input" value={inputText} maxLength={4000} disabled={isSending} onChange={(event) => { setInputText(event.target.value); if (failedAttempt) { setFailedAttempt(null); setSendError(null); } }} placeholder="Message your clinician" style={{ flex: 1, padding: '10px 12px' }} />
      {sendView.showRetry && failedAttempt ? <button type="button" className="btn btn-primary" onClick={() => void send(failedAttempt)}><RefreshCw size={16} /> Retry</button> : <button type="submit" className="btn btn-primary" disabled={!sendView.canSend}><Send size={16} /> {isSending ? 'Sending…' : 'Send'}</button>}
    </form>
  </section>;
};

const mergeMessages = (current: ProductionMessage[], incoming: ProductionMessage[]): ProductionMessage[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort(compareMessagesAscending);
};
