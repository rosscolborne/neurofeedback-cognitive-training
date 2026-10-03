import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EEGDataPoint, MuseChannelQuality } from '../../../types';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  listener: null as ((data: EEGDataPoint) => void) | null,
  connect: vi.fn(),
  start: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../../../services/eegEngine', () => ({
  eegEngine: {
    subscribe: vi.fn((listener: (data: EEGDataPoint) => void) => {
      state.listener = listener;
      return () => { state.listener = null; };
    }),
    connectMuseBluetooth: state.connect,
    start: state.start,
  },
}));
vi.mock('../../../components/brand/BrandLogo', () => ({ BrandLogo: 'brand-logo' }));

import { HardwareSetup } from '../HardwareSetup';

const text = (node: ReactTestInstance): string => node.children
  .map((child) => (typeof child === 'string' ? child : text(child)))
  .join('');
const button = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find((node) => node.type === 'button' && text(node).includes(label));
const frame = (channelQuality: MuseChannelQuality): EEGDataPoint => ({
  timestamp: 1, signalQuality: 'fair', channelQuality,
});

describe('HardwareSetup (optional headset pairing and fit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.listener = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('pairs the headset, then shows the fit check', async () => {
    state.connect.mockResolvedValueOnce({ success: true, deviceName: 'Muse S Athena' });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup />); });

    await act(async () => { button(renderer, 'Pair Muse Headband').props.onClick(); });

    expect(state.connect).toHaveBeenCalledOnce();
    expect(state.start).toHaveBeenCalled();
    expect(text(renderer.root.findByType('h2'))).toBe('Check Electrode Contact');
    expect(text(renderer.root.findByType('header'))).toContain('Muse S Athena connected');
    await act(async () => { renderer.unmount(); });
  });

  it('keeps pairing on screen with the error when the connection fails', async () => {
    state.connect.mockResolvedValueOnce({ success: false, error: 'Bluetooth is off.' });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup />); });

    await act(async () => { button(renderer, 'Pair Muse Headband').props.onClick(); });

    expect(text(renderer.root)).toContain('Bluetooth is off.');
    expect(renderer.root.findAllByType('h2')).toHaveLength(0);
    await act(async () => { renderer.unmount(); });
  });

  it('enables Continue once two sensors fit well, and Continue goes home', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="fit" />); });
    expect(button(renderer, 'Continue').props.disabled).toBe(true);

    await act(async () => { state.listener?.(frame({ tp9: 'good', af7: 'fair', af8: 'poor', tp10: 'poor' })); });
    expect(button(renderer, 'Continue').props.disabled).toBe(true);

    await act(async () => { state.listener?.(frame({ tp9: 'good', af7: 'good', af8: 'poor', tp10: 'poor' })); });
    expect(button(renderer, 'Continue').props.disabled).toBe(false);

    act(() => { button(renderer, 'Continue').props.onClick(); });
    expect(state.navigate).toHaveBeenCalledWith('/');
    await act(async () => { renderer.unmount(); });
  });

  it.each(['pair', 'fit'] as const)('can be skipped from the %s step', async (step) => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep={step} />); });

    act(() => { button(renderer, 'Skip to Dashboard').props.onClick(); });

    expect(state.navigate).toHaveBeenCalledWith('/');
    await act(async () => { renderer.unmount(); });
  });

  it('offers no calibration or brainwave playground', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<HardwareSetup initialStep="fit" />); });
    expect(text(renderer.root)).not.toMatch(/calibrat|imprint|alpha|beta|wave visualizer/i);
    await act(async () => { renderer.unmount(); });
  });
});
