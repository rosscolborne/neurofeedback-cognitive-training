import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ProtocolTemplate } from '../../../types';
import { resolveProtocolRuntime } from '../../../services/adaptiveEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { EEGEngine } from '../../../services/eegEngine';
import { calculateRewardAmplitudeUv, calculateRewardPowerRatio } from '../../../services/rewardSpectrum';
import { DEFAULT_RATIO_REWARDS, DEFAULT_SINGLE_BAND_REWARDS } from '../../../services/protocols';
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
    renderer = create(<ProtocolBuilderModal assignedProtocol={initialProtocol.protocolType ?? 'alpha-enhancement'} initialProtocol={initialProtocol} onSave={onSave} onClose={onClose} />);
  });
  return { renderer, onSave, onClose };
}

async function submit(renderer: ReactTestRenderer) {
  await act(async () => {
    await renderer.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
  });
}

describe('ProtocolBuilderModal persistence state', () => {
  it('prefills every editable reward from the active runtime rule with the right unit', async () => {
    for (const protocol of ['theta-beta-ratio', 'alpha-theta-crossover', 'smr-enhancement', 'alpha-enhancement', 'beta-downtraining'] as const) {
      const { renderer } = await renderModal(getClinicalProtocolTemplate(protocol)!);
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
      });
      const ratio = DEFAULT_RATIO_REWARDS[protocol];
      const single = DEFAULT_SINGLE_BAND_REWARDS[protocol];
      if (ratio) {
        const denominator = protocol === 'theta-beta-ratio' ? 'Beta' : 'Alpha';
        expect(renderer.root.findByProps({ 'aria-label': 'Theta Min Frequency' }).props.value).toBe(ratio.numerator.freqMin);
        expect(renderer.root.findByProps({ 'aria-label': 'Theta Max Frequency' }).props.value).toBe(ratio.numerator.freqMax);
        expect(renderer.root.findByProps({ 'aria-label': `${denominator} Min Frequency` }).props.value).toBe(ratio.denominator.freqMin);
        expect(renderer.root.findByProps({ 'aria-label': `${denominator} Max Frequency` }).props.value).toBe(ratio.denominator.freqMax);
        expect(JSON.stringify(renderer.toJSON())).toContain('Reward threshold (ratio)');
        const frequencyRow = renderer.root.findByProps({ 'aria-label': 'Theta Min Frequency' }).parent!.parent!;
        const ruleRow = renderer.root.findByProps({ 'aria-label': 'Reward condition' }).parent!.parent!;
        expect(frequencyRow.findAllByType('input')).toHaveLength(4);
        expect(ruleRow.findAllByType('input')).toHaveLength(2);
        expect(ruleRow.findAllByType('select')).toHaveLength(1);
        expect(ruleRow.findByProps({ 'aria-label': 'Duration' }).props.value).toBe(getClinicalProtocolTemplate(protocol)!.sessionDurationMinutes);
      } else if (single) {
        expect(renderer.root.findByProps({ 'aria-label': 'Min Frequency' }).props.value).toBe(single.freqMin);
        expect(renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.value).toBe(single.freqMax);
        if (protocol === 'alpha-enhancement') expect(single.freqMax).toBe(13);
        expect(JSON.stringify(renderer.toJSON())).toContain('Reward threshold (µV)');
      }
      expect(renderer.root.findByProps({ 'aria-label': 'Reward condition' }).props.value)
        .toBe((ratio ?? single)!.targetCondition);
      expect(renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.value)
        .toBe((ratio ?? single)!.targetThreshold);
      expect(renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.step).toBe('0.01');
      renderer.unmount();
    }
  });

  it('prefills a legacy uncustomized alpha assignment with the current 8–13 Hz default', async () => {
    const legacy = { ...canonical, rewardBand: { ...canonical.rewardBand, freqMax: 12 } };
    const { renderer, onSave } = await renderModal(legacy);
    expect(renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.checked).toBe(false);
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
    });
    expect(renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.value).toBe(13);
    await submit(renderer);
    expect(onSave.mock.calls[0][0].rewardBand).toMatchObject({ freqMin: 8, freqMax: 13 });
    renderer.unmount();
  });

  it('reopens merged default assignments unchecked with the real runtime defaults', async () => {
    for (const protocol of ['smr-enhancement', 'beta-downtraining'] as const) {
      const template = getClinicalProtocolTemplate(protocol)!;
      const persisted = { ...template, customRewardEnabled: false,
        ratioReward: { ...DEFAULT_RATIO_REWARDS['theta-beta-ratio']!, targetThreshold: 2, targetCondition: 'below' as const } };
      const { renderer, onSave } = await renderModal(persisted);
      expect(renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.checked).toBe(false);
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
      });
      const defaultRule = DEFAULT_SINGLE_BAND_REWARDS[protocol]!;
      expect(renderer.root.findByProps({ 'aria-label': 'Min Frequency' }).props.value).toBe(defaultRule.freqMin);
      expect(renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.value).toBe(defaultRule.freqMax);
      expect(renderer.root.findByProps({ 'aria-label': 'Reward condition' }).props.value).toBe(defaultRule.targetCondition);
      expect(renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.value).toBe(defaultRule.targetThreshold);
      await submit(renderer);
      expect(onSave.mock.calls[0][0]).not.toHaveProperty('ratioReward');
      renderer.unmount();
    }
  });

  it('uses a saved single-band rule rather than a stale ratio rule when reopened', async () => {
    const beta = getClinicalProtocolTemplate('beta-downtraining')!;
    const persisted = { ...beta, customRewardEnabled: true,
      ratioReward: { ...DEFAULT_RATIO_REWARDS['theta-beta-ratio']!, targetCondition: 'above' as const, targetThreshold: 9 },
      rewardBand: { ...beta.rewardBand, freqMin: 9, freqMax: 12, targetCondition: 'below' as const, targetThreshold: 2 } };
    const { renderer, onSave } = await renderModal(persisted);
    expect(renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.checked).toBe(true);
    expect(renderer.root.findByProps({ 'aria-label': 'Min Frequency' }).props.value).toBe(9);
    expect(renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.value).toBe(12);
    expect(renderer.root.findByProps({ 'aria-label': 'Reward condition' }).props.value).toBe('below');
    expect(renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.value).toBe(2);
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.onChange({ target: { value: '13' } });
    });
    await submit(renderer);
    const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
    expect(saved).not.toHaveProperty('ratioReward');
    expect(resolveProtocolRuntime({ assignedProtocol: 'beta-downtraining', customProtocolConfig: saved } as ClientProfile))
      .toMatchObject({ ok: true, config: { initialThreshold: 2, lowerIsBetter: true, rewardBand: { freqMin: 9, freqMax: 13 } } });
    renderer.unmount();
  });

  it('saves two ratio band choices that produce different feedback from the same EEG', async () => {
    const template = getClinicalProtocolTemplate('theta-beta-ratio')!;
    const save = async (numeratorMin: number, numeratorMax: number) => {
      const { renderer, onSave } = await renderModal(template);
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
      });
      await act(async () => {
        renderer.root.findByProps({ 'aria-label': 'Theta Min Frequency' }).props.onChange({ target: { value: String(numeratorMin) } });
        renderer.root.findByProps({ 'aria-label': 'Theta Max Frequency' }).props.onChange({ target: { value: String(numeratorMax) } });
      });
      await submit(renderer);
      const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
      expect(saved.ratioReward?.targetThreshold).toBe(1.85);
      renderer.unmount();
      return saved;
    };
    const a = await save(4, 8);
    const b = await save(9, 11);
    const raw = Array.from({ length: 512 }, (_, index) => (
      4 * Math.sin(2 * Math.PI * 6 * index / 256)
      + 12 * Math.sin(2 * Math.PI * 10 * index / 256)
      + 8 * Math.sin(2 * Math.PI * 17 * index / 256)
    ));
    const feedback = (saved: ProtocolTemplate) => {
      const resolution = resolveProtocolRuntime({ assignedProtocol: 'theta-beta-ratio', customProtocolConfig: saved } as ClientProfile);
      if (!resolution.ok) throw new Error(resolution.error);
      const engine = new EEGEngine();
      engine.configureProtocol(resolution.config);
      return engine.evaluateFeedbackForBands({ delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 }, {}, undefined,
        calculateRewardPowerRatio([raw], 256, saved.ratioReward!));
    };
    expect(feedback(a)).toMatchObject({ available: true, inZone: true });
    expect(feedback(b)).toMatchObject({ available: true, inZone: false });
  });
  it('prefills beta customization with the active 13–30 Hz, below 14 µV rule', async () => {
    const beta = getClinicalProtocolTemplate('beta-downtraining')!;
    const { renderer, onSave } = await renderModal(beta);
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Use clinician-defined reward criteria' }).props.onChange({ target: { checked: true } });
    });
    expect(renderer.root.findByProps({ 'aria-label': 'Min Frequency' }).props.value).toBe(13);
    expect(renderer.root.findByProps({ 'aria-label': 'Max Frequency' }).props.value).toBe(30);
    expect(renderer.root.findByProps({ 'aria-label': 'Reward condition' }).props.value).toBe('below');
    expect(renderer.root.findByProps({ 'aria-label': 'Reward threshold' }).props.value).toBe(14);
    await submit(renderer);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      customRewardEnabled: true,
      rewardBand: { freqMin: 13, freqMax: 30, targetCondition: 'below', targetThreshold: 14 },
    });
    const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
    const defaultRuntime = resolveProtocolRuntime({ assignedProtocol: 'beta-downtraining' } as ClientProfile);
    const customRuntime = resolveProtocolRuntime({ assignedProtocol: 'beta-downtraining', customProtocolConfig: saved } as ClientProfile);
    if (!defaultRuntime.ok || !customRuntime.ok) throw new Error('The beta assignment did not resolve.');
    const defaultEngine = new EEGEngine();
    defaultEngine.configureProtocol(defaultRuntime.config);
    const customEngine = new EEGEngine();
    customEngine.configureProtocol(customRuntime.config);
    const betaBands = { delta: 0, theta: 4, alpha: 8, smr: 6, beta: 100, gamma: 3 };
    const availability = { beta: true };
    expect(defaultEngine.evaluateFeedbackForBands(betaBands, availability, 12).inZone)
      .toBe(customEngine.evaluateFeedbackForBands(betaBands, availability, 12).inZone);
    expect(defaultEngine.evaluateFeedbackForBands(betaBands, availability, 16).inZone)
      .toBe(customEngine.evaluateFeedbackForBands(betaBands, availability, 16).inZone);
    renderer.unmount();
  });

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
      12,
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
