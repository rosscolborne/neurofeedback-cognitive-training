import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type MessageSenderRole = 'clinician' | 'patient';
export type MessageSource = 'canonical' | 'legacy';
export interface MessageRelationship { patientId: string; clinicianId: string; key: string; }
export interface ProductionMessage {
  id: string; relationshipKey: string; patientId: string; clinicianId: string;
  senderId: string; senderRole: MessageSenderRole; text: string; createdAt: Date | null;
  source: MessageSource; readOnly: boolean;
}
export interface ProductionMessageThread {
  id: string; relationshipKey: string; patientId: string; clinicianId: string;
  lastMessageText: string | null; lastMessageId: string | null; lastSenderId: string | null;
  lastMessageAt: Date | null; createdAt: Date | null; updatedAt: Date | null;
}

type TimestampLike = { toDate?: () => Date; seconds?: number };
export const relationshipKey = (patientId: string, clinicianId: string) => `${patientId}/${clinicianId}`;

export function mapMessageDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === 'object') {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') { const date = timestamp.toDate(); return Number.isNaN(date.getTime()) ? null : date; }
    if (typeof timestamp.seconds === 'number') { const date = new Date(timestamp.seconds * 1000); return Number.isNaN(date.getTime()) ? null : date; }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}|^[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(value)) return null;
    const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const requiredString = (data: DocumentData, key: string): string | null => {
  const value = data[key];
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : null;
};

export function mapMessageDocument(snapshot: Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>, relationship: MessageRelationship): ProductionMessage | null {
  const data = snapshot.data();
  const patientId = requiredString(data, 'patientId'); const clinicianId = requiredString(data, 'clinicianId');
  const senderId = requiredString(data, 'senderId'); const text = requiredString(data, 'text'); const senderRole = data.senderRole;
  if (patientId !== relationship.patientId || clinicianId !== relationship.clinicianId || !senderId || !text) return null;
  if (senderRole !== 'clinician' && senderRole !== 'patient') return null;
  if ((senderRole === 'patient' && senderId !== patientId) || (senderRole === 'clinician' && senderId !== clinicianId)) return null;
  return { id: snapshot.id, relationshipKey: relationship.key, patientId, clinicianId, senderId, senderRole, text, createdAt: mapMessageDate(data.createdAt), source: 'canonical', readOnly: false };
}

export function mapThreadDocument(snapshot: Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>): ProductionMessageThread | null {
  const data = snapshot.data(); const patientId = requiredString(data, 'patientId'); const clinicianId = requiredString(data, 'clinicianId');
  if (!patientId || !clinicianId || snapshot.id !== clinicianId) return null;
  const participants = data.participantIds;
  if (!Array.isArray(participants) || participants.length !== 2 || participants[0] !== patientId || participants[1] !== clinicianId) return null;
  return {
    id: snapshot.id, relationshipKey: relationshipKey(patientId, clinicianId), patientId, clinicianId,
    lastMessageText: requiredString(data, 'lastMessageText'), lastMessageId: requiredString(data, 'lastMessageId'),
    lastSenderId: requiredString(data, 'lastSenderId'), lastMessageAt: mapMessageDate(data.lastMessageAt),
    createdAt: mapMessageDate(data.createdAt), updatedAt: mapMessageDate(data.updatedAt),
  };
}

interface LegacyMessageItem { id?: unknown; sender?: unknown; text?: unknown; timestamp?: unknown; }
export function mapLegacyMessageThread(data: DocumentData, relationship: MessageRelationship): ProductionMessage[] {
  const patientId = typeof data.patientId === 'string' ? data.patientId : data.clientId;
  if (patientId !== relationship.patientId || data.clinicianId !== relationship.clinicianId || data.isDemo === true || relationship.patientId.startsWith('demo-')) return [];
  if (!Array.isArray(data.messages)) throw new Error('Legacy message history is malformed.');
  return data.messages.flatMap((item: LegacyMessageItem, index: number) => {
    if (!item || typeof item.text !== 'string' || !item.text.trim() || (item.sender !== 'patient' && item.sender !== 'clinician')) return [];
    const senderRole: MessageSenderRole = item.sender; const senderId = senderRole === 'patient' ? relationship.patientId : relationship.clinicianId;
    const legacyId = typeof item.id === 'string' && item.id.trim() ? item.id : String(index);
    return [{ id: `legacy:${relationship.key}:${legacyId}`, relationshipKey: relationship.key, patientId: relationship.patientId, clinicianId: relationship.clinicianId, senderId, senderRole, text: item.text.trim(), createdAt: mapMessageDate(item.timestamp), source: 'legacy' as const, readOnly: true }];
  }).sort(compareMessagesAscending);
}

export function compareMessagesAscending(a: ProductionMessage, b: ProductionMessage): number {
  return (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
}
export function formatMessageTime(value: Date | null, now = new Date()): string {
  if (!value) return 'Time unavailable';
  const sameDay = value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth() && value.getDate() === now.getDate();
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
}
