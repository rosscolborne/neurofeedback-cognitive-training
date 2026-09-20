import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessagePageCursor, MessageRepository, PreparedMessage } from '../../services/messageRepository';
import { compareMessagesAscending, type MessageRelationship, type ProductionMessage } from '../../services/messageMappers';

export type ConversationLoadState = 'idle' | 'loading' | 'ready' | 'error';

const mergeMessages = (current: ProductionMessage[], incoming: ProductionMessage[]) => {
  const byId = new Map(current.map((message) => [`${message.source}:${message.id}`, message]));
  incoming.forEach((message) => byId.set(`${message.source}:${message.id}`, message));
  return [...byId.values()].sort(compareMessagesAscending);
};

export function useMessageConversation(patientId: string | null, repository: MessageRepository) {
  const [relationship, setRelationship] = useState<MessageRelationship | null>(null);
  const [messages, setMessages] = useState<ProductionMessage[]>([]);
  const [loadState, setLoadState] = useState<ConversationLoadState>(patientId ? 'loading' : 'idle');
  const [loadPatientId, setLoadPatientId] = useState<string | null>(patientId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [cursor, setCursor] = useState<MessagePageCursor | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [failedAttempts, setFailedAttempts] = useState<Record<string, PreparedMessage | undefined>>({});
  const [sendErrors, setSendErrors] = useState<Record<string, string | undefined>>({});
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let listenerFailed = false;
    let unsubscribe = () => {};
    requestVersionRef.current += 1;
    if (!patientId) {
      // oxlint-disable-next-line react/set-state-in-effect -- clear prior patient's protected content immediately
      setRelationship(null); setMessages([]); setLoadPatientId(null); setLoadState('idle'); setLoadError(null); setCursor(null);
      return;
    }
    setRelationship(null); setMessages([]); setCursor(null); setLoadPatientId(patientId); setLoadState('loading'); setLoadError(null);
    void repository.resolveActiveRelationship(patientId).then(async (resolved) => {
      if (disposed) return;
      setRelationship(resolved);
      unsubscribe = repository.subscribeToMessages(resolved, (liveMessages) => {
        if (disposed) return;
        setMessages((current) => mergeMessages(current, liveMessages));
      }, (error) => {
        if (disposed) return;
        listenerFailed = true;
        setLoadState('error'); setLoadError(error.message);
      }, 50);
      const [, page, legacy] = await Promise.all([
        repository.getRelationshipThread(resolved),
        repository.listMessages(resolved, 50),
        repository.listLegacyMessages(resolved),
      ]);
      if (disposed) return;
      setMessages((current) => mergeMessages(mergeMessages(page.messages, legacy), current));
      setCursor(page.nextCursor);
      if (!listenerFailed) setLoadState('ready');
    }).catch((error) => {
      if (disposed) return;
      setLoadState('error'); setLoadError(error instanceof Error ? error.message : 'Messages are unavailable.');
    });
    return () => { disposed = true; unsubscribe(); };
  }, [patientId, reloadToken, repository]);

  const relationshipIsCurrent = !!relationship && relationship.patientId === patientId;
  const activeRelationship = relationshipIsCurrent ? relationship : null;
  const key = activeRelationship?.key ?? (patientId ? `pending:${patientId}` : 'none');
  const draft = drafts[key] ?? '';
  const failedAttempt = activeRelationship ? failedAttempts[activeRelationship.key] ?? null : null;
  const sendError = activeRelationship ? sendErrors[activeRelationship.key] ?? null : null;
  const isSending = activeRelationship?.key === sendingKey;

  const setDraft = useCallback((text: string) => {
    setDrafts((current) => ({ ...current, [key]: text }));
    if (activeRelationship) {
      setFailedAttempts((current) => ({ ...current, [activeRelationship.key]: undefined }));
      setSendErrors((current) => ({ ...current, [activeRelationship.key]: undefined }));
    }
  }, [activeRelationship, key]);

  const sendAttempt = useCallback(async (attempt: PreparedMessage) => {
    if (!activeRelationship || attempt.relationship.key !== activeRelationship.key) throw new Error('This retry belongs to a different conversation.');
    setSendingKey(activeRelationship.key);
    setSendErrors((current) => ({ ...current, [activeRelationship.key]: undefined }));
    try {
      await repository.sendPreparedMessage(attempt);
      setDrafts((current) => ({ ...current, [activeRelationship.key]: '' }));
      setFailedAttempts((current) => ({ ...current, [activeRelationship.key]: undefined }));
    } catch (error) {
      setDrafts((current) => ({ ...current, [activeRelationship.key]: attempt.text }));
      setFailedAttempts((current) => ({ ...current, [activeRelationship.key]: attempt }));
      setSendErrors((current) => ({ ...current, [activeRelationship.key]: error instanceof Error ? error.message : 'Message not sent. Try again.' }));
    } finally {
      setSendingKey((current) => current === activeRelationship.key ? null : current);
    }
  }, [activeRelationship, repository]);

  const send = useCallback(async () => {
    if (!activeRelationship) throw new Error('The conversation is still loading.');
    await sendAttempt(repository.prepareMessage(activeRelationship, draft));
  }, [activeRelationship, draft, repository, sendAttempt]);

  const retry = useCallback(async () => {
    if (!activeRelationship || !failedAttempt || failedAttempt.relationship.key !== activeRelationship.key) throw new Error('There is no retry for this conversation.');
    await sendAttempt(failedAttempt);
  }, [activeRelationship, failedAttempt, sendAttempt]);

  const loadOlder = useCallback(async () => {
    if (!activeRelationship || !cursor || cursor.relationshipKey !== activeRelationship.key) return;
    const requestedVersion = requestVersionRef.current;
    const requestedRelationshipKey = activeRelationship.key;
    setIsLoadingOlder(true);
    try {
      const page = await repository.listMessages(activeRelationship, 50, cursor);
      if (requestVersionRef.current !== requestedVersion || patientId !== activeRelationship.patientId || page.nextCursor && page.nextCursor.relationshipKey !== requestedRelationshipKey) return;
      setMessages((current) => mergeMessages(current, page.messages));
      setCursor(page.nextCursor);
    } catch (error) {
      setLoadState('error'); setLoadError(error instanceof Error ? error.message : 'Older messages are unavailable.');
    } finally { setIsLoadingOlder(false); }
  }, [activeRelationship, cursor, patientId, repository]);

  return useMemo(() => ({
    relationship: activeRelationship,
    messages: activeRelationship ? messages.filter((message) => message.relationshipKey === activeRelationship.key) : [],
    loadState: loadPatientId === patientId ? loadState : 'loading' as const,
    loadError: loadPatientId === patientId ? loadError : null,
    retryLoad: () => setReloadToken((value) => value + 1),
    cursor: activeRelationship && cursor?.relationshipKey === activeRelationship.key ? cursor : null,
    isLoadingOlder: !!activeRelationship && isLoadingOlder, loadOlder, draft, setDraft, failedAttempt, sendError, isSending, send, retry,
  }), [activeRelationship, cursor, draft, failedAttempt, isLoadingOlder, isSending, loadError, loadOlder, loadPatientId, loadState, messages, patientId, retry, send, sendError, setDraft]);
}
