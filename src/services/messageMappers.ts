import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type MessageSenderRole = 'clinician' | 'patient';

export interface ProductionMessage {
  id: string;
  threadId: string;
  patientId: string;
  clinicianId: string;
  senderId: string;
  senderRole: MessageSenderRole;
  text: string;
  createdAt: Date | null;
}

export interface ProductionMessageThread {
  id: string;
  patientId: string;
  clinicianId: string;
  lastMessageText: string | null;
  lastSenderId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

type TimestampLike = { toDate?: () => Date; seconds?: number };

export function mapMessageDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === 'object') {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof timestamp.seconds === 'number') {
      const date = new Date(timestamp.seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const requiredString = (data: DocumentData, key: string): string | null => {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

export function mapMessageDocument(
  snapshot: Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>,
  threadId: string,
): ProductionMessage | null {
  const data = snapshot.data();
  const patientId = requiredString(data, 'patientId');
  const clinicianId = requiredString(data, 'clinicianId');
  const senderId = requiredString(data, 'senderId');
  const text = requiredString(data, 'text');
  const senderRole = data.senderRole;
  if (!patientId || !clinicianId || !senderId || !text) return null;
  if (senderRole !== 'clinician' && senderRole !== 'patient') return null;
  if (
    (senderRole === 'patient' && senderId !== patientId) ||
    (senderRole === 'clinician' && senderId !== clinicianId)
  ) return null;

  return {
    id: snapshot.id,
    threadId,
    patientId,
    clinicianId,
    senderId,
    senderRole,
    text,
    createdAt: mapMessageDate(data.createdAt),
  };
}

export function mapThreadDocument(
  snapshot: Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>,
): ProductionMessageThread | null {
  const data = snapshot.data();
  const patientId = requiredString(data, 'patientId');
  const clinicianId = requiredString(data, 'clinicianId');
  if (!patientId || !clinicianId || snapshot.id !== patientId) return null;
  const lastMessageText = typeof data.lastMessageText === 'string' && data.lastMessageText.trim()
    ? data.lastMessageText
    : null;
  const lastSenderId = typeof data.lastSenderId === 'string' && data.lastSenderId.trim()
    ? data.lastSenderId
    : null;

  return {
    id: snapshot.id,
    patientId,
    clinicianId,
    lastMessageText,
    lastSenderId,
    lastMessageAt: mapMessageDate(data.lastMessageAt),
    createdAt: mapMessageDate(data.createdAt),
    updatedAt: mapMessageDate(data.updatedAt),
  };
}

export function compareMessagesAscending(a: ProductionMessage, b: ProductionMessage): number {
  const timeDifference = (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
    (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
  return timeDifference || a.id.localeCompare(b.id);
}

export function formatMessageTime(value: Date | null, now = new Date()): string {
  if (!value) return 'Sending time unavailable';
  const sameDay = value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() && value.getDate() === now.getDate();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).format(value);
}
