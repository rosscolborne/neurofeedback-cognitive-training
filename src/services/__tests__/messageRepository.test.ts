import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationshipKey, type MessageRelationship } from '../messageMappers';

const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'clinician-1' } as null | { uid: string } }, generated: 0, demoWorkspace: false }));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), runTransaction: vi.fn(), onSnapshot: vi.fn((..._args: unknown[]) => vi.fn()), serverTimestamp: vi.fn(() => ({ server: true })) }));
vi.mock('../firebase', () => ({ auth: state.auth, db: { type: 'db' } }));
vi.mock('../clinicianDemoBoundary', () => ({ isClinicianDemoWorkspace: () => state.demoWorkspace }));
vi.mock('firebase/firestore', () => ({
  collection: (_parent: unknown, ...segments: string[]) => ({ type: 'collection', path: segments.join('/') }),
  collectionGroup: (_db: unknown, name: string) => ({ type: 'collectionGroup', path: name }),
  doc: (parent: { type?: string; path?: string }, ...segments: string[]) => parent.type === 'collection'
    ? { type: 'doc', path: parent.path, id: segments[0] || `generated-${++state.generated}` }
    : { type: 'doc', path: segments.slice(0, -1).join('/'), id: segments.at(-1) },
  documentId: () => '__name__', where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }), startAfter: (...values: unknown[]) => ({ startAfter: values }),
  limit: (value: number) => ({ limit: value }), query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }), ...firestore,
}));
import { messageRepository } from '../messageRepository';

const rel = (patientId = 'patient-1', clinicianId = 'clinician-1'): MessageRelationship => ({ patientId, clinicianId, key: relationshipKey(patientId, clinicianId) });
const client = (clinicianId: unknown, linkedClinicianCode?: unknown) => ({ exists: () => true, data: () => ({ clinicianId, linkedClinicianCode }) });
const missing = () => ({ exists: () => false, data: () => ({}) });

describe('relationship-scoped message repository', () => {
  beforeEach(() => { vi.clearAllMocks(); state.auth.currentUser = { uid: 'clinician-1' }; state.generated = 0; state.demoWorkspace = false; });

  it('fails closed in the sample clinician workspace before auth or Firestore access', async () => {
    state.demoWorkspace = true;
    state.auth.currentUser = null;
    await expect(messageRepository.resolveActiveRelationship('sample-patient')).rejects.toThrow(/sample clinician workspace/);
    expect(() => messageRepository.prepareMessage(rel('sample-patient', 'demo-clinician'), 'Hello')).toThrow(/sample clinician workspace/);
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('matches R1 fallback exactly and rejects malformed non-null canonical ownership', async () => {
    firestore.getDoc.mockResolvedValueOnce(client(null, 'clinician-1'));
    await expect(messageRepository.resolveActiveRelationship('patient-1')).resolves.toEqual(rel());
    firestore.getDoc.mockResolvedValueOnce(client('', 'clinician-1'));
    await expect(messageRepository.resolveActiveRelationship('patient-1')).rejects.toThrow('malformed');
    firestore.getDoc.mockResolvedValueOnce(client(17, 'clinician-1'));
    await expect(messageRepository.resolveActiveRelationship('patient-1')).rejects.toThrow('malformed');
  });

  it('isolates relinked histories by clinician relationship path', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    const oldRelationship = await messageRepository.resolveActiveRelationship('patient-1');
    const oldAttempt = messageRepository.prepareMessage(oldRelationship, 'Old care team');
    expect(oldAttempt.relationship.key).toBe('patient-1/clinician-1');

    state.auth.currentUser = { uid: 'clinician-2' };
    firestore.getDoc.mockResolvedValueOnce(client('clinician-2'));
    const newRelationship = await messageRepository.resolveActiveRelationship('patient-1');
    const newAttempt = messageRepository.prepareMessage(newRelationship, 'New care team');
    expect(newAttempt.relationship.key).toBe('patient-1/clinician-2');
    expect(newAttempt.id).not.toBe(oldAttempt.id);

    state.auth.currentUser = { uid: 'clinician-1' };
    firestore.getDoc.mockResolvedValueOnce(client('clinician-2'));
    await expect(messageRepository.sendPreparedMessage(oldAttempt)).rejects.toThrow('no longer active');
  });

  it('reads a selected summary only by its direct current relationship path', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({
      id: 'clinician-1', exists: () => true,
      data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', participantIds: ['patient-1', 'clinician-1'] }),
    });
    await expect(messageRepository.getRelationshipThread(rel())).resolves.toMatchObject({ relationshipKey: rel().key });
    expect(firestore.getDoc.mock.calls[1][0]).toMatchObject({ path: 'messageThreads/patient-1/relationships', id: 'clinician-1' });
  });

  it('writes summary and message under the selected relationship with server timestamps', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    const get = vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(missing()); const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({ get, set }));
    const sent = await messageRepository.sendPreparedMessage(messageRepository.prepareMessage(rel(), ' Hello '));
    expect(sent).toMatchObject({ relationshipKey: 'patient-1/clinician-1', text: 'Hello', createdAt: null });
    expect(set.mock.calls[0][0]).toMatchObject({ path: 'messageThreads/patient-1/relationships', id: 'clinician-1' });
    expect(set.mock.calls[1][0]).toMatchObject({ path: 'messageThreads/patient-1/relationships/clinician-1/messages' });
    expect(set.mock.calls[1][1]).toMatchObject({ createdAt: { server: true }, clinicianId: 'clinician-1' });
  });

  it('reuses the same prepared id idempotently and validates text boundaries', async () => {
    expect(() => messageRepository.prepareMessage(rel(), ' ')).toThrow('Enter a message');
    expect(() => messageRepository.prepareMessage(rel(), 'x'.repeat(4001))).toThrow('4,000');
    const attempt = messageRepository.prepareMessage(rel(), 'x'.repeat(4000));
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    const set = vi.fn(); firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (tx: unknown) => unknown) => callback({ get: vi.fn().mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => true }), set }));
    await messageRepository.sendPreparedMessage(attempt); expect(set).not.toHaveBeenCalled();
  });

  it('keeps pagination ordered and relationship-scoped', async () => {
    state.auth.currentUser = { uid: 'patient-1' }; firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    const timestamp = { seconds: 100 }; const docs = ['b', 'a'].map((id) => ({ id, data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient', text: id, createdAt: timestamp }) }));
    firestore.getDocs.mockResolvedValueOnce({ docs });
    const page = await messageRepository.listMessages(rel(), 2);
    expect(page.messages.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({ relationshipKey: rel().key, createdAt: timestamp, id: 'a' });
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    await expect(messageRepository.listMessages(rel(), 2, { relationshipKey: 'patient-1/other', createdAt: timestamp, id: 'a' })).rejects.toThrow('different conversation');
  });

  it('reads matching real legacy history as distinct read-only messages and never writes it', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({ exists: () => true, data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', messages: [{ id: 'old-1', sender: 'patient', text: 'Existing note', timestamp: '2026-09-01T12:00:00Z' }] }) });
    const items = await messageRepository.listLegacyMessages(rel());
    expect(items).toMatchObject([{ id: 'legacy:patient-1/clinician-1:old-1', source: 'legacy', readOnly: true, text: 'Existing note' }]);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('excludes mismatched legacy arrays without treating mutable demo-shaped fields as authorization', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({ exists: () => true, data: () => ({ patientId: 'patient-1', clinicianId: 'other', messages: [{ sender: 'patient', text: 'private' }] }) });
    await expect(messageRepository.listLegacyMessages(rel())).resolves.toEqual([]);

    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({ exists: () => true, data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', isDemo: true, messages: [{ sender: 'patient', text: 'Existing note' }] }) });
    await expect(messageRepository.listLegacyMessages(rel())).resolves.toMatchObject([{ text: 'Existing note' }]);

    state.auth.currentUser = { uid: 'demo-looking-patient' };
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({ exists: () => true, data: () => ({ patientId: 'demo-looking-patient', clinicianId: 'clinician-1', messages: [{ sender: 'patient', text: 'Legitimate ID' }] }) });
    await expect(messageRepository.listLegacyMessages(rel('demo-looking-patient'))).resolves.toMatchObject([{ text: 'Legitimate ID' }]);
  });

  it('keeps canonical history available when a former-clinician legacy read is denied', async () => {
    state.auth.currentUser = { uid: 'patient-1' };
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    firestore.getDocs.mockResolvedValueOnce({ docs: [{ id: 'new-1', data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient', text: 'Canonical', createdAt: { seconds: 10 } }) }] });
    const canonical = await messageRepository.listMessages(rel());
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockRejectedValueOnce({ code: 'permission-denied' });
    const legacy = await messageRepository.listLegacyMessages(rel());
    expect(canonical.messages.map(({ text }) => text)).toEqual(['Canonical']);
    expect(legacy).toEqual([]);
  });

  it('does not swallow legacy transport or corruption failures', async () => {
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockRejectedValueOnce({ code: 'unavailable' });
    await expect(messageRepository.listLegacyMessages(rel())).rejects.toMatchObject({ code: 'unavailable' });
    firestore.getDoc.mockResolvedValueOnce(client('clinician-1')).mockResolvedValueOnce({ exists: () => true, data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', messages: {} }) });
    await expect(messageRepository.listLegacyMessages(rel())).rejects.toThrow('malformed');
  });

  it('suppresses pending snapshots and every callback after disposal', async () => {
    state.auth.currentUser = { uid: 'patient-1' }; firestore.getDoc.mockResolvedValueOnce(client('clinician-1'));
    let next: ((snapshot: any) => void) | undefined; let error: ((error: Error) => void) | undefined; const liveUnsubscribe = vi.fn();
    firestore.onSnapshot.mockImplementationOnce((...args: unknown[]) => { next = args[2] as typeof next; error = args[3] as typeof error; return liveUnsubscribe; });
    const callback = vi.fn(); const onError = vi.fn(); const dispose = messageRepository.subscribeToMessages(rel(), callback, onError);
    await vi.waitFor(() => expect(next).toBeTypeOf('function'));
    next?.({ metadata: { hasPendingWrites: true }, docs: [] }); expect(callback).not.toHaveBeenCalled();
    dispose(); expect(liveUnsubscribe).toHaveBeenCalled();
    next?.({ metadata: { hasPendingWrites: false }, docs: [] }); error?.(new Error('late'));
    expect(callback).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  });
});
