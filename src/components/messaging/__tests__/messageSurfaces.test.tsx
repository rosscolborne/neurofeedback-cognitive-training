import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PatientMessagingView } from '../../patient/PatientMessagingView';
import type { MessageRepository } from '../../../services/messageRepository';

const repository: MessageRepository = {
  resolveActiveRelationship: vi.fn(async (patientId) => ({ patientId, clinicianId: 'clinician-1', key: `${patientId}/clinician-1` })),
  getRelationshipThread: vi.fn(async () => null),
  listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
  listLegacyMessages: vi.fn(async () => []),
  subscribeToMessages: vi.fn(() => () => {}),
  subscribeToUnread: vi.fn(() => () => {}),
  markThreadRead: vi.fn(async () => {}),
  prepareMessage: vi.fn((relationship, text) => ({ id: 'opaque-1', relationship, text: text.trim() })),
  sendPreparedMessage: vi.fn(async () => { throw new Error('offline'); }),
};

describe('production messaging surfaces', () => {
  it('shows explicit patient initial loading and a patient compose control', () => {
    const markup = renderToStaticMarkup(<PatientMessagingView patientId="patient-1" repository={repository} />);
    expect(markup).toContain('Loading messages');
    expect(markup).toContain('Message your clinician');
    expect(markup).not.toContain('Just now');
  });
});
