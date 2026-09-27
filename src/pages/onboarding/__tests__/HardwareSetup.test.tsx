import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { user: { uid: 'patient-1', displayName: 'Patient One' }, role: 'patient', isDemoWorkspace: false } as { user: { uid: string; displayName?: string } | null; role: string | null; isDemoWorkspace: boolean },
  saveClient: vi.fn(),
  saveIndividualBaselineModel: vi.fn(),
  getCurrentClient: vi.fn(),
  getExistingCurrentClient: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { saveClient: state.saveClient, saveIndividualBaselineModel: state.saveIndividualBaselineModel, getCurrentClient: state.getCurrentClient, getExistingCurrentClient: state.getExistingCurrentClient } }));
vi.mock('../../../services/audioEngine', () => ({ audioEngine: { playChime: vi.fn() } }));
vi.mock('../../../services/eegEngine', () => ({
  eegEngine: {
    subscribe: vi.fn(() => vi.fn()),
    getLatestSpectrum: vi.fn(() => []),
    getLatestBands: vi.fn(() => null),
    individualBaselineModel: null,
  },
}));
vi.mock('../../../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../../../components/onboarding/LiveBrainwaveCanvas', () => ({ LiveBrainwaveCanvas: 'brainwave-canvas' }));
vi.mock('../../../components/onboarding/NeuralImprintCard', () => ({ NeuralImprintCard: 'neural-imprint-card' }));

import { HardwareSetup } from '../HardwareSetup';
import { eegEngine } from '../../../services/eegEngine';

const card = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.find((node) => (node.type as unknown) === 'neural-imprint-card');

describe('HardwareSetup baseline persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth = { user: { uid: 'patient-1', displayName: 'Patient One' }, role: 'patient', isDemoWorkspace: false };
    eegEngine.individualBaselineModel = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.getExistingCurrentClient.mockResolvedValue({ id: 'patient-1', name: 'Patient One' });
  });

  it.each(['paused', 'completed'] as const)('persists only the baseline for a %s patient', async (status) => {
    state.getExistingCurrentClient.mockResolvedValueOnce({ id: 'patient-1', status, notes: 'concurrent clinical notes' });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });

    await act(async () => { await card(renderer).props.onSave(); });

    expect(state.saveIndividualBaselineModel).toHaveBeenCalledOnce();
    const [patientId, baseline] = state.saveIndividualBaselineModel.mock.calls[0];
    expect(patientId).toBe('patient-1');
    expect(baseline).toMatchObject({ alphaPeakHz: 10, oneOverFSlope: 1 });
    expect(typeof baseline.lastCalibratedAt).toBe('string');
    expect(state.saveClient).not.toHaveBeenCalled();
    expect(state.getCurrentClient).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith('/');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps the calibration result visible and does not navigate when saving fails', async () => {
    state.saveIndividualBaselineModel.mockRejectedValueOnce(new Error('baseline save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });

    await act(async () => { await card(renderer).props.onSave(); });

    expect(state.saveIndividualBaselineModel).toHaveBeenCalledOnce();
    expect(state.saveClient).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('baseline save offline');
    expect(card(renderer).props.saving).toBe(false);
    await act(async () => { renderer.unmount(); });
  });

  it('does not write or navigate when the patient profile is missing', async () => {
    state.getExistingCurrentClient.mockResolvedValueOnce(null);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });

    await act(async () => { await card(renderer).props.onSave(); });

    expect(state.saveIndividualBaselineModel).not.toHaveBeenCalled();
    expect(state.getCurrentClient).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('patient profile is unavailable');
    await act(async () => { renderer.unmount(); });
  });

  it('does not write after a late lookup when the initiating patient has changed', async () => {
    let resolveLookup!: (value: unknown) => void;
    state.getExistingCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });
    let pending!: Promise<void>;
    act(() => { pending = card(renderer).props.onSave(); });
    state.auth = { user: { uid: 'patient-2' }, role: 'patient', isDemoWorkspace: false };
    await act(async () => { renderer.update(<HardwareSetup initialStep="reveal" />); });
    await act(async () => { resolveLookup({ id: 'patient-1' }); await pending; });
    expect(state.saveIndividualBaselineModel).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it.each([
    { role: 'clinician', isDemoWorkspace: false },
    { role: 'patient', isDemoWorkspace: true },
  ])('does not write after a late lookup when role/workspace changes to $role/$isDemoWorkspace', async (nextIdentity) => {
    let resolveLookup!: (value: unknown) => void;
    state.getExistingCurrentClient.mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });
    let pending!: Promise<void>;
    act(() => { pending = card(renderer).props.onSave(); });
    state.auth = { ...state.auth, ...nextIdentity };
    await act(async () => { renderer.update(<HardwareSetup initialStep="reveal" />); });
    await act(async () => { resolveLookup({ id: 'patient-1' }); await pending; });
    expect(state.saveIndividualBaselineModel).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('does not overwrite another account baseline after a late save or unmount', async () => {
    let resolveSave!: () => void;
    state.saveIndividualBaselineModel.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });
    let pending!: Promise<void>;
    act(() => { pending = card(renderer).props.onSave(); });
    await act(async () => { await Promise.resolve(); });
    state.auth = { user: { uid: 'patient-2' }, role: 'patient', isDemoWorkspace: false };
    await act(async () => { renderer.update(<HardwareSetup initialStep="reveal" />); });
    const patientTwoModel = { alphaPeakHz: 11, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T09:00:00Z' };
    eegEngine.individualBaselineModel = patientTwoModel;
    await act(async () => { resolveSave(); await pending; });
    expect(eegEngine.individualBaselineModel).toBe(patientTwoModel);
    expect(state.navigate).not.toHaveBeenCalled();
    renderer.unmount();

    state.auth = { user: { uid: 'patient-1' }, role: 'patient', isDemoWorkspace: false };
    state.saveIndividualBaselineModel.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });
    act(() => { pending = card(renderer).props.onSave(); });
    await act(async () => { await Promise.resolve(); renderer.unmount(); });
    eegEngine.individualBaselineModel = patientTwoModel;
    await act(async () => { resolveSave(); await pending; });
    expect(eegEngine.individualBaselineModel).toBe(patientTwoModel);
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
