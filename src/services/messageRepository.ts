import {
  collection, collectionGroup, doc, documentId, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, runTransaction, serverTimestamp, startAfter, where,
  type DocumentData, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  compareMessagesAscending, mapLegacyMessageThread, mapMessageDocument, mapThreadDocument,
  relationshipKey, type MessageRelationship, type MessageSenderRole,
  type ProductionMessage, type ProductionMessageThread,
} from './messageMappers';

const MAX_MESSAGE_LENGTH = 4000; const DEFAULT_PAGE_SIZE = 30; const MAX_PAGE_SIZE = 100;
export interface MessagePageCursor { relationshipKey: string; createdAt: unknown; id: string; }
export interface MessagePage { messages: ProductionMessage[]; nextCursor: MessagePageCursor | null; }
export interface PreparedMessage { id: string; relationship: MessageRelationship; text: string; }
export interface MessageRepository {
  resolveActiveRelationship(patientId: string): Promise<MessageRelationship>;
  listThreads(): Promise<ProductionMessageThread[]>;
  listMessages(relationship: MessageRelationship, pageSize?: number, cursor?: MessagePageCursor): Promise<MessagePage>;
  listLegacyMessages(relationship: MessageRelationship): Promise<ProductionMessage[]>;
  subscribeToThreads(callback: (threads: ProductionMessageThread[]) => void, onError: (error: Error) => void): Unsubscribe;
  subscribeToMessages(relationship: MessageRelationship, callback: (messages: ProductionMessage[]) => void, onError: (error: Error) => void, pageSize?: number): Unsubscribe;
  prepareMessage(relationship: MessageRelationship, text: string): PreparedMessage;
  sendPreparedMessage(message: PreparedMessage): Promise<ProductionMessage>;
}

interface AuthorizedRelationship extends MessageRelationship { senderId: string; senderRole: MessageSenderRole; }
const asError = (error: unknown) => error instanceof Error ? error : new Error('Messaging is unavailable.');
const currentUserId = () => { const uid = auth.currentUser?.uid; if (!uid) throw new Error('Sign in to use messaging.'); return uid; };
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

export const messageRepository: MessageRepository = {
  async resolveActiveRelationship(patientId) {
    const value = await resolveAuthorizedRelationship(patientId);
    return { patientId: value.patientId, clinicianId: value.clinicianId, key: value.key };
  },
  async listThreads() {
    const uid = currentUserId(); const user = await getDoc(doc(db, 'users', uid)); const role = user.exists() ? user.data().role : null;
    if (role === 'patient') {
      const relationship = await this.resolveActiveRelationship(uid); const snapshot = await getDoc(relationshipRef(relationship));
      if (!snapshot.exists()) return []; const thread = mapThreadDocument(snapshot); return thread && thread.relationshipKey === relationship.key ? [thread] : [];
    }
    if (role !== 'clinician') throw new Error('Select an account role before using messaging.');
    const snapshot = await getDocs(query(collectionGroup(db, 'relationships'), where('clinicianId', '==', uid), orderBy('updatedAt', 'desc'), orderBy(documentId(), 'asc')));
    return snapshot.docs.map(mapThreadDocument).filter((thread): thread is ProductionMessageThread => thread !== null);
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
    const snapshot = await getDoc(doc(db, 'messages', relationship.patientId));
    return snapshot.exists() ? mapLegacyMessageThread(snapshot.data(), active) : [];
  },
  subscribeToThreads(callback, onError) {
    let unsubscribe: Unsubscribe = () => {}; let disposed = false; const uid = currentUserId();
    void getDoc(doc(db, 'users', uid)).then(async (user) => {
      if (disposed) return; const role = user.exists() ? user.data().role : null; let source;
      if (role === 'patient') { const relationship = await this.resolveActiveRelationship(uid); if (disposed) return; source = query(collection(db, 'messageThreads', uid, 'relationships'), where('clinicianId', '==', relationship.clinicianId)); }
      else if (role === 'clinician') source = query(collectionGroup(db, 'relationships'), where('clinicianId', '==', uid), orderBy('updatedAt', 'desc'), orderBy(documentId(), 'asc'));
      else throw new Error('Select an account role before using messaging.');
      const live = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => { if (disposed || snapshot.metadata.hasPendingWrites) return; callback(snapshot.docs.map(mapThreadDocument).filter((item): item is ProductionMessageThread => item !== null)); }, (error) => { if (!disposed) onError(asError(error)); });
      if (disposed) live(); else unsubscribe = live;
    }).catch((error) => { if (!disposed) onError(asError(error)); });
    return () => { disposed = true; unsubscribe(); };
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
