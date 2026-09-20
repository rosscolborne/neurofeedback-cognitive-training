import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';

vi.mock('../../../services/eegEngine', () => ({ eegEngine: { connectMuseBluetooth: vi.fn() } }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'fit-modal' }));

import { OnboardingFlow } from '../OnboardingFlow';

const client = {
  id: 'patient-1', name: 'Patient', email: 'patient@example.com', status: 'active',
  allowedExperiences: [], brainMaps: [], badges: [], completedSessionsCount: 0, currentStreak: 0,
} as ClientProfile;

const buttonWith = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((button) => button.children.some((child) => typeof child === 'string' && child.includes(text)))!;

describe('OnboardingFlow persistence', () => {
  it('stays open with a retryable error when the assessment write fails', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onFinish = vi.fn().mockRejectedValue(new Error('assessment save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OnboardingFlow client={client} onFinish={onFinish} />); });
    act(() => buttonWith(renderer, 'Get Started').props.onClick());
    act(() => buttonWith(renderer, 'Continue').props.onClick());
    await act(async () => { await buttonWith(renderer, 'Continue without Headband').props.onClick(); });

    expect(onFinish).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('assessment save offline');
    expect(buttonWith(renderer, 'Continue without Headband')).toBeDefined();
    renderer.unmount();
  });
});
