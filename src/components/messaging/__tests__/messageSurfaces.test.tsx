import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessagingView } from '../../clinician/MessagingView';
import { PatientMessagingView } from '../../patient/PatientMessagingView';
import { PatientAvatar } from '../../clinician/PatientAvatar';
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
  it('builds clinician choices only from supplied linked participants', () => {
    const markup = renderToStaticMarkup(<MessagingView threads={[]} repository={repository} />);
    expect(markup).toContain('No linked patients');
    expect(markup).not.toContain('Just now');
  });

  it('shows explicit patient initial loading and a patient compose control', () => {
    const markup = renderToStaticMarkup(<PatientMessagingView patientId="patient-1" repository={repository} />);
    expect(markup).toContain('Loading messages');
    expect(markup).toContain('Message your clinician');
    expect(markup).not.toContain('Just now');
  });

  it('marks only the patient with an unread incoming message', () => {
    const markup = renderToStaticMarkup(<MessagingView
      participants={[{ patientId: 'patient-1', name: 'First patient' }, { patientId: 'patient-2', name: 'Second patient' }]}
      unreadByPatient={{ 'patient-1': { relationshipKey: 'patient-1/clinician-1', latestIncomingMessageId: 'message-1', unread: true } }}
      repository={repository}
    />);
    expect(markup).toContain('aria-label="First patient Open conversation, unread message"');
    expect(markup).toContain('aria-label="Second patient Open conversation"');
    expect(markup).not.toContain('Second patient Open conversation, unread message');
  });

  it('uses a faceless placeholder for legacy stock avatars and retains uploaded patient photos', () => {
    const stockAvatar = renderToStaticMarkup(<PatientAvatar avatarUrl="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d" size={36} />);
    expect(stockAvatar).toContain('class="patient-avatar"');
    expect(stockAvatar).toContain('<svg');
    expect(stockAvatar).not.toContain('<img');

    const uploadedAvatar = renderToStaticMarkup(<MessagingView
      participants={[{ patientId: 'patient-1', name: 'First patient', avatarUrl: 'data:image/png;base64,abc' }]}
      selectedClientId="patient-1"
      repository={repository}
    />);
    expect(uploadedAvatar.match(/<img/g)).toHaveLength(2);
    expect(uploadedAvatar).toContain('src="data:image/png;base64,abc"');
  });
});
