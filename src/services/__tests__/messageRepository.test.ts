import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: { currentUser: { uid: 'clinician-1' } as null | { uid: string } }, generated: 0 }));
const firestore = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), runTransaction: vi.fn(), onSnapshot: vi.fn((..._args: unknown[]) => vi.fn()), serverTimestamp: vi.fn(() => ({ server: true })) }));

vi.mock('../firebase', () => ({ auth: state.auth, db: { type: 'db' } }));
vi.mock('firebase/firestore', () => ({
  collection: (_parent: unknown, ...segments: string[]) => ({ type: 'collection', path: segments.join('/') }),
  doc: (parent: { type?: string; path?: string }, ...segments: string[]) => {
    if (parent.type === 'collection') return { type: 'doc', path: parent.path, id: segments[0] || `generated-${++state.generated}` };
    return { type: 'doc', path: segments.slice(0, -1).join('/'), id: segments.at(-1) };
  },
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
  startAfter: (...values: unknown[]) => ({ startAfter: values }),
  limit: (value: number) => ({ limit: value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }),
  ...firestore,
}));

import { messageRepository } from '../messageRepository';

const relationship = (clinicianId: string | null, legacy?: string) => ({
  exists: () => true,
  data: () => ({ clinicianId, linkedClinicianCode: legacy }),
});

describe('production message repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth.currentUser = { uid: 'clinician-1' };
    state.generated = 0;
  });

  it('denies unrelated senders before writing', async () => {
    state.auth.currentUser = { uid: 'clinician-2' };
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1'));
    const attempt = messageRepository.prepareMessage('patient-1', 'Hello');
    await expect(messageRepository.sendPreparedMessage(attempt)).rejects.toThrow('do not have access');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('uses canonical ownership instead of a conflicting legacy owner', async () => {
    state.auth.currentUser = { uid: 'legacy-clinician' };
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1', 'legacy-clinician'));
    const attempt = messageRepository.prepareMessage('patient-1', 'Hello');
    await expect(messageRepository.sendPreparedMessage(attempt)).rejects.toThrow('do not have access');
  });

  it('writes one message and thread metadata atomically with server timestamps', async () => {
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1'));
    const get = vi.fn()
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: { get: typeof get; set: typeof set }) => unknown) => callback({ get, set }));
    const attempt = messageRepository.prepareMessage('patient-1', ' Hello ');
    const sent = await messageRepository.sendPreparedMessage(attempt);
    expect(sent).toMatchObject({ id: 'generated-1', text: 'Hello', senderRole: 'clinician', createdAt: null });
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[1][1]).toMatchObject({ id: 'generated-1', createdAt: { server: true }, senderId: 'clinician-1' });
  });

  it('makes retry of the same prepared id idempotent', async () => {
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1'));
    const set = vi.fn();
    firestore.runTransaction.mockImplementationOnce(async (_db: unknown, callback: (transaction: unknown) => unknown) => callback({
      get: vi.fn().mockResolvedValueOnce({ exists: () => true }).mockResolvedValueOnce({ exists: () => true }), set,
    }));
    const attempt = messageRepository.prepareMessage('patient-1', 'Hello');
    await messageRepository.sendPreparedMessage(attempt);
    expect(set).not.toHaveBeenCalled();
  });

  it('returns pages in display order with a stable timestamp/id cursor', async () => {
    state.auth.currentUser = { uid: 'patient-1' };
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1'));
    const timestamp = { seconds: 100 };
    const docs = ['b', 'a'].map((id) => ({ id, data: () => ({ patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient', text: id, createdAt: timestamp }) }));
    firestore.getDocs.mockResolvedValueOnce({ docs });
    const page = await messageRepository.listMessages('patient-1', 2);
    expect(page.messages.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({ createdAt: timestamp, id: 'a' });
  });

  it('does not present a local pending write as a delivered message', async () => {
    state.auth.currentUser = { uid: 'patient-1' };
    firestore.getDoc.mockResolvedValueOnce(relationship('clinician-1'));
    let observer: ((snapshot: unknown) => void) | undefined;
    firestore.onSnapshot.mockImplementationOnce((...args: unknown[]) => {
      observer = args[2] as (snapshot: unknown) => void;
      return vi.fn();
    });
    const callback = vi.fn();
    messageRepository.subscribeToMessages('patient-1', callback, vi.fn());
    await vi.waitFor(() => expect(observer).toBeTypeOf('function'));
    observer?.({ metadata: { hasPendingWrites: true }, docs: [] });
    expect(callback).not.toHaveBeenCalled();
    observer?.({ metadata: { hasPendingWrites: false }, docs: [] });
    expect(callback).toHaveBeenCalledWith([]);
  });
});
