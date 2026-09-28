import { useEffect, useRef, useState } from 'react';
import type { MessageRepository } from '../../services/messageRepository';
import type { MessageRelationship, MessageUnreadStatus, ProductionMessage } from '../../services/messageMappers';
import type { ConversationLoadState } from './useMessageConversation';

interface MessageNotificationState {
  scope: string;
  byPatient: Record<string, MessageUnreadStatus>;
  errors: Record<string, string>;
}

export function useMessageUnread(patientIds: string[], repository: MessageRepository, enabled = true, relationshipScope = '') {
  const patientIdsKey = JSON.stringify([...new Set(patientIds)].sort());
  const scope = `${patientIdsKey}:${relationshipScope}:${enabled}`;
  const [notificationState, setNotificationState] = useState<MessageNotificationState>({ scope, byPatient: {}, errors: {} });

  useEffect(() => {
    if (!enabled) return;
    const ids = JSON.parse(patientIdsKey) as string[];
    const unsubscribers = ids.map((patientId) => repository.subscribeToUnread(patientId, (status) => {
      setNotificationState((current) => {
        const base = current.scope === scope ? current : { scope, byPatient: {}, errors: {} };
        const errors = { ...base.errors }; delete errors[patientId];
        return { scope, byPatient: { ...base.byPatient, [patientId]: status }, errors };
      });
    }, (error) => {
      setNotificationState((current) => {
        const base = current.scope === scope ? current : { scope, byPatient: {}, errors: {} };
        const byPatient = { ...base.byPatient }; delete byPatient[patientId];
        return { scope, byPatient, errors: { ...base.errors, [patientId]: error.message } };
      });
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [enabled, patientIdsKey, repository, scope]);

  const activeIds = JSON.parse(patientIdsKey) as string[];
  const current: MessageNotificationState = notificationState.scope === scope ? notificationState : { scope, byPatient: {}, errors: {} };
  return {
    byPatient: current.byPatient,
    error: enabled ? activeIds.map((id) => current.errors[id]).find(Boolean) ?? null : null,
    isComplete: enabled && activeIds.every((id) => Boolean(current.byPatient[id]) && !current.errors[id]),
  };
}

export function useMarkVisibleMessageRead(
  relationship: MessageRelationship | null,
  messages: ProductionMessage[],
  loadState: ConversationLoadState,
  unreadMessageId: string | null | undefined,
  repository: MessageRepository,
) {
  const lastAttempt = useRef<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const relationshipKey = relationship?.key;

  useEffect(() => { lastAttempt.current = null; }, [relationshipKey]);
  useEffect(() => {
    if (!relationship || loadState !== 'ready' || !unreadMessageId) return;
    if (!messages.some((message) => message.source === 'canonical' && message.id === unreadMessageId && message.relationshipKey === relationship.key)) return;
    const attemptKey = `${relationship.key}:${unreadMessageId}`;
    if (lastAttempt.current === attemptKey) return;
    lastAttempt.current = attemptKey;
    void repository.markThreadRead(relationship, unreadMessageId).catch((error: unknown) => {
      setFailure({ key: relationship.key, message: error instanceof Error ? error.message : 'Could not mark this message as read.' });
    });
  }, [loadState, messages, relationship, repository, unreadMessageId]);

  return failure && failure.key === relationshipKey && unreadMessageId ? failure.message : null;
}
