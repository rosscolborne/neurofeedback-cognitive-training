import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ProtocolTemplate } from '../../../types';
import { resolveProtocolRuntime } from '../../../services/adaptiveEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { EEGEngine } from '../../../services/eegEngine';
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

  it.each([
    ['minimum', { freqMin: canonical.rewardBand.freqMin + 1 }],
    ['maximum', { freqMax: canonical.rewardBand.freqMax + 1 }],
    ['condition', { targetCondition: 'below' as const }],
    ['threshold', { targetThreshold: canonical.rewardBand.targetThreshold + 1 }],
  ])('blocks an unsupported saved reward %s before another save', async (_field, change) => {
    const legacy = { ...canonical, rewardBand: { ...canonical.rewardBand, ...change } };
    const { renderer, onSave } = await renderModal(legacy);
    for (const label of [
      'Canonical reward minimum', 'Canonical reward maximum',
      'Canonical reward condition', 'Canonical reward threshold reference',
    ]) {
      const field = renderer.root.findByProps({ 'aria-label': label });
      expect(field.props.readOnly).toBe(true);
      expect(field.props.onChange).toBeUndefined();
    }
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(true);
    await submit(renderer);
    expect(onSave).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('repairs a legacy noncanonical reward and then permits training', async () => {
    const legacy: ProtocolTemplate = {
      ...canonical,
      protocolType: undefined,
      name: 'Morning Alpha Plan',
      sessionDurationMinutes: 20,
      rewardBand: { ...canonical.rewardBand, freqMin: 9, targetCondition: 'below' },
    };
    const { renderer, onSave } = await renderModal(legacy);
    expect(trainingConfig(legacy)).toMatchObject({ ok: false, error: expect.stringContaining('canonical reward') });
    await act(async () => {
      renderer.root.findAllByType('button').find(button => button.children.includes('Restore canonical reward definition'))!.props.onClick();
    });
    expect(renderer.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    await submit(renderer);

    const saved = onSave.mock.calls[0][0] as ProtocolTemplate;
    expect(saved).toMatchObject({
      protocolType: 'alpha-enhancement',
      alias: 'Morning Alpha Plan',
      name: canonical.name,
      sessionDurationMinutes: 20,
      rewardBand: canonical.rewardBand,
    });
    expect(trainingConfig(saved)).toMatchObject({ ok: true, config: { durationSeconds: 1200, initialThreshold: 11 } });
    renderer.unmount();
  });
});
