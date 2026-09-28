import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
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
  it('omits capacity on desktop and mobile and keeps the empty table span aligned', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ClientRosterView clients={[blankClient]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} />); });
    expect(renderer.root.findAllByType('th').map((cell) => cell.children.join(''))).toEqual([
      'Client Name', 'Status', 'Condition / Protocol', 'Last Session', 'Sessions', 'Actions',
    ]);
    expect(renderer.root.findAllByType('tbody')[0].findAllByType('tr')[0].findAllByType('td')).toHaveLength(6);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Capacity: unavailable');
    await act(async () => { renderer.update(<ClientRosterView clients={[]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} />); });
    expect(renderer.root.findByType('tbody').findByType('td').props.colSpan).toBe(6);
    await act(async () => { renderer.unmount(); });
  });

  it('changes a condition without replacing the saved protocol and shows it after refresh', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const customProtocolConfig = {
      ...getClinicalProtocolTemplate('alpha-enhancement')!,
      alias: 'Evening Alpha',
    };
    const assigned: ClientProfile = {
      ...blankClient,
      condition: 'ADHD (Inattentive)',
      customProtocolConfig,
    };
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView clients={[assigned]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onUpdateClient={onUpdateClient} />);
    });
    act(() => renderer.root.findByProps({ title: 'Edit Patient' }).props.onClick({ stopPropagation: vi.fn() }));
    act(() => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'Generalized Anxiety' } }));
    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });
    const saved = onUpdateClient.mock.calls[0][0] as ClientProfile;
    expect(saved).toMatchObject({ condition: 'Generalized Anxiety' });
    expect(saved.assignedProtocol).toBeUndefined();
    expect(saved.customProtocolConfig).toBe(customProtocolConfig);
    await act(async () => {
      renderer.update(<ClientRosterView clients={[saved]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onUpdateClient={onUpdateClient} />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Generalized Anxiety');
    expect(JSON.stringify(renderer.toJSON())).toContain(getClinicalProtocolTemplate('alpha-enhancement')!.name);
    renderer.unmount();
  });

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
    const weeklyTarget = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'e.g. 3');
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
    expect(inputs.find((input) => input.props.placeholder === 'e.g. 3')?.props.value).toBe('');

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
    const weeklyTarget = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'e.g. 3')!;
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

  it('drops a stale custom template when switching the assigned protocol', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const assigned: ClientProfile = {
      ...blankClient,
      condition: 'Peak Performance',
      assignedProtocol: 'theta-beta-ratio',
      prescribedSessionsPerWeek: 4,
      customProtocolConfig: {
        id: 'custom-tbr', protocolType: 'theta-beta-ratio', name: 'TBR', clinicalName: 'TBR',
        leadInvestigator: '', indication: '', montageSite: '',
        rewardBand: { name: 'TBR', freqMin: 4, freqMax: 30, targetCondition: 'below', targetThreshold: 1.8 },
        adaptiveStep: 0.1, sensitivity: 'balanced', sessionDurationMinutes: 20,
        recommendedExperiences: [], clinicalNotes: '',
      },
    };
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView clients={[assigned]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onUpdateClient={onUpdateClient} />);
    });
    act(() => renderer.root.findByProps({ title: 'Edit Patient' }).props.onClick({ stopPropagation: vi.fn() }));
    const protocolSelect = renderer.root.findAllByType('select')[1];
    act(() => protocolSelect.props.onChange({ target: { value: 'alpha-enhancement' } }));
    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });

    expect(onUpdateClient).toHaveBeenCalledWith(expect.objectContaining({
      assignedProtocol: 'alpha-enhancement',
      customProtocolConfig: undefined,
      allowedExperiences: getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences,
    }));
    renderer.unmount();
  });

  it('preserves an unrecognized legacy custom template on an unrelated edit', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const legacyTemplate = {
      id: 'legacy-unknown', name: 'Legacy configuration', clinicalName: '',
    } as ClientProfile['customProtocolConfig'];
    const assigned: ClientProfile = {
      ...blankClient,
      condition: 'Peak Performance',
      assignedProtocol: 'theta-beta-ratio',
      prescribedSessionsPerWeek: 4,
      customProtocolConfig: legacyTemplate,
    };
    const onUpdateClient = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientRosterView clients={[assigned]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} onUpdateClient={onUpdateClient} />);
    });
    act(() => renderer.root.findByProps({ title: 'Edit Patient' }).props.onClick({ stopPropagation: vi.fn() }));
    const nameInput = renderer.root.findAllByType('input').find((input) => input.props.placeholder === 'e.g. Alex Morgan')!;
    act(() => nameInput.props.onChange({ target: { value: 'Renamed Patient' } }));
    await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }); });

    expect(onUpdateClient).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Renamed Patient',
      assignedProtocol: 'theta-beta-ratio',
      customProtocolConfig: legacyTemplate,
    }));
    renderer.unmount();
  });
});
