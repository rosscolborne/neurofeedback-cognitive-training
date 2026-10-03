import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { eegRecordingWriteSchema } from '@nfct/shared';
import type { EEGDataPoint } from '../../types';
import { createDemoModeEegProvider } from '../demoModeEegCapture';

vi.mock('../eegEngine', () => ({ eegEngine: {} }));

function fakeEngine() {
  const listeners = new Set<(point: EEGDataPoint) => void>();
  return {
    isDemoMode: false,
    isHardwareConnected: false,
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn((listener: (point: EEGDataPoint) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
    emit(point: Partial<EEGDataPoint>) { listeners.forEach((listener) => listener(point as EEGDataPoint)); },
    get listeners() { return listeners.size; },
  };
}

describe('Demo Mode EEG provider', () => {
  it('stamps every recording simulated and never models the simulator as a headset', () => {
    const engine = fakeEngine();
    let now = 1_790_000_000_000;
    const provider = createDemoModeEegProvider(engine, () => now);
    expect(provider.source).toBe('simulated');
    const capture = provider.start();
    expect(engine.isDemoMode).toBe(true);
    expect(engine.start).toHaveBeenCalledWith(100);
    for (let i = 0; i < 25; i += 1) {
      engine.emit({ signalQuality: 'excellent', brainflowScores: { mindfulnessScore: 70, restfulnessScore: 40, method: 'demo' } });
    }
    now += 90_000;
    const draft = capture.finish();
    expect(draft).toMatchObject({ source: 'simulated', device: { model: 'unknown' }, processing: { serviceVersion: 'demo-mode' } });
    expect(draft!.quality.windowsTotal).toBe(2);
    expect(draft!.summary.mindfulness?.n).toBe(2);
    expect(draft!.summary.mindfulness?.mean).toBeCloseTo(0.7, 10);
    expect(eegRecordingWriteSchema.safeParse({ ...draft!, schemaVersion: 1, userId: 'player-1', gameSessionId: 'sessionAAAAAAAAAAAA1', createdAt: Timestamp.now() }).success).toBe(true);
    // Demo Mode was this capture's only: it is switched off and the listener removed.
    expect(engine.isDemoMode).toBe(false);
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.listeners).toBe(0);
    expect(capture.finish()).toBeNull();
  });

  it('refuses to start while a headset is connected, so measured data is never labelled simulated', () => {
    const engine = fakeEngine();
    engine.isHardwareConnected = true;
    expect(() => createDemoModeEegProvider(engine).start()).toThrow(/headset is connected/);
    expect(engine.isDemoMode).toBe(false);
  });

  it('drops the whole recording if a headset connects during the capture, so measured data is never labelled simulated', () => {
    const engine = fakeEngine();
    const capture = createDemoModeEegProvider(engine).start();
    for (let i = 0; i < 10; i += 1) engine.emit({ signalQuality: 'good', brainflowScores: { mindfulnessScore: 50, restfulnessScore: 50, method: 'demo' } });
    engine.isHardwareConnected = true;
    for (let i = 0; i < 10; i += 1) engine.emit({ signalQuality: 'good', brainflowScores: { mindfulnessScore: 90, restfulnessScore: 90, method: 'demo' } });
    engine.isHardwareConnected = false;
    expect(capture.finish()).toBeNull();
    expect(engine.isDemoMode).toBe(false);

    // A headset still connected at the end voids it too, even with no sample in between.
    const second = createDemoModeEegProvider(engine).start();
    for (let i = 0; i < 10; i += 1) engine.emit({ signalQuality: 'good', brainflowScores: { mindfulnessScore: 50, restfulnessScore: 50, method: 'demo' } });
    engine.isHardwareConnected = true;
    expect(second.finish()).toBeNull();
  });

  it('cancel discards everything', () => {
    const engine = fakeEngine();
    const capture = createDemoModeEegProvider(engine).start();
    engine.emit({ signalQuality: 'good', brainflowScores: { mindfulnessScore: 50, restfulnessScore: 50, method: 'demo' } });
    capture.cancel();
    expect(engine.isDemoMode).toBe(false);
    expect(capture.finish()).toBeNull();
  });
});
