import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));

import { ClientDetailView } from '../ClientDetailView';

const client = (id: string, individualBaselineModel?: ClientProfile['individualBaselineModel']): ClientProfile => ({
  id, name: `Patient ${id}`, email: `${id}@example.test`, status: 'active',
  assignedProtocol: 'theta-beta-ratio', allowedExperiences: [], brainMaps: [], badges: [],
  completedSessionsCount: 0, currentStreak: 0, individualBaselineModel,
});
const brand = { name: 'Clinic' } as ClinicBrandConfig;

describe('clinician Neural Imprint status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getSessions.mockResolvedValue([]);
    storage.getBrainMaps.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows the selected patient calibration date and updates on patient switch', async () => {
    const model = { alphaPeakHz: 9.7, oneOverFSlope: 1.2, lastCalibratedAt: '2026-09-26T12:00:00Z' };
    let renderer!: ReactTestRenderer;
    const props = { brand, onBack: vi.fn(), onUpdateClient: vi.fn(), onSendMessage: vi.fn() };
    await act(async () => { renderer = create(<ClientDetailView {...props} client={client('a', model)} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Neural Imprint:');
    expect(JSON.stringify(renderer.toJSON())).toContain('Current');
    expect(renderer.root.findAllByType('time').map((node) => node.props.dateTime)).toContain('2026-09-26T12:00:00.000Z');

    await act(async () => { renderer.update(<ClientDetailView {...props} client={client('b')} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Not calibrated');
    expect(renderer.root.findAllByType('time').map((node) => node.props.dateTime)).not.toContain('2026-09-26T12:00:00.000Z');

    await act(async () => { renderer.update(<ClientDetailView {...props} client={client('c', { ...model, expiresAt: 0 })} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Expired');
    renderer.unmount();
  });

  it('exposes the detail Schedule action for the selected patient', async () => {
    const onScheduleClient = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ClientDetailView client={client('b')} brand={brand} onBack={vi.fn()} onUpdateClient={vi.fn()} onSendMessage={vi.fn()} onScheduleClient={onScheduleClient} />); });
    const schedule = renderer.root.findAllByType('button').find((node) => node.children.some((child) => child === ' Schedule'))!;
    await act(async () => schedule.props.onClick());
    expect(onScheduleClient).toHaveBeenCalledOnce();
  });
});
