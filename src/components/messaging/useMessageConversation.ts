import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [cursor, setCursor] = useState<MessagePageCursor | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [failedAttempts, setFailedAttempts] = useState<Record<string, PreparedMessage | undefined>>({});
  const [sendErrors, setSendErrors] = useState<Record<string, string | undefined>>({});
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let listenerFailed = false;
    let unsubscribe = () => {};
    if (!patientId) {
      // oxlint-disable-next-line react/set-state-in-effect -- clear prior patient's protected content immediately
      setRelationship(null); setMessages([]); setLoadState('idle'); setLoadError(null); setCursor(null);
      return;
    }
    setRelationship(null); setMessages([]); setCursor(null); setLoadState('loading'); setLoadError(null);
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
      const [page, legacy] = await Promise.all([
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

  const key = relationship?.key ?? (patientId ? `pending:${patientId}` : 'none');
  const draft = drafts[key] ?? '';
  const failedAttempt = relationship ? failedAttempts[relationship.key] ?? null : null;
  const sendError = relationship ? sendErrors[relationship.key] ?? null : null;
  const isSending = relationship?.key === sendingKey;

  const setDraft = useCallback((text: string) => {
    setDrafts((current) => ({ ...current, [key]: text }));
    if (relationship) {
      setFailedAttempts((current) => ({ ...current, [relationship.key]: undefined }));
      setSendErrors((current) => ({ ...current, [relationship.key]: undefined }));
    }
  }, [key, relationship]);

  const sendAttempt = useCallback(async (attempt: PreparedMessage) => {
    if (!relationship || attempt.relationship.key !== relationship.key) throw new Error('This retry belongs to a different conversation.');
    setSendingKey(relationship.key);
    setSendErrors((current) => ({ ...current, [relationship.key]: undefined }));
    try {
      await repository.sendPreparedMessage(attempt);
      setDrafts((current) => ({ ...current, [relationship.key]: '' }));
      setFailedAttempts((current) => ({ ...current, [relationship.key]: undefined }));
    } catch (error) {
      setDrafts((current) => ({ ...current, [relationship.key]: attempt.text }));
      setFailedAttempts((current) => ({ ...current, [relationship.key]: attempt }));
      setSendErrors((current) => ({ ...current, [relationship.key]: error instanceof Error ? error.message : 'Message not sent. Try again.' }));
    } finally {
      setSendingKey((current) => current === relationship.key ? null : current);
    }
  }, [relationship, repository]);

  const send = useCallback(async () => {
    if (!relationship) throw new Error('The conversation is still loading.');
    await sendAttempt(repository.prepareMessage(relationship, draft));
  }, [draft, relationship, repository, sendAttempt]);

  const retry = useCallback(async () => {
    if (!relationship || !failedAttempt || failedAttempt.relationship.key !== relationship.key) throw new Error('There is no retry for this conversation.');
    await sendAttempt(failedAttempt);
  }, [failedAttempt, relationship, sendAttempt]);

  const loadOlder = useCallback(async () => {
    if (!relationship || !cursor || cursor.relationshipKey !== relationship.key) return;
    setIsLoadingOlder(true);
    try {
      const page = await repository.listMessages(relationship, 50, cursor);
      setMessages((current) => mergeMessages(current, page.messages));
      setCursor(page.nextCursor);
    } catch (error) {
      setLoadState('error'); setLoadError(error instanceof Error ? error.message : 'Older messages are unavailable.');
    } finally { setIsLoadingOlder(false); }
  }, [cursor, relationship, repository]);

  return useMemo(() => ({
    relationship, messages, loadState, loadError, retryLoad: () => setReloadToken((value) => value + 1),
    cursor, isLoadingOlder, loadOlder, draft, setDraft, failedAttempt, sendError, isSending, send, retry,
  }), [relationship, messages, loadState, loadError, cursor, isLoadingOlder, loadOlder, draft, setDraft, failedAttempt, sendError, isSending, send, retry]);
}
