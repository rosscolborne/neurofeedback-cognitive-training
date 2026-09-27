import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { readClientProfile } from '../../../services/dataMappers';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));

import { ClientDetailView } from '../ClientDetailView';

describe('clinician protocol experience assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getSessions.mockResolvedValue([]);
    storage.getBrainMaps.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('submits the selected template list without NeuroGambit', async () => {
    const client: ClientProfile = {
      id: 'patient-one', name: 'Patient One', email: 'patient@example.test', status: 'active',
      assignedProtocol: 'theta-beta-ratio', allowedExperiences: ['skyline-drift', 'neuro-gambit'],
      brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
    };
    const onUpdateClient = vi.fn(async (_updated: ClientProfile) => {});
    const template = getClinicalProtocolTemplate('alpha-enhancement')!;
    expect(template.recommendedExperiences).not.toContain('neuro-gambit');
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ClientDetailView client={client} brand={{ name: 'Clinic' } as ClinicBrandConfig}
        onBack={vi.fn()} onUpdateClient={onUpdateClient} onSendMessage={vi.fn()} />);
    });
    const adjust = renderer.root.findAllByType('button').find((button) => button.children.includes(' Adjust Protocol'))!;
    await act(async () => { adjust.props.onClick(); });
    await act(async () => { await renderer.root.find((node) => (node.type as unknown) === 'protocol-builder').props.onSave(template); });
    expect(onUpdateClient).toHaveBeenCalledOnce();
    const saved = onUpdateClient.mock.calls[0][0];
    expect(saved.allowedExperiences).toEqual(template.recommendedExperiences);
    expect(readClientProfile(saved).allowedExperiences).not.toContain('neuro-gambit');
    await act(async () => { renderer.unmount(); });
  });
});
