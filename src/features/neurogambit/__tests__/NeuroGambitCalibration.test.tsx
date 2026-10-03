import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndividualBaselineModel } from '../../../types';
import type { NeuroGambitBaseline } from '../types';

const state = vi.hoisted(() => ({
  auth: { user: { uid: 'patient-a' }, role: 'patient' } as Record<string, unknown>,
  getExistingCurrentClient: vi.fn(), saveIndividualBaselineModel: vi.fn(),
  individualBaselineModel: null as unknown, toBrainStateEvent: vi.fn(), clockJumpTo: null as Date | null,
  engineReplacement: null as unknown,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../../../services/storageEngine', () => ({ storageEngine: state }));
vi.mock('../../../services/eegEngine', () => ({ eegEngine: state }));
vi.mock('../services/eegAdapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/eegAdapter')>(),
  toBrainStateEvent: state.toBrainStateEvent,
}));
vi.mock('../hooks/useNeuroGambitEngine', () => ({ useNeuroGambitEngine: () => ({
  activePuzzle: { title: 'Fixture', theme: 'fixture', playerColor: 'white' }, puzzleIndex: 0, totalPuzzles: 1,
  chess: {}, selectedSquare: null, legalMoves: [], chargeState: {}, isBoardLockedForBreaker: false,
  clockSecondsRemaining: 120, clockRate: 1, feedbackBanner: null, handleSquareClick: vi.fn(),
  cancelCharge: vi.fn(), handleCircuitBreakerUnlock: vi.fn(), finishSession: vi.fn(),
}) }));
vi.mock('../hooks/useVagalRecoveryGate', () => ({ useVagalRecoveryGate: () => ({
  elapsedSeconds: 0, pacerPhase: 'inhale', pacerProgress: 0, recoveryProgress: 0,
  startCircuitBreaker: vi.fn(), resetCircuitBreaker: vi.fn(),
}) }));
vi.mock('../components/BaselineCalibrationModal', () => ({ BaselineCalibrationModal: 'baseline-modal' }));
vi.mock('../components/SessionSummaryModal', () => ({ SessionSummaryModal: 'summary-modal' }));
vi.mock('../components/ChessboardView', () => ({ ChessboardView: () => {
  React.useLayoutEffect(() => {
    if (state.clockJumpTo) vi.setSystemTime(state.clockJumpTo);
    if (state.engineReplacement) state.individualBaselineModel = state.engineReplacement;
  }, []);
  return null;
} }));
vi.mock('../components/PeripheralAmbientGlow', () => ({ PeripheralAmbientGlow: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/TimeDilationClock', () => ({ TimeDilationClock: 'clock-view' }));
vi.mock('../components/VagalBreathingPacer', () => ({ VagalBreathingPacer: 'pacer-view' }));

import { NeuroGambitContainer } from '../NeuroGambitContainer';
import { getNeuroGambitBaseline } from '../services/eegAdapter';

const saved: IndividualBaselineModel = {
  alphaPeakHz: 10, oneOverFSlope: 1, lastCalibratedAt: '2026-09-27T08:00:00Z',
  thetaMean: 3, thetaStd: 0.4, betaMean: 5, betaStd: 0.6, alphaMean: 7, alphaStd: 0.8,
};
const calibrated: NeuroGambitBaseline = {
  thetaMean: 4, thetaStd: 0.5, highBetaMean: 6, highBetaStd: 0.7,
  alphaMean: 8, alphaStd: 0.9, calibratedAt: 1, isReady: true,
};
const modal = (renderer: ReactTestRenderer) => renderer.root.find((node) => (node.type as unknown) === 'baseline-modal');

describe('NeuroGambit persisted baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth = { user: { uid: 'patient-a' }, role: 'patient' };
    state.individualBaselineModel = null;
    state.clockJumpTo = null;
    state.engineReplacement = null;
    state.getExistingCurrentClient.mockResolvedValue({ id: 'patient-a', status: 'active', notes: 'retain' });
    state.saveIndividualBaselineModel.mockResolvedValue(undefined);
    state.toBrainStateEvent.mockReturnValue({ normalizedComposure: 1, isClenching: false });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('starts from the exact saved theta and beta values and prompts for expired or absent models', async () => {
    expect(getNeuroGambitBaseline(saved)).toMatchObject({ thetaMean: 3, thetaStd: 0.4, highBetaMean: 5, highBetaStd: 0.6 });
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" savedBaselineModel={saved} onBaselinePersisted={vi.fn()} />); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'baseline-modal')).toHaveLength(0);
    expect(state.toBrainStateEvent).toHaveBeenCalledWith(null, expect.objectContaining({ thetaMean: 3, highBetaMean: 5 }));
    await act(async () => { renderer.update(<NeuroGambitContainer eegData={null} patientId="patient-a" savedBaselineModel={{ ...saved, expiresAt: 0 }} onBaselinePersisted={vi.fn()} />); });
    expect(modal(renderer)).toBeDefined();
    renderer.unmount();
  });

  it('uses the read-only lookup and narrow save, then publishes to the current profile after success', async () => {
    let resolveSave!: () => void;
    state.saveIndividualBaselineModel.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    const onBaselinePersisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" onBaselinePersisted={onBaselinePersisted} />); });
    let pending!: Promise<void>;
    act(() => { pending = modal(renderer).props.onBaselineReady(calibrated, saved); });
    await act(async () => { await Promise.resolve(); });
    expect(state.getExistingCurrentClient).toHaveBeenCalledTimes(1);
    expect(state.saveIndividualBaselineModel).toHaveBeenCalledWith('patient-a', saved);
    expect(state.individualBaselineModel).toBeNull();
    expect(onBaselinePersisted).not.toHaveBeenCalled();
    await act(async () => { resolveSave(); await pending; });
    expect(state.individualBaselineModel).toBe(saved);
    expect(onBaselinePersisted).toHaveBeenCalledWith(saved);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'baseline-modal')).toHaveLength(0);
    renderer.unmount();
  });

  it('keeps failure and missing profiles unsaved and never writes a skipped default', async () => {
    state.saveIndividualBaselineModel.mockRejectedValueOnce(new Error('offline'));
    const onBaselinePersisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" onBaselinePersisted={onBaselinePersisted} />); });
    await expect(modal(renderer).props.onBaselineReady(calibrated, saved)).rejects.toThrow('offline');
    expect(state.individualBaselineModel).toBeNull();
    expect(onBaselinePersisted).not.toHaveBeenCalled();
    state.getExistingCurrentClient.mockResolvedValueOnce(null);
    await expect(modal(renderer).props.onBaselineReady(calibrated, saved)).rejects.toThrow('unavailable');
    expect(state.saveIndividualBaselineModel).toHaveBeenCalledTimes(1);
    act(() => modal(renderer).props.onSkip());
    expect(state.saveIndividualBaselineModel).toHaveBeenCalledTimes(1);
    expect(state.individualBaselineModel).toBeNull();
    renderer.unmount();
  });

  it('discards a late save completion after the account changes', async () => {
    let resolveSave!: () => void;
    state.saveIndividualBaselineModel.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
    const onBaselinePersisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" onBaselinePersisted={onBaselinePersisted} />); });
    let pending!: Promise<void>;
    act(() => { pending = modal(renderer).props.onBaselineReady(calibrated, saved); });
    await act(async () => { await Promise.resolve(); });
    state.auth = { user: { uid: 'patient-b' }, role: 'patient' };
    await act(async () => { renderer.update(<NeuroGambitContainer eegData={null} patientId="patient-b" onBaselinePersisted={onBaselinePersisted} />); });
    await act(async () => { resolveSave(); await expect(pending).rejects.toThrow('account changed'); });
    expect(state.individualBaselineModel).toBeNull();
    expect(onBaselinePersisted).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it.each([undefined, saved])('keeps a synthetic Demo calibration transient with and without an existing imprint', async (existing) => {
    state.individualBaselineModel = existing ?? null;
    const onBaselinePersisted = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" isDemoSession savedBaselineModel={existing} onBaselinePersisted={onBaselinePersisted} />); });
    expect(modal(renderer)).toBeDefined();
    await act(async () => { await modal(renderer).props.onBaselineReady(calibrated, saved); });
    expect(state.getExistingCurrentClient).not.toHaveBeenCalled();
    expect(state.saveIndividualBaselineModel).not.toHaveBeenCalled();
    expect(onBaselinePersisted).not.toHaveBeenCalled();
    expect(state.individualBaselineModel).toBe(existing ?? null);
    expect(renderer.root.findAll((node) => (node.type as unknown) === 'baseline-modal')).toHaveLength(0);
    renderer.unmount();
  });

  it('drops the same saved model when its explicit expiry crosses during a mounted session', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-27T08:00:00Z'));
      const nearExpiry = { ...saved, expiresAt: Date.parse('2026-09-27T08:00:01Z') };
      state.individualBaselineModel = nearExpiry;
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" savedBaselineModel={nearExpiry} onBaselinePersisted={vi.fn()} />); });
      expect(renderer.root.findAll((node) => (node.type as unknown) === 'baseline-modal')).toHaveLength(0);
      await act(async () => { vi.advanceTimersByTime(1_001); await Promise.resolve(); });
      expect(modal(renderer)).toBeDefined();
      expect(state.individualBaselineModel).toBeNull();
      expect(state.toBrainStateEvent).toHaveBeenLastCalledWith(null, null);
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechecks an unchanged saved model after a wall-clock jump and rerender', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-27T08:00:00Z'));
      const nearExpiry = { ...saved, expiresAt: Date.parse('2026-09-27T08:00:01Z') };
      state.individualBaselineModel = nearExpiry;
      let renderer!: ReactTestRenderer;
      const props = { eegData: null, patientId: 'patient-a', savedBaselineModel: nearExpiry, onBaselinePersisted: vi.fn() };
      await act(async () => { renderer = create(<NeuroGambitContainer {...props} />); });
      expect(renderer.root.findAll((node) => (node.type as unknown) === 'baseline-modal')).toHaveLength(0);
      vi.setSystemTime(new Date('2026-09-27T08:00:02Z'));
      await act(async () => { renderer.update(<NeuroGambitContainer {...props} />); });
      expect(modal(renderer)).toBeDefined();
      expect(state.individualBaselineModel).toBeNull();
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('invalidates expiry crossed between render and effect without clearing another model: replacement=%s', async (replaceEngine) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-27T08:00:00Z'));
      const model = { ...saved, expiresAt: Date.parse('2026-09-27T08:00:01Z') };
      const otherAccountModel = { ...saved, alphaPeakHz: 11 };
      state.individualBaselineModel = model;
      state.clockJumpTo = new Date('2026-09-27T08:00:02Z');
      state.engineReplacement = replaceEngine ? otherAccountModel : null;
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<NeuroGambitContainer eegData={null} patientId="patient-a" savedBaselineModel={model} onBaselinePersisted={vi.fn()} />); });
      expect(state.individualBaselineModel).toBe(replaceEngine ? otherAccountModel : null);
      expect(modal(renderer)).toBeDefined();
      expect(state.toBrainStateEvent).toHaveBeenLastCalledWith(null, null);
      renderer.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
