import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { resolveProtocolRuntime } from '../../../services/adaptiveEngine';
import { ProtocolDetailsModal } from '../ProtocolDetailsModal';

const template = getClinicalProtocolTemplate('beta-downtraining')!;
const assigned = (customRewardEnabled: boolean): ClientProfile => ({
  id: 'patient-1', name: 'Patient', email: 'patient@example.com', status: 'active',
  assignedProtocol: 'beta-downtraining', allowedExperiences: [], brainMaps: [], badges: [],
  completedSessionsCount: 0, currentStreak: 0,
  customProtocolConfig: { ...template, alias: 'Test 123', customRewardEnabled },
});

async function details(client: ClientProfile) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ProtocolDetailsModal client={client} onClose={vi.fn()} />); });
  const text = JSON.stringify(renderer.toJSON());
  await act(async () => { renderer.unmount(); });
  return text;
}

afterEach(() => vi.unstubAllGlobals());

describe('patient protocol details training rule', () => {
  it('shows the 8–13 Hz alpha default for an older uncustomized assignment', async () => {
    const alpha = getClinicalProtocolTemplate('alpha-enhancement')!;
    const legacy = { ...assigned(false), assignedProtocol: 'alpha-enhancement' as const,
      customProtocolConfig: { ...alpha, rewardBand: { ...alpha.rewardBand, freqMax: 12 } } };
    const text = await details(legacy);
    expect(text).toContain('8 Hz');
    expect(text).toContain('13 Hz');
    expect(text).toContain('Above 11 µV');
  });
  it('shows both default ratio bands and a unitless reward threshold', async () => {
    const ratioTemplate = getClinicalProtocolTemplate('theta-beta-ratio')!;
    const client = { ...assigned(false), assignedProtocol: 'theta-beta-ratio' as const,
      customProtocolConfig: { ...ratioTemplate, customRewardEnabled: false } };
    const text = await details(client);
    expect(text).toContain('Theta Min Frequency');
    expect(text).toContain('Theta Max Frequency');
    expect(text).toContain('Beta Min Frequency');
    expect(text).toContain('Beta Max Frequency');
    expect(text).toContain('4 Hz');
    expect(text).toContain('8 Hz');
    expect(text).toContain('13 Hz');
    expect(text).toContain('30 Hz');
    expect(text).toContain('Reward condition');
    expect(text).toContain('Below');
    expect(text).toContain('Reward threshold');
    expect(text).toContain('1.85');
    expect(text.indexOf('Beta Max Frequency')).toBeLessThan(text.indexOf('Reward condition'));
    expect(text).not.toContain('1.85 µV');
  });
  it('shows the active default beta rule without inactive template values', async () => {
    const client = assigned(false);
    expect(resolveProtocolRuntime(client)).toMatchObject({
      ok: true, config: { protocol: 'beta-downtraining', initialThreshold: 14, rewardBand: undefined },
    });
    const text = await details(client);
    expect(text).toContain('Test 123');
    expect(text).toContain('Min Frequency');
    expect(text).toContain('Max Frequency');
    expect(text).toContain('13 Hz');
    expect(text).toContain('30 Hz');
    expect(text).toContain('Below 14 µV');
    expect(text).not.toContain('9–12 Hz');
    expect(text).not.toContain('10 µV');
    expect(text).not.toContain('Template reward');
  });

  it('shows the selected 9–12 Hz reward as active when the clinician enables it', async () => {
    const client = assigned(true);
    expect(resolveProtocolRuntime(client)).toMatchObject({
      ok: true,
      config: {
        rewardBand: { freqMin: 9, freqMax: 12, targetThreshold: 10 },
        initialThreshold: 10, lowerIsBetter: false,
      },
    });
    const text = await details(client);
    expect(text).toContain('Min Frequency');
    expect(text).toContain('Max Frequency');
    expect(text).toContain('9 Hz');
    expect(text).toContain('12 Hz');
    expect(text).toContain('Above 10 µV');
    expect(text).not.toContain('13 Hz');
    expect(text).not.toContain('at or below 14');
  });
});
