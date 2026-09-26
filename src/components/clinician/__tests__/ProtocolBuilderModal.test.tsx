import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ProtocolTemplate } from '../../../types';
import { resolveProtocolRuntime } from '../../../services/adaptiveEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { EEGEngine } from '../../../services/eegEngine';
import { calculateRewardAmplitudeUv } from '../../../services/rewardSpectrum';
import { ProtocolBuilderModal } from '../ProtocolBuilderModal';

const canonical = getClinicalProtocolTemplate('alpha-enhancement')!;

const trainingConfig = (template: ProtocolTemplate) => resolveProtocolRuntime({
  assignedProtocol: 'alpha-enhancement',
  customProtocolConfig: template,
} as ClientProfile);

async function renderModal(initialProtocol: ProtocolTemplate, onSave = vi.fn().mockResolvedValue(undefined)) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onClose = vi.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ProtocolBuilderModal assignedProtocol="alpha-enhancement" initialProtocol={initialProtocol} onSave={onSave} onClose={onClose} />);
  });
  return { renderer, onSave, onClose };
}

async function submit(renderer: ReactTestRenderer) {
  await act(async () => {
    await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
}

describe('ProtocolBuilderModal persistence state', () => {
  it('stays open and reports a failed protocol assignment', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('protocol save offline'));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ProtocolBuilderModal onSave={onSave} onClose={onClose} />);
    });

    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('protocol save offline');
    renderer.unmount();
  });

  it('saves a canonical assignment that resolves and starts training', async () => {
    const { renderer, onSave, onClose } = await renderModal(canonical);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Min Frequency' })).toHaveLength(0);
    await submit(renderer);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
    expect(saved.rewardBand).toEqual(canonical.rewardBand);
    expect(saved.rewardBand.targetThreshold).toBe(11.5);
    const resolution = trainingConfig(saved);
    expect(resolution).toMatchObject({ ok: true, config: { initialThreshold: 11, source: 'patient-override' } });
    if (!resolution.ok) throw new Error(resolution.error);
    const engine = new EEGEngine();
    engine.configureProtocol(resolution.config);
    expect(engine.evaluateFeedbackForBands(
      { delta: 0, theta: 4, alpha: 12, smr: 8, beta: 6, gamma: 3 },
      { alpha: true },
    )).toMatchObject({ available: true, inZone: true });
    renderer.unmount();
  });

  it('saves two clinician-selected rewards that produce different training feedback', async () => {
    const saveSelected = async (min: number, max: number) => {
      const { renderer, onSave } = await renderModal(canonical);
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
      });
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Min Frequency' }).props.onChange({ target: { value: String(min) } });
        renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.onChange({ target: { value: String(max) } });
        renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.onChange({ target: { value: '6' } });
      });
      await submit(renderer);
      expect(onSave).toHaveBeenCalledOnce();
      const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
      renderer.unmount();
      return saved;
    };
    const raw = Array.from({ length: 512 }, (_, index) => 12 * Math.sin(2 * Math.PI * 10 * index / 256));
    const feedbackFor = (template: ProtocolTemplate) => {
      const resolution = trainingConfig(template);
      if (!resolution.ok) throw new Error(resolution.error);
      const engine = new EEGEngine();
      engine.configureProtocol(resolution.config);
      return engine.evaluateFeedbackForBands(
        { delta: 0, theta: 4, alpha: 12, smr: 8, beta: 6, gamma: 3 },
        { alpha: true },
        calculateRewardAmplitudeUv([raw, raw, raw, raw], 256, template.rewardBand),
      );
    };
    const a = await saveSelected(9, 11);
    const b = await saveSelected(16, 18);
    expect(a.customRewardEnabled).toBe(true);
    expect(b.customRewardEnabled).toBe(true);
    expect(feedbackFor(a)).toMatchObject({ available: true, inZone: true });
    expect(feedbackFor(b)).toMatchObject({ available: true, inZone: false });
  });

  it('blocks malformed reward input before save and repairs a legacy assignment by editing it', async () => {
    const legacy: ProtocolTemplate = {
      ...canonical,
      protocolType: undefined,
      name: 'Morning Alpha Plan',
      sessionDurationMinutes: 20,
      rewardBand: { ...canonical.rewardBand, freqMin: 9, freqMax: 50, targetCondition: 'below' },
    };
    const { renderer, onSave } = await renderModal(legacy);
    expect(trainingConfig(legacy)).toMatchObject({ ok: false });
    await submit(renderer);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.onChange({ target: { value: '11' } });
    });
    await submit(renderer);

    const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
    expect(saved).toMatchObject({
      protocolType: 'alpha-enhancement',
      alias: 'Morning Alpha Plan',
      name: canonical.name,
      sessionDurationMinutes: 20,
      customRewardEnabled: true,
      rewardBand: { ...canonical.rewardBand, freqMin: 9, freqMax: 11, targetCondition: 'below' },
    });
    expect(trainingConfig(saved)).toMatchObject({ ok: true, config: { durationSeconds: 1200, initialThreshold: 11.5, lowerIsBetter: true } });
    renderer.unmount();
  });
});
