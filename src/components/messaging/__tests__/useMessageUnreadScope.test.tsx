import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRepository } from '../../../services/messageRepository';
import { useMessageUnread } from '../useMessageUnread';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const handlers = new Map<string, { success: (value: { relationshipKey: string; latestIncomingMessageId: string | null; unread: boolean }) => void; error: (error: Error) => void }>();
const repository = { subscribeToUnread: vi.fn((id: string, success, error) => { handlers.set(id, { success, error }); return () => handlers.delete(id); }) } as unknown as MessageRepository;
const observe = vi.fn<(value: ReturnType<typeof useMessageUnread>) => void>();
const current = () => observe.mock.lastCall![0];
const Probe = ({ ids, scope, enabled = true }: { ids: string[]; scope: string; enabled?: boolean }) => {
  const value = useMessageUnread(ids, repository, enabled, scope);
  React.useEffect(() => observe(value), [value]);
  return <div />;
};

describe('unread conversation scope', () => {
  it('waits for every relationship and clears counts on read, error, account and demo changes', async () => {
    let view!: ReactTestRenderer;
    await act(async () => { view = create(<Probe ids={['a', 'b']} scope="account-1" />); });
    expect(current().isComplete).toBe(false);
    await act(async () => handlers.get('a')!.success({ relationshipKey: 'a/1', latestIncomingMessageId: 'm1', unread: true }));
    expect(current().isComplete).toBe(false);
    await act(async () => handlers.get('b')!.success({ relationshipKey: 'b/1', latestIncomingMessageId: null, unread: false }));
    expect(current().isComplete).toBe(true);
    expect(Object.values(current().byPatient).filter((item) => item.unread)).toHaveLength(1);
    await act(async () => handlers.get('a')!.success({ relationshipKey: 'a/1', latestIncomingMessageId: 'm1', unread: false }));
    expect(current().byPatient.a.unread).toBe(false);
    await act(async () => handlers.get('a')!.error(new Error('offline')));
    expect(current().isComplete).toBe(false);
    expect(current().error).toBe('offline');
    await act(async () => view.update(<Probe ids={['a', 'b']} scope="account-2" />));
    expect(current().byPatient).toEqual({});
    expect(current().isComplete).toBe(false);
    await act(async () => view.update(<Probe ids={['a', 'b']} scope="account-2" enabled={false} />));
    expect(current().byPatient).toEqual({});
    expect(current().isComplete).toBe(false);
    await act(async () => view.unmount());
  });
});
