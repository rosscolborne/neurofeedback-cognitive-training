import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EEGDataPoint, IndividualBaselineModel } from '../../../../types';
import type { NeuroGambitBaseline } from '../../types';

const engine = vi.hoisted(() => ({ individualBaselineModel: null as unknown, getLatestPeakAlphaHz: vi.fn(() => 0) }));
vi.mock('../../../../services/eegEngine', () => ({ eegEngine: engine }));

import { BaselineCalibrationModal } from '../BaselineCalibrationModal';

const sample = { bands: { theta: 2, beta: 4, alpha: 6 }, bandAvailability: { theta: true, beta: true, alpha: true }, artifacts: { clench: false } } as EEGDataPoint;

describe('NeuroGambit calibration save lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    engine.individualBaselineModel = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => vi.useRealTimers());

  it('waits for persistence before completing and keeps fallback metadata out of success copy', async () => {
    let resolveSave!: () => void;
    const onBaselineReady = vi.fn((_baseline: NeuroGambitBaseline, _model: IndividualBaselineModel) => new Promise<void>((resolve) => { resolveSave = resolve; }));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<BaselineCalibrationModal eegData={sample} onBaselineReady={onBaselineReady} onSkip={vi.fn()} />); });
    await act(async () => { vi.advanceTimersByTime(15_100); await Promise.resolve(); });
    expect(onBaselineReady).toHaveBeenCalledTimes(1);
    expect(onBaselineReady.mock.calls[0][1]).toMatchObject({ thetaMean: 2, betaMean: 4, alphaMean: 6, algorithmVersion: 'neurogambit-15s-v1' });
    expect(onBaselineReady.mock.calls[0][1]).not.toHaveProperty('alphaPeakHz');
    expect(onBaselineReady.mock.calls[0][1]).not.toHaveProperty('oneOverFSlope');
    expect(JSON.stringify(renderer.toJSON())).toContain('Saving');
    expect(engine.individualBaselineModel).toBeNull();
    await act(async () => { resolveSave(); await Promise.resolve(); });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Saving');
    renderer.unmount();
  });

  it('keeps a failed calibration retryable and never persists a skipped default', async () => {
    const onBaselineReady = vi.fn().mockRejectedValueOnce(new Error('save offline')).mockResolvedValueOnce(undefined);
    const onSkip = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<BaselineCalibrationModal eegData={sample} onBaselineReady={onBaselineReady} onSkip={onSkip} />); });
    await act(async () => { vi.advanceTimersByTime(15_100); await Promise.resolve(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('save offline');
    const retry = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry save');
    expect(retry).toBeDefined();
    await act(async () => { await retry!.props.onClick(); });
    expect(onBaselineReady).toHaveBeenCalledTimes(2);
    expect(engine.individualBaselineModel).toBeNull();
    act(() => renderer.root.findAllByType('button').find((button) => button.children.join('').includes('Skip'))!.props.onClick());
    expect(onSkip).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('does not save an empty recording and offers another calibration attempt', async () => {
    const onBaselineReady = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<BaselineCalibrationModal eegData={null} onBaselineReady={onBaselineReady} onSkip={vi.fn()} />); });
    await act(async () => { vi.advanceTimersByTime(15_100); await Promise.resolve(); });
    expect(onBaselineReady).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('No clean EEG samples');
    act(() => renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Retry calibration')!.props.onClick());
    expect(JSON.stringify(renderer.toJSON())).not.toContain('No clean EEG samples');
    renderer.unmount();
  });

  it('rejects unavailable or nonfinite band frames before persistence', async () => {
    const onBaselineReady = vi.fn().mockResolvedValue(undefined);
    for (const eegData of [
      { ...sample, bands: { theta: 0, beta: 0, alpha: 0 }, bandAvailability: {} },
      { ...sample, bands: { theta: NaN, beta: 4, alpha: 6 } },
    ] as EEGDataPoint[]) {
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<BaselineCalibrationModal eegData={eegData} onBaselineReady={onBaselineReady} onSkip={vi.fn()} />); });
      await act(async () => { vi.advanceTimersByTime(15_100); await Promise.resolve(); });
      expect(onBaselineReady).not.toHaveBeenCalled();
      expect(JSON.stringify(renderer.toJSON())).toContain('No clean EEG samples');
      renderer.unmount();
    }
  });
});
