import { describe, expect, it } from 'vitest';
import { compareMessagesAscending, formatMessageTime, mapLegacyMessageThread, mapMessageDocument, mapThreadDocument, messageUnreadStatus, relationshipKey, type MessageRelationship, type ProductionMessage, type ProductionMessageThread } from '../messageMappers';

const relationship: MessageRelationship = { patientId: 'patient-1', clinicianId: 'clinician-1', key: relationshipKey('patient-1', 'clinician-1') };
const snapshot = (id: string, data: Record<string, unknown>) => ({ id, data: () => data }) as never;

describe('message mappers', () => {
  it('maps canonical messages and never treats relative legacy labels as truth', () => {
    const mapped = mapMessageDocument(snapshot('message-1', { patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient', text: 'Hello', createdAt: { seconds: 0 } }), relationship);
    expect(mapped?.createdAt?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(formatMessageTime(null)).toBe('Time unavailable');
    expect(mapLegacyMessageThread({ patientId: 'patient-1', clinicianId: 'clinician-1', messages: [{ sender: 'patient', text: 'Hi', timestamp: 'Just now' }] }, relationship)[0].createdAt).toBeNull();
  });
  it('rejects wrong relationships and malformed sender identity', () => {
    expect(mapMessageDocument(snapshot('message-1', { patientId: 'patient-1', clinicianId: 'other', senderId: 'other', senderRole: 'clinician', text: 'Injected' }), relationship)).toBeNull();
    expect(mapMessageDocument(snapshot('message-1', { patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'stranger', senderRole: 'clinician', text: 'Injected' }), relationship)).toBeNull();
  });
  it('requires exact relationship summary identities and participants', () => {
    expect(mapThreadDocument(snapshot('patient-1', { patientId: 'patient-1', clinicianId: 'clinician-1', participantIds: ['patient-1', 'clinician-1'] }))).toBeNull();
    expect(mapThreadDocument(snapshot('clinician-1', { patientId: 'patient-1', clinicianId: 'clinician-1', participantIds: ['clinician-1', 'patient-1'] }))).toBeNull();
    expect(mapThreadDocument(snapshot('clinician-1', { patientId: 'patient-1', clinicianId: 'clinician-1', participantIds: ['patient-1', 'clinician-1'] }))?.relationshipKey).toBe(relationship.key);
  });
  it('orders equal timestamps by stable id', () => {
    const base: Omit<ProductionMessage, 'id'> = { relationshipKey: relationship.key, patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient', text: 'Text', createdAt: new Date('2026-09-19T12:00:00Z'), source: 'canonical', readOnly: false };
    expect([{ ...base, id: 'b' }, { ...base, id: 'a' }].sort(compareMessagesAscending).map(({ id }) => id)).toEqual(['a', 'b']);
  });
  it('shows unread only for the latest incoming message until that exact message is read', () => {
    const thread: ProductionMessageThread = {
      id: 'clinician-1', relationshipKey: relationship.key, patientId: 'patient-1', clinicianId: 'clinician-1',
      lastMessageText: 'Hello', lastMessageId: 'message-2', lastSenderId: 'clinician-1',
      lastMessageAt: null, createdAt: null, updatedAt: null,
    };
    expect(messageUnreadStatus(thread, 'patient-1', 'message-1', relationship.key)).toMatchObject({ unread: true, latestIncomingMessageId: 'message-2' });
    expect(messageUnreadStatus(thread, 'patient-1', 'message-2', relationship.key).unread).toBe(false);
    expect(messageUnreadStatus(thread, 'clinician-1', null, relationship.key).unread).toBe(false);
    expect(messageUnreadStatus(null, 'patient-1', null, relationship.key).unread).toBe(false);
  });
});
