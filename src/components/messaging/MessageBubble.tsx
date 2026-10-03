import { formatMessageTime, type ProductionMessage } from '../../services/messageMappers';

export const MessageBubble = ({ message, ownRole }: { message: ProductionMessage; ownRole: 'clinician' | 'patient' }) => {
  const own = message.senderRole === ownRole;
  return <div style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '82%' }}><div style={{ padding: '10px 14px', borderRadius: 12, border: own ? '1px solid transparent' : '1px solid var(--border-subtle)', background: own ? '#3A4B58' : '#fff', color: own ? '#fff' : 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</div><div style={{ marginTop: 4, padding: '0 4px', fontSize: 11, color: 'var(--text-tertiary)', textAlign: own ? 'right' : 'left' }}>{formatMessageTime(message.createdAt)}{message.readOnly ? ' • Previous correspondence (read-only)' : ''}</div></div>;
};
