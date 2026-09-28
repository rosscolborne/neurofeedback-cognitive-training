import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../../types';

const storage = vi.hoisted(() => ({ getSessions: vi.fn(), getBrainMaps: vi.fn() }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: storage }));
vi.mock('../ProtocolBuilderModal', () => ({ ProtocolBuilderModal: 'protocol-builder' }));
vi.mock('../BrainMapUploadModal', () => ({ BrainMapUploadModal: 'brain-map-upload' }));
vi.mock('../PatientAvatar', () => ({ PatientAvatar: 'patient-avatar' }));
import { ClientDetailView } from '../ClientDetailView';

const client = (assignment?: ClientProfile['assignedDevice']): ClientProfile => ({
  id: 'patient', name: 'Patient', email: 'patient@example.test', status: 'active', assignedProtocol: 'theta-beta-ratio',
  assignedDevice: assignment, allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
});
const session = (index: number, score?: number): SessionRecord => ({
  id: `session-${index}`, patientId: 'patient', patientName: 'Patient', clinicId: 'clinic',
  date: 'Sep 27, 2026', timestamp: 1000 + index, protocol: 'theta-beta-ratio', experience: 'tidal-garden',
  durationSeconds: 60, timeInZonePercent: 50, averageCoherence: null, timeSeries: [], adaptiveAdjustmentsCount: 0,
  finalThreshold: 0, learningRateScore: score,
  averageBands: { delta: 1, theta: 2, alpha: 3, smr: 0, beta: 4, gamma: 0 },
  metricProvenance: { averageBands: { algorithm: 'welch-psd', version: '1', source: 'brainflow' } },
});
const props = { brand: { name: 'Clinic' } as ClinicBrandConfig, onBack: vi.fn(), onUpdateClient: vi.fn(), onSendMessage: vi.fn() };
const render = async (sessions: SessionRecord[], profile = client()) => {
  storage.getSessions.mockResolvedValue(sessions);
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<ClientDetailView {...props} client={profile} />); });
  return view;
};
const nodeText = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : nodeText(child)).join('');
const labels = (view: ReactTestRenderer) => view.root.findAllByType('button').map(nodeText).join(' ');

describe('clinician detail optional metric surfaces', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    storage.getBrainMaps.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('hides absent scores and device, removes live telemetry, and retains measured PSD and session review', async () => {
    const view = await render([session(1)]);
    const output = JSON.stringify(view.toJSON());
    expect(labels(view)).not.toContain('Live Telemetry');
    expect(output).not.toContain('Self-Regulation Learning Curve');
    expect(output).not.toContain('Assigned device');
    expect(output).toContain('Spectral Power Distribution');
    expect(view.root.findAllByType('td').map(nodeText)).toEqual(['1', '2', '3', '4']);
    expect(labels(view)).toContain('Session Logs (1)');
    await act(async () => { view.root.findAllByType('button').find((button) => nodeText(button).includes('Session Logs (1)'))!.props.onClick(); });
    expect(view.root.findAllByType('button').some((button) => button.props['aria-label'] === 'Open session-1')).toBe(true);
    await act(async () => { view.unmount(); });
  });

  it('shows a genuine assigned display name or model, but no whitespace placeholder', async () => {
    const assignment = { deviceId: 'device', patientId: 'patient', model: 'Model A', displayName: 'Clinic headset' };
    const view = await render([], client(assignment));
    expect(JSON.stringify(view.toJSON())).toContain('Assigned device:');
    expect(JSON.stringify(view.toJSON())).toContain('Clinic headset');
    await act(async () => { view.update(<ClientDetailView {...props} client={client({ ...assignment, displayName: '  ' })} />); });
    expect(JSON.stringify(view.toJSON())).toContain('Model A');
    await act(async () => { view.update(<ClientDetailView {...props} client={client({ ...assignment, model: ' ', displayName: ' ' })} />); });
    expect(JSON.stringify(view.toJSON())).not.toContain('Assigned device:');
    await act(async () => { view.unmount(); });
  });

  it.each([2, 8, 30])('fits %i persisted scored sessions inside the learning chart', async (count) => {
    const view = await render(Array.from({ length: count }, (_, index) => session(index, index === 0 ? 0 : 100)));
    expect(JSON.stringify(view.toJSON())).toContain('Self-Regulation Learning Curve');
    const chart = view.root.findAllByType('svg').find((svg) => svg.props.viewBox === '0 0 700 160')!;
    const points = chart.findAllByType('circle');
    expect(points).toHaveLength(count);
    const xs = points.map((point) => Number(point.props.cx));
    expect(xs[0]).toBeGreaterThanOrEqual(35);
    expect(xs.at(-1)).toBeLessThanOrEqual(680);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(chart.findByType('path').props.d).toContain(`M ${xs[0]} 140`);
    await act(async () => { view.unmount(); });
  });
});
