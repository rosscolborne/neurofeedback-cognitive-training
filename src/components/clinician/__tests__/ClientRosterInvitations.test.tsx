import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientInvitation } from '../../../types';
import { ClientRosterView } from '../ClientRosterView';

const now = Date.parse('2026-09-27T12:00:00Z');
const invitation = (id: string, status: PatientInvitation['status'] = 'pending', overrides: Partial<PatientInvitation> = {}): PatientInvitation => ({
  id, clinicianId: 'clinician-1', clinicianName: 'Clinician', patientEmail: `${id}@example.test`,
  patientName: id, condition: 'Peak Performance', assignedProtocol: 'alpha-enhancement',
  prescribedSessionsPerWeek: 2, status, schemaVersion: 1,
  createdAt: now - 86_400_000, expiresAt: now + 60_000, ...overrides,
});

describe('ClientRosterView invitations', () => {
  let renderer: ReactTestRenderer;
  let focusHandler: (() => void) | undefined;
  const onCancelInvitation = vi.fn().mockResolvedValue(undefined);
  const onAddClient = vi.fn();
  const render = async (invitations: PatientInvitation[]) => {
    await act(async () => { renderer = create(<ClientRosterView clients={[]} invitations={invitations} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />); });
  };
  const text = () => JSON.stringify(renderer.toJSON());
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.join('').includes(label));

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    focusHandler = undefined;
    onCancelInvitation.mockClear();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      location: { origin: 'https://example.test' },
      addEventListener: vi.fn((event: string, handler: () => void) => { if (event === 'focus') focusHandler = handler; }),
      removeEventListener: vi.fn(),
    } });
  });
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); });

  it('copies the same pending link after the creation modal is closed', async () => {
    const created = invitation('invite-1');
    onAddClient.mockResolvedValueOnce(created);
    await render([]);
    act(() => button('Invite Patient')!.props.onClick());
    act(() => {
      renderer.root.findAllByType('input').find((node) => node.props.placeholder === 'e.g. Alex Morgan')!.props.onChange({ target: { value: 'Patient' } });
      renderer.root.findAllByType('input').find((node) => node.props.placeholder === 'patient@example.com')!.props.onChange({ target: { value: created.patientEmail } });
      renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'Peak Performance' } });
      renderer.root.findAllByType('select')[1].props.onChange({ target: { value: 'alpha-enhancement' } });
      renderer.root.findAllByType('input').find((node) => node.props.placeholder === 'e.g. 3')!.props.onChange({ target: { value: '2' } });
    });
    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
    await act(async () => { await button('Copy invitation link')!.props.onClick(); });
    act(() => button('Done')!.props.onClick());
    await act(async () => { renderer.update(<ClientRosterView clients={[]} invitations={[created]} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />); });
    await act(async () => { await button('Copy link')!.props.onClick(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls.map(([url]) => url)).toEqual(['https://example.test/#/connect/invite-1', 'https://example.test/#/connect/invite-1']);
    expect(text()).toContain('Link copied');
  });

  it('shows clipboard failure and leaves the code available for manual sharing', async () => {
    await render([invitation('invite-2')]);
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    await act(async () => { await button('Copy link')!.props.onClick(); });
    expect(text()).toContain('Copy was blocked');
    expect(text()).toContain('invite-2');
  });

  it('formats numeric and Firestore expiries with timezone and labels missing or invalid expiries honestly', async () => {
    await render([
      invitation('number'), invitation('firestore', 'pending', { expiresAt: { seconds: (now + 120_000) / 1000, nanoseconds: 0 } }),
      invitation('timestamp-object', 'pending', { expiresAt: { seconds: (now + 180_000) / 1000, toDate: () => new Date(now + 180_000) } }),
      invitation('invalid', 'pending', { expiresAt: 'not-a-date' }), invitation('missing', 'pending', { expiresAt: undefined }),
      invitation('out-of-range', 'pending', { expiresAt: 1e20 }),
    ]);
    expect(text().match(/Expires /g)).toHaveLength(3);
    expect(text().match(/Expiry unavailable/g)).toHaveLength(3);
    expect(text()).toMatch(/UTC|GMT|EDT|EST/);
    expect(text()).toContain('Expiry unavailable');
    expect(text()).not.toContain('Invalid Date');
  });

  it('separates terminal history, orders it newest first, and has no terminal actions', async () => {
    await render([
      invitation('older', 'accepted', { createdAt: now - 5000, acceptedAt: now - 2000 }),
      invitation('newer', 'cancelled', { createdAt: now - 1000, updatedAt: now - 500 }),
      invitation('expired', 'pending', { expiresAt: now - 1, createdAt: now - 3000 }),
      invitation('active'),
    ]);
    expect(text()).toContain('Pending invitations');
    expect(text()).not.toContain('older@example.test');
    act(() => button('Invitation history')!.props.onClick());
    const output = text();
    expect(output.indexOf('newer')).toBeLessThan(output.indexOf('expired'));
    expect(output.indexOf('expired')).toBeLessThan(output.indexOf('older'));
    expect(output).toContain('Accepted');
    expect(output).toContain('Cancelled');
    expect(output).toContain('Expired');
    expect(renderer.root.findAllByType('button').filter((node) => node.children.join('').includes('Copy link'))).toHaveLength(1);
    expect(renderer.root.findAllByType('button').filter((node) => node.children.join('') === 'Cancel')).toHaveLength(1);
    expect(onCancelInvitation).not.toHaveBeenCalled();
  });

  it('moves a pending invitation to display-only expired history when the clock crosses expiry', async () => {
    const crossing = invitation('crossing', 'pending', { expiresAt: now + 1000 });
    await render([crossing]);
    expect(text()).toContain('Pending invitations');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(text()).not.toContain('Pending invitations');
    act(() => button('Invitation history')!.props.onClick());
    expect(text()).toContain('Expired');
    expect(button('Copy link')).toBeUndefined();
    expect(onCancelInvitation).not.toHaveBeenCalled();
    expect(crossing.status).toBe('pending');
  });

  it('catches expiry crossing between render and passive timer setup without repeated zero-delay timers', async () => {
    const crossing = invitation('layout-crossing', 'pending', { expiresAt: now + 1000 });
    const AdvanceAfterChildRender = () => {
      React.useLayoutEffect(() => { vi.setSystemTime(now + 2000); }, []);
      return <ClientRosterView clients={[]} invitations={[crossing]} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />;
    };
    await act(async () => { renderer = create(<AdvanceAfterChildRender />); });
    expect(text()).toContain('Pending invitations');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(text()).not.toContain('Pending invitations');
    expect(button('Copy link')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('blocks stale copy and cancel clicks after expiry even before a delayed timer runs', async () => {
    await render([invitation('stale', 'pending', { expiresAt: now + 1000 })]);
    const copy = button('Copy link')!;
    const cancel = button('Cancel')!;
    vi.setSystemTime(now + 2000);
    await act(async () => { await copy.props.onClick(); await cancel.props.onClick(); });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(button('Cancel')).toBeUndefined();
    expect(onCancelInvitation).not.toHaveBeenCalled();
  });

  it('classifies a newly supplied past expiry on the first render after wall time advances', async () => {
    await render([]);
    vi.setSystemTime(now + 2000);
    await act(async () => {
      renderer.update(<ClientRosterView clients={[]} invitations={[invitation('late', 'pending', { expiresAt: now + 1000 })]} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />);
    });
    expect(text()).not.toContain('Pending invitations');
    expect(button('Copy link')).toBeUndefined();
    act(() => button('Invitation history')!.props.onClick());
    expect(text()).toContain('Expired');
  });

  it('classifies an existing pending invitation on an unrelated rerender after wall time advances', async () => {
    const pending = invitation('resumed', 'pending', { expiresAt: now + 1000 });
    await render([pending]);
    vi.setSystemTime(now + 2000);
    await act(async () => {
      renderer.update(<ClientRosterView clients={[]} invitations={[pending]} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />);
    });
    expect(button('Copy link')).toBeUndefined();
    expect(text()).not.toContain('Pending invitations');
  });

  it('refreshes an existing open view on window focus after a suspended timer', async () => {
    await render([invitation('focused', 'pending', { expiresAt: now + 1000 })]);
    expect(focusHandler).toBeTypeOf('function');
    vi.setSystemTime(now + 2000);
    act(() => focusHandler!());
    expect(button('Copy link')).toBeUndefined();
    expect(text()).not.toContain('Pending invitations');
  });

  it('does not present the creation timestamp as a cancellation time after a status-only update', async () => {
    const pending = invitation('status-only', 'pending', { createdAt: now - 86_400_000, updatedAt: now - 86_400_000 });
    await render([pending]);
    await act(async () => {
      renderer.update(<ClientRosterView clients={[]} invitations={[{ ...pending, status: 'cancelled' }]} onSelectClient={vi.fn()} onAddClient={onAddClient} onCancelInvitation={onCancelInvitation} />);
    });
    act(() => button('Invitation history')!.props.onClick());
    expect(text()).toContain('Cancelled');
    expect(text()).toContain('Cancellation date unavailable');
    expect(button('Copy link')).toBeUndefined();
  });

  it('shows an honest empty history state', async () => {
    await render([]);
    act(() => button('Invitation history')!.props.onClick());
    expect(text()).toContain('No past invitations yet.');
  });
});
