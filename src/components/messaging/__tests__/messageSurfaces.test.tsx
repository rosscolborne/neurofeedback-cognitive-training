import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessagingView } from '../../clinician/MessagingView';
import { PatientMessagingView } from '../../patient/PatientMessagingView';
import type { MessageRepository } from '../../../services/messageRepository';

const repository: MessageRepository = {
  listThreads: vi.fn(async () => []),
  listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
  subscribeToThreads: vi.fn(() => () => {}),
  subscribeToMessages: vi.fn(() => () => {}),
  prepareMessage: vi.fn((patientId, text) => ({ id: 'opaque-1', threadId: patientId, patientId, text: text.trim() })),
  sendPreparedMessage: vi.fn(async () => { throw new Error('offline'); }),
};

describe('production messaging surfaces', () => {
  it('shows an honest clinician empty state without a placeholder conversation', () => {
    const markup = renderToStaticMarkup(<MessagingView threads={[]} repository={repository} />);
    expect(markup).toContain('No conversations yet');
    expect(markup).not.toContain('Just now');
  });

  it('shows an honest patient empty state and a patient compose control', () => {
    const markup = renderToStaticMarkup(<PatientMessagingView patientId="patient-1" repository={repository} />);
    expect(markup).toContain('No messages yet');
    expect(markup).toContain('Message your clinician');
    expect(markup).not.toContain('Just now');
  });
});
