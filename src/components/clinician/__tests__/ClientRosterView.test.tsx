import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { ClientRosterView } from '../ClientRosterView';

const blankClient: ClientProfile = {
  id: 'patient-1',
  name: 'Blank Patient',
  email: 'blank@example.com',
  status: 'active',
  allowedExperiences: [],
  brainMaps: [],
  badges: [],
  completedSessionsCount: 0,
  currentStreak: 0,
};

describe('ClientRosterView blank-profile editing', () => {
  it('keeps unavailable clinical fields absent when saving unrelated edits', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView
        clients={[blankClient]}
        invitations={[]}
        onSelectClient={vi.fn()}
        onAddClient={vi.fn()}
        onCancelInvitation={vi.fn()}
        onUpdateClient={onUpdateClient}
      />);
    });

    act(() => renderer.root.findByProps({ title: 'Edit Patient' }).props.onClick({ stopPropagation: vi.fn() }));
    const selects = renderer.root.findAllByType('select');
    expect(selects.map((select) => select.props.value)).toContain('');
    const weeklyTarget = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'Unavailable');
    expect(weeklyTarget?.props.value).toBe('');

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onUpdateClient).toHaveBeenCalledWith(expect.objectContaining({
      id: 'patient-1',
      condition: undefined,
      assignedProtocol: undefined,
      prescribedSessionsPerWeek: undefined,
    }));
    renderer.unmount();
  });

  it('starts invitations unassigned and requires explicit clinical selections', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onAddClient = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView
        clients={[]}
        invitations={[]}
        onSelectClient={vi.fn()}
        onAddClient={onAddClient}
        onCancelInvitation={vi.fn()}
      />);
    });
    act(() => renderer.root.findAllByType('button')[0].props.onClick());
    const inputs = renderer.root.findAllByType('input');
    act(() => inputs.find((input) => input.props.placeholder === 'e.g. Alex Morgan')!.props.onChange({ target: { value: 'New Patient' } }));
    expect(renderer.root.findAllByType('select').map((select) => select.props.value)).toEqual(expect.arrayContaining(['', '']));
    expect(inputs.find((input) => input.props.placeholder === 'Unavailable')?.props.value).toBe('');

    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
    expect(onAddClient).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Select a clinical indication');
    renderer.unmount();
  });

  it('submits explicit clearing for persisted clinical assignment fields', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const assigned: ClientProfile = {
      ...blankClient,
      condition: 'Peak Performance',
      assignedProtocol: 'theta-beta-ratio',
      prescribedSessionsPerWeek: 4,
    };
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView clients={[assigned]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onUpdateClient={onUpdateClient} />);
    });
    act(() => renderer.root.findByProps({ title: 'Edit Patient' }).props.onClick({ stopPropagation: vi.fn() }));
    const selects = renderer.root.findAllByType('select');
    act(() => selects[0].props.onChange({ target: { value: '' } }));
    act(() => selects[1].props.onChange({ target: { value: '' } }));
    const weeklyTarget = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'Unavailable')!;
    act(() => weeklyTarget.props.onChange({ target: { value: '' } }));
    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });

    expect(onUpdateClient).toHaveBeenCalledWith(expect.objectContaining({
      condition: undefined,
      assignedProtocol: undefined,
      prescribedSessionsPerWeek: undefined,
      customProtocolConfig: undefined,
    }));
    renderer.unmount();
  });
});
