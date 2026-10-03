import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/eegEngine', () => ({ eegEngine: { connectMuseBluetooth: vi.fn() } }));
vi.mock('../../brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));
vi.mock('../HeadsetFitModal', () => ({ HeadsetFitModal: 'fit-modal' }));

import { OnboardingFlow } from '../OnboardingFlow';

const buttonWith = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((button) => button.children.some((child) => typeof child === 'string' && child.includes(text)))!;

describe('OnboardingFlow persistence', () => {
  it('returns the protocol for the chosen intention when setup is repeated', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onFinish = vi.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<OnboardingFlow onFinish={onFinish} />);
    });
    act(() => buttonWith(renderer, 'Get Started').props.onClick());
    expect(JSON.stringify(renderer.toJSON())).not.toContain('clinician');
    const calm = renderer.root.findAllByProps({ className: 'card-patient' }).find(node =>
      node.findAll(child => child.children.some(value => typeof value === 'string' && value.includes('Anxiety Relief'))).length > 0)!;
    act(() => calm.props.onClick());
    act(() => buttonWith(renderer, 'Continue').props.onClick());
    await act(async () => { await buttonWith(renderer, 'Continue without Headband').props.onClick(); });
    expect(onFinish).toHaveBeenCalledWith({ assignedProtocol: 'alpha-enhancement' });
    renderer.unmount();
  });

  it('stays open with a retryable error when the assessment write fails', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onFinish = vi.fn().mockRejectedValue(new Error('assessment save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<OnboardingFlow onFinish={onFinish} />); });
    act(() => buttonWith(renderer, 'Get Started').props.onClick());
    act(() => buttonWith(renderer, 'Continue').props.onClick());
    await act(async () => { await buttonWith(renderer, 'Continue without Headband').props.onClick(); });

    expect(onFinish).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('assessment save offline');
    expect(buttonWith(renderer, 'Continue without Headband')).toBeDefined();
    renderer.unmount();
  });
});
