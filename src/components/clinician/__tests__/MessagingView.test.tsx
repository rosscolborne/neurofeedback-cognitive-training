import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { MessageRepository, PreparedMessage } from '../../../services/messageRepository';
import type { MessageUnreadStatus } from '../../../services/messageMappers';
import { MessagingView, type MessagingParticipant } from '../MessagingView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const relationship = (patientId: string) => ({ patientId, clinicianId: 'clinician-1', key: `${patientId}/clinician-1` });

function repository(): MessageRepository {
  return {
    resolveActiveRelationship: vi.fn(async (patientId: string) => relationship(patientId)),
    getRelationshipThread: vi.fn(async () => null),
    listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
    listLegacyMessages: vi.fn(async () => []),
    subscribeToMessages: vi.fn(() => () => {}),
    subscribeToUnread: vi.fn(() => () => {}),
    markThreadRead: vi.fn(async () => {}),
    prepareMessage: vi.fn((value, text) => ({ id: `message-${value.patientId}`, relationship: value, text: text.trim() })),
    sendPreparedMessage: vi.fn(async (attempt: PreparedMessage) => ({
      id: attempt.id, relationshipKey: attempt.relationship.key, patientId: attempt.relationship.patientId,
      clinicianId: attempt.relationship.clinicianId, senderId: 'clinician-1', senderRole: 'clinician' as const,
      text: attempt.text, createdAt: null, source: 'canonical' as const, readOnly: false,
    })),
  } as unknown as MessageRepository;
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('');
}

// ClinicianShell rebuilds this array on every render; each call returns a new identity.
const participants = (): MessagingParticipant[] => [
  { patientId: 'patient-a', name: 'Patient A' },
  { patientId: 'patient-b', name: 'Patient B' },
];

const activeConversation = (root: ReactTestInstance) =>
  root.findAllByType('button').filter((button) => button.props['aria-current'] === 'true').map((button) => button.props['aria-label']);

describe('clinician messaging selection', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: 1280, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps a chosen patient selected across shell rerenders and sends to that patient', async () => {
    const repo = repository();
    const view = (unreadByPatient: Record<string, MessageUnreadStatus> = {}) =>
      <MessagingView participants={participants()} selectedClientId="patient-a" repository={repo} unreadByPatient={unreadByPatient} />;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(view(), { createNodeMock: () => ({ scrollIntoView: vi.fn(), style: {}, scrollHeight: 40 }) });
    });
    expect(activeConversation(renderer.root)).toEqual(['Patient A Open conversation']);

    const patientB = renderer.root.findAllByType('button').find((button) => button.props['aria-label'] === 'Patient B Open conversation')!;
    await act(async () => { patientB.props.onClick(); });
    expect(activeConversation(renderer.root)).toEqual(['Patient B Open conversation']);

    // An unrelated shell state change (e.g. an unread snapshot) rerenders with a new participants array.
    await act(async () => { renderer.update(view()); });
    await act(async () => {
      renderer.update(view({ 'patient-a': { relationshipKey: 'patient-a/clinician-1', latestIncomingMessageId: 'incoming-1', unread: true } }));
    });
    expect(activeConversation(renderer.root)).toEqual(['Patient B Open conversation']);
    expect(text(renderer.root.findByProps({ htmlFor: 'clinician-message-input' }))).toBe('Message Patient B');

    const input = renderer.root.findByType('textarea');
    await act(async () => { input.props.onChange({ target: { value: 'Check-in for B' } }); });
    await act(async () => { renderer.update(view()); });
    const form = renderer.root.findByType('form');
    await act(async () => { form.props.onSubmit({ preventDefault: () => {} }); });

    expect(repo.prepareMessage).toHaveBeenCalledTimes(1);
    expect(repo.prepareMessage).toHaveBeenCalledWith(relationship('patient-b'), 'Check-in for B');
    expect(repo.sendPreparedMessage).toHaveBeenCalledWith(expect.objectContaining({ relationship: relationship('patient-b'), text: 'Check-in for B' }));
    expect(activeConversation(renderer.root)).toEqual(['Patient B Open conversation']);
    await act(async () => { renderer.unmount(); });
  });
});
