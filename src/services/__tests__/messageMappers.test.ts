import { describe, expect, it } from 'vitest';
import { compareMessagesAscending, formatMessageTime, mapMessageDocument, mapThreadDocument } from '../messageMappers';

const snapshot = (id: string, data: Record<string, unknown>) => ({ id, data: () => data }) as never;

describe('message mappers', () => {
  it('maps canonical messages and preserves zero/unknown timestamp semantics', () => {
    const mapped = mapMessageDocument(snapshot('message-1', {
      patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1',
      senderRole: 'patient', text: 'Hello', createdAt: { seconds: 0 },
    }), 'patient-1');
    expect(mapped?.createdAt?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(formatMessageTime(null)).toBe('Sending time unavailable');
  });

  it('rejects malformed sender identity instead of presenting it as trusted', () => {
    expect(mapMessageDocument(snapshot('message-1', {
      patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'stranger',
      senderRole: 'clinician', text: 'Injected', createdAt: null,
    }), 'patient-1')).toBeNull();
  });

  it('requires the canonical patient thread id', () => {
    expect(mapThreadDocument(snapshot('wrong-id', {
      patientId: 'patient-1', clinicianId: 'clinician-1', updatedAt: null,
    }))).toBeNull();
  });

  it('orders equal server timestamps by stable document id', () => {
    const base = {
      threadId: 'patient-1', patientId: 'patient-1', clinicianId: 'clinician-1',
      senderId: 'patient-1', senderRole: 'patient' as const, text: 'Text',
      createdAt: new Date('2026-09-19T12:00:00Z'),
    };
    expect([{ ...base, id: 'b' }, { ...base, id: 'a' }].sort(compareMessagesAscending).map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
