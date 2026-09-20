import type { PreparedMessage } from '../../services/messageRepository';

export interface MessageSendViewState {
  canSend: boolean;
  showRetry: boolean;
  statusText: string | null;
}

export function getMessageSendViewState(
  inputText: string,
  isSending: boolean,
  failedAttempt: PreparedMessage | null,
  error: string | null,
): MessageSendViewState {
  const normalized = inputText.trim();
  return {
    canSend: normalized.length > 0 && !isSending,
    showRetry: !isSending && !!failedAttempt && failedAttempt.text === normalized,
    statusText: isSending ? 'Sending…' : error ? `Message not sent. ${error}` : null,
  };
}
