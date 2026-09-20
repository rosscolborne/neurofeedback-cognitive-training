import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  saveClient: vi.fn(),
  getCurrentClient: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'patient-1', displayName: 'Patient One' } }) }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: { saveClient: state.saveClient, getCurrentClient: state.getCurrentClient } }));
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

const card = (renderer: ReactTestRenderer): ReactTestInstance =>
  renderer.root.find((node) => (node.type as unknown) === 'neural-imprint-card');

describe('HardwareSetup baseline persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    state.getCurrentClient.mockResolvedValue({ id: 'patient-1', name: 'Patient One' });
  });

  it('keeps the calibration result visible and does not navigate when saving fails', async () => {
    state.saveClient.mockRejectedValueOnce(new Error('baseline save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="reveal" />); });

    await act(async () => { await card(renderer).props.onSave(); });

    expect(state.saveClient).toHaveBeenCalledOnce();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('baseline save offline');
    expect(card(renderer).props.saving).toBe(false);
    renderer.unmount();
  });
});
