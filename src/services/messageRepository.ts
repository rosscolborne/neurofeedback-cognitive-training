import {
  collection, doc, documentId, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, runTransaction, serverTimestamp, startAfter,
  type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  compareMessagesAscending, mapLegacyMessageThread, mapMessageDocument, mapThreadDocument,
  relationshipKey, type MessageRelationship, type MessageSenderRole,
  type ProductionMessage, type ProductionMessageThread,
} from './messageMappers';
import { isClinicianDemoWorkspace } from './clinicianDemoBoundary';

const MAX_MESSAGE_LENGTH = 4000; const DEFAULT_PAGE_SIZE = 30; const MAX_PAGE_SIZE = 100;
export interface MessagePageCursor { relationshipKey: string; createdAt: unknown; id: string; }
export interface MessagePage { messages: ProductionMessage[]; nextCursor: MessagePageCursor | null; }
export interface PreparedMessage { id: string; relationship: MessageRelationship; text: string; }
export interface MessageRepository {
  resolveActiveRelationship(patientId: string): Promise<MessageRelationship>;
  getRelationshipThread(relationship: MessageRelationship): Promise<ProductionMessageThread | null>;
  listMessages(relationship: MessageRelationship, pageSize?: number, cursor?: MessagePageCursor): Promise<MessagePage>;
  listLegacyMessages(relationship: MessageRelationship): Promise<ProductionMessage[]>;
  subscribeToMessages(relationship: MessageRelationship, callback: (messages: ProductionMessage[]) => void, onError: (error: Error) => void, pageSize?: number): Unsubscribe;
  prepareMessage(relationship: MessageRelationship, text: string): PreparedMessage;
  sendPreparedMessage(message: PreparedMessage): Promise<ProductionMessage>;
}

interface AuthorizedRelationship extends MessageRelationship { senderId: string; senderRole: MessageSenderRole; }
const asError = (error: unknown) => error instanceof Error ? error : new Error('Messaging is unavailable.');
const currentUserId = () => {
  if (isClinicianDemoWorkspace()) throw new Error('Messaging is unavailable in the sample clinician workspace.');
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to use messaging.');
  return uid;
};
const normalizeText = (text: string) => { const normalized = text.trim(); if (!normalized) throw new Error('Enter a message before sending.'); if (normalized.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`); return normalized; };

function activeClinicianId(patient: DocumentData): string {
  const canonical = patient.clinicianId;
  if (canonical !== null && canonical !== undefined) {
    if (typeof canonical !== 'string' || canonical.length === 0 || canonical.trim() !== canonical) throw new Error('This patient relationship is malformed.');
    return canonical;
  }
  const legacy = patient.linkedClinicianCode;
  if (typeof legacy === 'string' && legacy.length > 0 && legacy.trim() === legacy) return legacy;
  throw new Error('Connect with a clinician before using messaging.');
}

async function resolveAuthorizedRelationship(patientId: string, expectedClinicianId?: string): Promise<AuthorizedRelationship> {
  const senderId = currentUserId();
  if (!patientId || patientId.trim() !== patientId) throw new Error('A valid patient is required to open a conversation.');
  const snapshot = await getDoc(doc(db, 'clients', patientId));
  if (!snapshot.exists()) throw new Error('This patient relationship is unavailable.');
  const clinicianId = activeClinicianId(snapshot.data());
  if (expectedClinicianId && expectedClinicianId !== clinicianId) throw new Error('This care relationship is no longer active.');
  if (senderId !== patientId && senderId !== clinicianId) throw new Error('You do not have access to this conversation.');
  return { patientId, clinicianId, key: relationshipKey(patientId, clinicianId), senderId, senderRole: senderId === patientId ? 'patient' : 'clinician' };
}

const relationshipRef = (value: MessageRelationship) => doc(db, 'messageThreads', value.patientId, 'relationships', value.clinicianId);
const messagesRef = (value: MessageRelationship) => collection(db, 'messageThreads', value.patientId, 'relationships', value.clinicianId, 'messages');
const mapMessages = (documents: Array<QueryDocumentSnapshot<DocumentData>>, value: MessageRelationship) => documents.map((snapshot) => mapMessageDocument(snapshot, value)).filter((message): message is ProductionMessage => message !== null).sort(compareMessagesAscending);
const boundedPageSize = (value: number) => Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number.isFinite(value) ? value : DEFAULT_PAGE_SIZE)));
const isPermissionDenied = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'permission-denied' || code === 'firestore/permission-denied';
};

export const messageRepository: MessageRepository = {
  async resolveActiveRelationship(patientId) {
    const value = await resolveAuthorizedRelationship(patientId);
    return { patientId: value.patientId, clinicianId: value.clinicianId, key: value.key };
  },
  async getRelationshipThread(relationship) {
    const active = await resolveAuthorizedRelationship(relationship.patientId, relationship.clinicianId);
    if (active.key !== relationship.key) throw new Error('This conversation identity is invalid.');
    const snapshot = await getDoc(relationshipRef(active));
    if (!snapshot.exists()) return null;
    const mapped = mapThreadDocument(snapshot);
    return mapped?.relationshipKey === active.key ? mapped : null;
  },
  async listMessages(relationship, requestedPageSize = DEFAULT_PAGE_SIZE, cursor) {
    const active = await resolveAuthorizedRelationship(relationship.patientId, relationship.clinicianId);
    if (relationship.key !== active.key) throw new Error('This conversation identity is invalid.');
    if (cursor && cursor.relationshipKey !== active.key) throw new Error('This message page belongs to a different conversation.');
    const pageSize = boundedPageSize(requestedPageSize);
    const snapshot = await getDocs(query(messagesRef(active), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []), limit(pageSize)));
    const last = snapshot.docs.at(-1);
    return { messages: mapMessages(snapshot.docs, active), nextCursor: snapshot.docs.length === pageSize && last ? { relationshipKey: active.key, createdAt: last.data().createdAt, id: last.id } : null };
  },
  async listLegacyMessages(relationship) {
    const active = await resolveAuthorizedRelationship(relationship.patientId, relationship.clinicianId);
    if (active.key !== relationship.key) throw new Error('This conversation identity is invalid.');
    try {
      const snapshot = await getDoc(doc(db, 'messages', relationship.patientId));
      return snapshot.exists() ? mapLegacyMessageThread(snapshot.data(), active) : [];
    } catch (error) {
      // A relinked patient can have a legacy document owned by the former
      // clinician. Hardened rules deny that direct read; canonical history must
      // remain usable. Transport, offline, and data errors still propagate.
      if (isPermissionDenied(error)) return [];
      throw error;
    }
  },
  subscribeToMessages(relationship, callback, onError, requestedPageSize = DEFAULT_PAGE_SIZE) {
    let unsubscribe: Unsubscribe = () => {}; let disposed = false;
    void resolveAuthorizedRelationship(relationship.patientId, relationship.clinicianId).then((active) => {
      if (disposed) return; if (active.key !== relationship.key) throw new Error('This conversation identity is invalid.');
      const live = onSnapshot(query(messagesRef(active), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(boundedPageSize(requestedPageSize))), { includeMetadataChanges: true }, (snapshot) => { if (disposed || snapshot.metadata.hasPendingWrites) return; callback(mapMessages(snapshot.docs, active)); }, (error) => { if (!disposed) onError(asError(error)); });
      if (disposed) live(); else unsubscribe = live;
    }).catch((error) => { if (!disposed) onError(asError(error)); });
    return () => { disposed = true; unsubscribe(); };
  },
  prepareMessage(relationship, text) {
    currentUserId(); if (relationship.key !== relationshipKey(relationship.patientId, relationship.clinicianId)) throw new Error('This conversation identity is invalid.');
    const reference = doc(messagesRef(relationship)); return { id: reference.id, relationship, text: normalizeText(text) };
  },
  async sendPreparedMessage(prepared) {
    const active = await resolveAuthorizedRelationship(prepared.relationship.patientId, prepared.relationship.clinicianId);
    if (prepared.relationship.key !== active.key || !prepared.id) throw new Error('This message attempt is invalid. Please compose it again.');
    const text = normalizeText(prepared.text); const summaryReference = relationshipRef(active); const messageReference = doc(messagesRef(active), prepared.id);
    await runTransaction(db, async (transaction) => {
      const [summary, existing] = await Promise.all([transaction.get(summaryReference), transaction.get(messageReference)]); if (existing.exists()) return;
      const timestamp = serverTimestamp();
      transaction.set(summaryReference, { patientId: active.patientId, clinicianId: active.clinicianId, participantIds: [active.patientId, active.clinicianId], lastMessageText: text, lastMessageId: prepared.id, lastSenderId: active.senderId, lastMessageAt: timestamp, updatedAt: timestamp, schemaVersion: 1, ...(!summary.exists() ? { createdAt: timestamp } : {}) }, { merge: true });
      transaction.set(messageReference, { id: prepared.id, patientId: active.patientId, clinicianId: active.clinicianId, senderId: active.senderId, senderRole: active.senderRole, text, createdAt: timestamp, schemaVersion: 1 });
    });
    return { id: prepared.id, relationshipKey: active.key, patientId: active.patientId, clinicianId: active.clinicianId, senderId: active.senderId, senderRole: active.senderRole, text, createdAt: null, source: 'canonical', readOnly: false };
  },
};
