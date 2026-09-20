import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import {
  compareMessagesAscending,
  mapMessageDocument,
  mapThreadDocument,
  type MessageSenderRole,
  type ProductionMessage,
  type ProductionMessageThread,
} from './messageMappers';

const MAX_MESSAGE_LENGTH = 4000;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export interface MessagePageCursor {
  createdAt: unknown;
  id: string;
}

export interface MessagePage {
  messages: ProductionMessage[];
  nextCursor: MessagePageCursor | null;
}

export interface PreparedMessage {
  id: string;
  threadId: string;
  patientId: string;
  text: string;
}

export interface MessageRepository {
  listThreads(): Promise<ProductionMessageThread[]>;
  listMessages(patientId: string, pageSize?: number, cursor?: MessagePageCursor): Promise<MessagePage>;
  subscribeToThreads(
    callback: (threads: ProductionMessageThread[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe;
  subscribeToMessages(
    patientId: string,
    callback: (messages: ProductionMessage[]) => void,
    onError: (error: Error) => void,
    pageSize?: number,
  ): Unsubscribe;
  prepareMessage(patientId: string, text: string): PreparedMessage;
  sendPreparedMessage(message: PreparedMessage): Promise<ProductionMessage>;
}

interface Relationship {
  patientId: string;
  clinicianId: string;
  senderId: string;
  senderRole: MessageSenderRole;
}

const asError = (error: unknown) => error instanceof Error ? error : new Error('Messaging is unavailable.');

const normalizeText = (text: string): string => {
  const normalized = text.trim();
  if (!normalized) throw new Error('Enter a message before sending.');
  if (normalized.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages must be ${MAX_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`);
  }
  return normalized;
};

const currentUserId = (): string => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in to use messaging.');
  return uid;
};

async function resolveRelationship(patientId: string): Promise<Relationship> {
  const senderId = currentUserId();
  if (!patientId.trim()) throw new Error('A patient is required to open a conversation.');
  const patientSnapshot = await getDoc(doc(db, 'clients', patientId));
  if (!patientSnapshot.exists()) throw new Error('This patient relationship is unavailable.');
  const patient = patientSnapshot.data();
  const canonicalClinicianId = typeof patient.clinicianId === 'string' && patient.clinicianId
    ? patient.clinicianId
    : null;
  const legacyClinicianId = canonicalClinicianId === null &&
    typeof patient.linkedClinicianCode === 'string' && patient.linkedClinicianCode
    ? patient.linkedClinicianCode
    : null;
  const clinicianId = canonicalClinicianId ?? legacyClinicianId;
  if (!clinicianId) throw new Error('Connect with a clinician before using messaging.');
  if (senderId !== patientId && senderId !== clinicianId) {
    throw new Error('You do not have access to this conversation.');
  }
  return {
    patientId,
    clinicianId,
    senderId,
    senderRole: senderId === patientId ? 'patient' : 'clinician',
  };
}

const threadRef = (patientId: string) => doc(db, 'messageThreads', patientId);
const messagesRef = (patientId: string) => collection(db, 'messageThreads', patientId, 'messages');

function mapMessages(
  documents: Array<QueryDocumentSnapshot<DocumentData>>,
  threadId: string,
): ProductionMessage[] {
  return documents
    .map((snapshot) => mapMessageDocument(snapshot, threadId))
    .filter((message): message is ProductionMessage => message !== null)
    .sort(compareMessagesAscending);
}

export const messageRepository: MessageRepository = {
  async listThreads() {
    const uid = currentUserId();
    const userSnapshot = await getDoc(doc(db, 'users', uid));
    const role = userSnapshot.exists() ? userSnapshot.data().role : null;
    if (role === 'patient') {
      const snapshot = await getDoc(threadRef(uid));
      if (!snapshot.exists()) return [];
      const thread = mapThreadDocument(snapshot);
      return thread ? [thread] : [];
    }
    if (role !== 'clinician') throw new Error('Select an account role before using messaging.');
    const snapshot = await getDocs(query(
      collection(db, 'messageThreads'),
      where('clinicianId', '==', uid),
      orderBy('updatedAt', 'desc'),
      orderBy(documentId(), 'asc'),
    ));
    return snapshot.docs
      .map(mapThreadDocument)
      .filter((thread): thread is ProductionMessageThread => thread !== null);
  },

  async listMessages(patientId, requestedPageSize = DEFAULT_PAGE_SIZE, cursor) {
    await resolveRelationship(patientId);
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(requestedPageSize)));
    const constraints = [
      orderBy('createdAt', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []),
      limit(pageSize),
    ];
    const snapshot = await getDocs(query(messagesRef(patientId), ...constraints));
    const last = snapshot.docs.at(-1);
    return {
      messages: mapMessages(snapshot.docs, patientId),
      nextCursor: snapshot.docs.length === pageSize && last
        ? { createdAt: last.data().createdAt, id: last.id }
        : null,
    };
  },

  subscribeToThreads(callback, onError) {
    let unsubscribe: Unsubscribe = () => {};
    let disposed = false;
    const uid = currentUserId();
    void getDoc(doc(db, 'users', uid)).then((userSnapshot) => {
      if (disposed) return;
      const role = userSnapshot.exists() ? userSnapshot.data().role : null;
      if (role !== 'patient' && role !== 'clinician') {
        throw new Error('Select an account role before using messaging.');
      }
      const uid = currentUserId();
      const source = role === 'patient'
        ? query(collection(db, 'messageThreads'), where('patientId', '==', uid))
        : query(collection(db, 'messageThreads'), where('clinicianId', '==', uid), orderBy('updatedAt', 'desc'), orderBy(documentId(), 'asc'));
      const liveUnsubscribe = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
        // Never present latency-compensated local writes as delivered. A denied
        // or offline write must remain in the explicit retry state.
        if (snapshot.metadata.hasPendingWrites) return;
        callback(snapshot.docs.map(mapThreadDocument).filter((item): item is ProductionMessageThread => item !== null));
      }, (error) => onError(asError(error)));
      if (disposed) liveUnsubscribe();
      else unsubscribe = liveUnsubscribe;
    }).catch((error) => onError(asError(error)));
    return () => { disposed = true; unsubscribe(); };
  },

  subscribeToMessages(patientId, callback, onError, requestedPageSize = DEFAULT_PAGE_SIZE) {
    let unsubscribe: Unsubscribe = () => {};
    let disposed = false;
    void resolveRelationship(patientId).then(() => {
      if (disposed) return;
      const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(requestedPageSize)));
      const liveUnsubscribe = onSnapshot(query(
        messagesRef(patientId),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        limit(pageSize),
      ), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.hasPendingWrites) return;
        callback(mapMessages(snapshot.docs, patientId));
      }, (error) => onError(asError(error)));
      if (disposed) liveUnsubscribe();
      else unsubscribe = liveUnsubscribe;
    }).catch((error) => onError(asError(error)));
    return () => { disposed = true; unsubscribe(); };
  },

  prepareMessage(patientId, text) {
    currentUserId();
    const normalizedText = normalizeText(text);
    const messageReference = doc(messagesRef(patientId));
    return { id: messageReference.id, threadId: patientId, patientId, text: normalizedText };
  },

  async sendPreparedMessage(prepared) {
    const relationship = await resolveRelationship(prepared.patientId);
    const text = normalizeText(prepared.text);
    if (prepared.threadId !== prepared.patientId || !prepared.id) {
      throw new Error('This message attempt is invalid. Please compose it again.');
    }
    const canonicalThreadRef = threadRef(prepared.patientId);
    const messageReference = doc(messagesRef(prepared.patientId), prepared.id);
    await runTransaction(db, async (transaction) => {
      const [threadSnapshot, existingMessage] = await Promise.all([
        transaction.get(canonicalThreadRef),
        transaction.get(messageReference),
      ]);
      if (existingMessage.exists()) return;
      const timestamp = serverTimestamp();
      transaction.set(canonicalThreadRef, {
        patientId: relationship.patientId,
        clinicianId: relationship.clinicianId,
        participantIds: [relationship.patientId, relationship.clinicianId],
        lastMessageText: text,
        lastSenderId: relationship.senderId,
        lastMessageAt: timestamp,
        updatedAt: timestamp,
        schemaVersion: 1,
        ...(!threadSnapshot.exists() ? { createdAt: timestamp } : {}),
      }, { merge: true });
      transaction.set(messageReference, {
        id: prepared.id,
        patientId: relationship.patientId,
        clinicianId: relationship.clinicianId,
        senderId: relationship.senderId,
        senderRole: relationship.senderRole,
        text,
        createdAt: timestamp,
        schemaVersion: 1,
      });
    });
    return {
      id: prepared.id,
      threadId: prepared.patientId,
      patientId: relationship.patientId,
      clinicianId: relationship.clinicianId,
      senderId: relationship.senderId,
      senderRole: relationship.senderRole,
      text,
      createdAt: null,
    };
  },
};
