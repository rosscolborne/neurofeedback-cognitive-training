import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRepository, PreparedMessage } from '../../../services/messageRepository';
import type { MessageRelationship } from '../../../services/messageMappers';

type Cleanup = void | (() => void);
const runtime = vi.hoisted(() => ({ current: null as null | HookRuntime }));

class HookRuntime {
  states: unknown[] = [];
  stateCursor = 0;
  effects: Array<{ deps?: unknown[]; cleanup?: Cleanup }> = [];
  effectCursor = 0;
  pendingEffects: Array<() => void> = [];

  begin() { this.stateCursor = 0; this.effectCursor = 0; this.pendingEffects = []; runtime.current = this; }
  useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
    const index = this.stateCursor++;
    if (!(index in this.states)) this.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [this.states[index] as T, (value) => { const current = this.states[index] as T; this.states[index] = typeof value === 'function' ? (value as (item: T) => T)(current) : value; }];
  }
  useRef<T>(initial: T) { const [reference] = this.useState({ current: initial }); return reference; }
  useEffect(effect: () => Cleanup, deps?: unknown[]) {
    const index = this.effectCursor++; const prior = this.effects[index];
    const changed = !prior || !deps || !prior.deps || deps.some((value, position) => !Object.is(value, prior.deps?.[position]));
    if (changed) this.pendingEffects.push(() => { prior?.cleanup?.(); this.effects[index] = { deps, cleanup: effect() }; });
  }
  commit() { this.pendingEffects.forEach((effect) => effect()); this.pendingEffects = []; }
  unmount() { this.effects.forEach((effect) => effect.cleanup?.()); runtime.current = null; }
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => runtime.current!.useState(initial),
    useEffect: (effect: () => Cleanup, deps?: unknown[]) => runtime.current!.useEffect(effect, deps),
    useRef: <T,>(initial: T) => runtime.current!.useRef(initial),
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(callback: T) => callback,
  };
});

import { useMessageConversation } from '../useMessageConversation';

const relationship = (patientId: string, clinicianId = 'clinician-1'): MessageRelationship => ({ patientId, clinicianId, key: `${patientId}/${clinicianId}` });
const repository = (overrides: Partial<MessageRepository> = {}): MessageRepository => ({
  resolveActiveRelationship: vi.fn(async (patientId) => relationship(patientId)),
  getRelationshipThread: vi.fn(async () => null),
  listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
  listLegacyMessages: vi.fn(async () => []), subscribeToMessages: vi.fn(() => () => {}),
  prepareMessage: vi.fn((value, text) => ({ id: `id-${value.patientId}`, relationship: value, text: text.trim() })),
  sendPreparedMessage: vi.fn(async (attempt) => ({ id: attempt.id, relationshipKey: attempt.relationship.key, patientId: attempt.relationship.patientId, clinicianId: attempt.relationship.clinicianId, senderId: attempt.relationship.patientId, senderRole: 'patient' as const, text: attempt.text, createdAt: null, source: 'canonical' as const, readOnly: false })),
  ...overrides,
});

const mount = (patientId: string, repo: MessageRepository) => {
  const hooks = new HookRuntime(); let currentPatient = patientId;
  const useRenderedConversation = () => useMessageConversation(currentPatient, repo);
  // oxlint-disable-next-line react-hooks/rules-of-hooks -- custom mounted hook harness supplies the dispatcher
  const render = () => { hooks.begin(); const result = useRenderedConversation(); hooks.commit(); return result; };
  return { hooks, render, setPatient: (value: string) => { currentPatient = value; } };
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

describe('mounted message conversation interactions', () => {
  beforeEach(() => { runtime.current = null; });

  it('keeps draft/failure/retry state scoped to the selected patient relationship', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({});
    const repo = repository({ sendPreparedMessage: send }); const view = mount('patient-1', repo);
    view.render(); await flush(); let result = view.render(); result.setDraft('Patient one draft'); result = view.render();
    await result.send(); result = view.render(); expect(result.failedAttempt?.relationship.key).toBe('patient-1/clinician-1');
    view.setPatient('patient-2'); view.render(); await flush(); result = view.render();
    expect(result.draft).toBe(''); expect(result.failedAttempt).toBeNull(); await expect(result.retry()).rejects.toThrow('no retry');
    view.setPatient('patient-1'); view.render(); await flush(); result = view.render();
    expect(result.draft).toBe('Patient one draft'); expect(result.failedAttempt?.relationship.key).toBe('patient-1/clinician-1');
    const failedId = result.failedAttempt?.id; await result.retry(); result = view.render();
    expect(send).toHaveBeenCalledTimes(2); expect((send.mock.calls[1][0] as PreparedMessage).id).toBe(failedId); expect(result.draft).toBe('');
    view.hooks.unmount();
  });

  it('ignores stale completion after a patient switch and disposes the old listener', async () => {
    let resolveFirst!: (value: MessageRelationship) => void;
    const first = new Promise<MessageRelationship>((resolve) => { resolveFirst = resolve; }); const unsubscribe = vi.fn();
    const repo = repository({ resolveActiveRelationship: vi.fn((patientId) => patientId === 'patient-1' ? first : Promise.resolve(relationship(patientId))), subscribeToMessages: vi.fn(() => unsubscribe) });
    const view = mount('patient-1', repo); view.render(); view.setPatient('patient-2'); view.render(); await flush(); let result = view.render();
    expect(result.relationship?.patientId).toBe('patient-2');
    resolveFirst(relationship('patient-1')); await flush(); result = view.render(); expect(result.relationship?.patientId).toBe('patient-2');
    view.hooks.unmount(); expect(unsubscribe).toHaveBeenCalled();
  });

  it('exposes initial read failure and recovers through explicit retry', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(relationship('patient-1'));
    const view = mount('patient-1', repository({ resolveActiveRelationship: resolve })); view.render(); await flush(); let result = view.render();
    expect(result.loadState).toBe('error'); expect(result.loadError).toBe('offline'); result.retryLoad(); view.render(); await flush(); result = view.render();
    expect(result.loadState).toBe('ready'); expect(resolve).toHaveBeenCalledTimes(2); view.hooks.unmount();
  });

  it('renders zero prior-relationship content synchronously and drops stale pagination completion', async () => {
    let resolveOlder!: (value: Awaited<ReturnType<MessageRepository['listMessages']>>) => void;
    const older = new Promise<Awaited<ReturnType<MessageRepository['listMessages']>>>((resolve) => { resolveOlder = resolve; });
    const oldMessage = { id: 'old', relationshipKey: 'patient-1/clinician-1', patientId: 'patient-1', clinicianId: 'clinician-1', senderId: 'patient-1', senderRole: 'patient' as const, text: 'Old private content', createdAt: new Date(), source: 'canonical' as const, readOnly: false };
    const listMessages = vi.fn((value: MessageRelationship, _size?: number, cursor?: unknown) => {
      if (cursor) return older;
      return Promise.resolve({ messages: value.patientId === 'patient-1' ? [oldMessage] : [], nextCursor: value.patientId === 'patient-1' ? { relationshipKey: value.key, createdAt: {}, id: 'old' } : null });
    });
    const view = mount('patient-1', repository({ listMessages })); view.render(); await flush(); let result = view.render();
    expect(result.messages.map(({ text }) => text)).toEqual(['Old private content']);
    const olderRequest = result.loadOlder();
    view.setPatient('patient-2'); result = view.render();
    expect(result.messages).toEqual([]); expect(result.relationship).toBeNull();
    await flush(); result = view.render(); expect(result.relationship?.patientId).toBe('patient-2');
    resolveOlder({ messages: [{ ...oldMessage, id: 'older', text: 'Stale older content' }], nextCursor: null });
    await olderRequest; result = view.render();
    expect(result.messages).toEqual([]); expect(result.cursor).toBeNull(); view.hooks.unmount();
  });

  it('ignores a stale older-page rejection after switching patients', async () => {
    let rejectOlder!: (error: Error) => void;
    const older = new Promise<Awaited<ReturnType<MessageRepository['listMessages']>>>((_resolve, reject) => { rejectOlder = reject; });
    const listMessages = vi.fn((value: MessageRelationship, _size?: number, cursor?: unknown) => cursor
      ? older
      : Promise.resolve({ messages: [], nextCursor: value.patientId === 'patient-1' ? { relationshipKey: value.key, createdAt: {}, id: 'cursor' } : null }));
    const view = mount('patient-1', repository({ listMessages })); view.render(); await flush(); let result = view.render();
    const olderRequest = result.loadOlder();
    view.setPatient('patient-2'); view.render(); await flush(); result = view.render();
    expect(result.loadState).toBe('ready'); expect(result.loadError).toBeNull();
    rejectOlder(new Error('stale offline failure')); await olderRequest; result = view.render();
    expect(result.relationship?.patientId).toBe('patient-2'); expect(result.loadState).toBe('ready'); expect(result.loadError).toBeNull();
    view.hooks.unmount();
  });

  it('does not let an older overlapping completion clear the newer loading indicator', async () => {
    const pending: Array<{ promise: Promise<Awaited<ReturnType<MessageRepository['listMessages']>>>; resolve: (value: Awaited<ReturnType<MessageRepository['listMessages']>>) => void }> = [];
    const listMessages = vi.fn((value: MessageRelationship, _size?: number, cursor?: unknown) => {
      if (!cursor) return Promise.resolve({ messages: [], nextCursor: { relationshipKey: value.key, createdAt: {}, id: 'cursor' } });
      let resolve!: (value: Awaited<ReturnType<MessageRepository['listMessages']>>) => void;
      const promise = new Promise<Awaited<ReturnType<MessageRepository['listMessages']>>>((done) => { resolve = done; });
      pending.push({ promise, resolve }); return promise;
    });
    const view = mount('patient-1', repository({ listMessages })); view.render(); await flush(); let result = view.render();
    const first = result.loadOlder(); const second = result.loadOlder(); result = view.render(); expect(result.isLoadingOlder).toBe(true);
    pending[0].resolve({ messages: [], nextCursor: null }); await first; result = view.render();
    expect(result.isLoadingOlder).toBe(true);
    pending[1].resolve({ messages: [], nextCursor: null }); await second; result = view.render();
    expect(result.isLoadingOlder).toBe(false); view.hooks.unmount();
  });
});
