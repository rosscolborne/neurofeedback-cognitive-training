import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EEGDataPoint } from '../../types';
import { EEGEngine } from '../eegEngine';
import { brainflowService } from '../brainflowService';

// The consumer EEG pipeline publishes headset fit and BrainFlow mindfulness
// and restfulness, and nothing else.

type EngineInternals = {
  rawBuffers: Record<'tp9' | 'af7' | 'af8' | 'tp10', number[]>;
  sourceFrameSequence: number;
  lastSourceFrameAtMs: number;
  startHostedBluetoothAnalysis: () => Promise<void>;
  dispatchServerAnalysis: (now: number) => Promise<void>;
  runBrowserFitCheck: (now: number) => void;
  generateSample: (dt: number) => EEGDataPoint;
};

const internals = (engine: EEGEngine) => engine as unknown as EngineInternals;
const wave = Array.from({ length: 512 }, (_, index) => 12 * Math.sin(2 * Math.PI * 10 * index / 256));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('consumer EEG pipeline', () => {
  it('publishes only fit, channel quality, battery and the BrainFlow scores', () => {
    const engine = new EEGEngine();
    engine.isDemoMode = true;
    expect(Object.keys(internals(engine).generateSample(0.1)).sort())
      .toEqual(['batteryLevel', 'brainflowScores', 'channelQuality', 'signalQuality', 'timestamp']);
  });

  it('sends hosted analysis only the raw window, never a protocol, threshold or reward rule', async () => {
    vi.spyOn(brainflowService, 'hasConfiguredService').mockReturnValue(true);
    vi.spyOn(brainflowService, 'startFitSession').mockResolvedValue('fit-1');
    const analyze = vi.spyOn(brainflowService, 'analyzeFitWindow').mockResolvedValue({
      features: { mindfulnessScore: 64, restfulnessScore: 58 },
    });
    const engine = new EEGEngine();
    const engineInternals = internals(engine);
    engine.isHardwareConnected = true;
    await engineInternals.startHostedBluetoothAnalysis();
    engineInternals.rawBuffers = { tp9: [...wave], af7: [...wave], af8: [...wave], tp10: [...wave] };

    await engineInternals.dispatchServerAnalysis(Date.now());

    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]).toHaveLength(3);
    expect(analyze.mock.calls[0][0]).toBe('fit-1');
    expect(analyze.mock.calls[0][2]).toBe(256);
    expect(engineInternals.generateSample(0.1).brainflowScores)
      .toEqual({ mindfulnessScore: 64, restfulnessScore: 58, method: 'brainflow' });
  });

  it('resumes hosted scores after a disconnect and reconnect, and releases the old session', async () => {
    vi.spyOn(brainflowService, 'hasConfiguredService').mockReturnValue(true);
    const start = vi.spyOn(brainflowService, 'startFitSession')
      .mockResolvedValueOnce('fit-before-disconnect')
      .mockResolvedValueOnce('fit-after-reconnect');
    const stop = vi.spyOn(brainflowService, 'stopFitSession').mockResolvedValue();
    const analyze = vi.spyOn(brainflowService, 'analyzeFitWindow').mockResolvedValue({
      features: { mindfulnessScore: 70, restfulnessScore: 50 },
    });
    const engine = new EEGEngine();
    const engineInternals = internals(engine);
    const hostedTick = async () => {
      engineInternals.rawBuffers = { tp9: [...wave], af7: [...wave], af8: [...wave], tp10: [...wave] };
      engineInternals.sourceFrameSequence++;
      engineInternals.lastSourceFrameAtMs = Date.now();
      await engineInternals.dispatchServerAnalysis(Date.now());
      return engineInternals.generateSample(0.1);
    };

    engine.isHardwareConnected = true;
    await engineInternals.startHostedBluetoothAnalysis();
    expect((await hostedTick()).brainflowScores).toMatchObject({ mindfulnessScore: 70, method: 'brainflow' });

    engine.disconnectHardware();
    expect(stop).toHaveBeenCalledWith('fit-before-disconnect');
    expect(engineInternals.generateSample(0.1)).toMatchObject({ signalQuality: 'disconnected', brainflowScores: undefined });

    engine.isHardwareConnected = true;
    await engineInternals.startHostedBluetoothAnalysis();
    expect(start).toHaveBeenCalledTimes(2);
    expect((await hostedTick()).brainflowScores).toMatchObject({ mindfulnessScore: 70, method: 'brainflow' });
    expect(analyze).toHaveBeenLastCalledWith('fit-after-reconnect', expect.any(Array), 256);
  });

  it('stops presenting scores as soon as hosted analysis fails, and gives up the session after three failures', async () => {
    vi.spyOn(brainflowService, 'hasConfiguredService').mockReturnValue(true);
    vi.spyOn(brainflowService, 'startFitSession').mockResolvedValue('fit-1');
    const stop = vi.spyOn(brainflowService, 'stopFitSession').mockResolvedValue();
    const analyze = vi.spyOn(brainflowService, 'analyzeFitWindow')
      .mockResolvedValueOnce({ features: { mindfulnessScore: 80, restfulnessScore: 60 } })
      .mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new EEGEngine();
    const engineInternals = internals(engine);
    engine.isHardwareConnected = true;
    await engineInternals.startHostedBluetoothAnalysis();
    engineInternals.rawBuffers = { tp9: [...wave], af7: [...wave], af8: [...wave], tp10: [...wave] };

    await engineInternals.dispatchServerAnalysis(Date.now());
    expect(engineInternals.generateSample(0.1).brainflowScores?.mindfulnessScore).toBe(80);

    await engineInternals.dispatchServerAnalysis(Date.now());
    expect(engineInternals.generateSample(0.1).brainflowScores).toBeUndefined();
    await engineInternals.dispatchServerAnalysis(Date.now());
    await engineInternals.dispatchServerAnalysis(Date.now());
    expect(stop).toHaveBeenCalledWith('fit-1');
    expect(analyze).toHaveBeenCalledTimes(4);
  });

  it('checks fit in the browser without a hosted service, but never produces scores there', () => {
    const engine = new EEGEngine();
    const engineInternals = internals(engine);
    engine.isHardwareConnected = true;
    engine.isDemoMode = false;
    engineInternals.rawBuffers = { tp9: [...wave], af7: [...wave], af8: [...wave], tp10: [...wave] };

    engineInternals.runBrowserFitCheck(1_000);

    expect(engine.serverFitState).toMatchObject({ worn: true });
    expect(engine.channelQuality).toEqual({ tp9: 'good', af7: 'good', af8: 'good', tp10: 'good' });
    const sample = engineInternals.generateSample(0.1);
    expect(sample.brainflowScores).toBeUndefined();
    expect(sample.signalQuality).not.toBe('disconnected');
  });

  it('keeps a connected headset without scores visibly unavailable and never switches to simulated data', () => {
    const engine = new EEGEngine();
    engine.isHardwareConnected = true;
    engine.isDemoMode = true; // a stale Demo flag must not simulate over a real headset
    const sample = internals(engine).generateSample(0.1);
    expect(sample.brainflowScores).toBeUndefined();
  });

  it('moves the simulated scores through the Demo auto cycle', () => {
    const engine = new EEGEngine();
    engine.isDemoMode = true;
    const sampleFor = (seconds: number) => {
      let sample = internals(engine).generateSample(0.1);
      for (let step = 1; step < seconds * 10; step += 1) sample = internals(engine).generateSample(0.1);
      return sample.brainflowScores!;
    };
    const focus = sampleFor(2.9); // the end of the focus phase (0–3 s)
    sampleFor(3); // the calm phase
    const drift = sampleFor(3); // the end of the drift phase (6–9 s)
    expect(focus.method).toBe('demo');
    expect(focus.mindfulnessScore!).toBeGreaterThan(65);
    expect(drift.mindfulnessScore!).toBeLessThan(40);
    expect(drift.restfulnessScore!).toBeLessThan(focus.restfulnessScore!);
  });

  it('exposes monotonic source-frame evidence independently of the UI publish timer', () => {
    vi.useFakeTimers();
    const engine = new EEGEngine();
    expect(engine.getHardwareSourceState()).toEqual({ sequence: 0, lastFrameAtMs: 0 });
    const stop = engine.simulateMuseBluetoothPackets(0);
    vi.advanceTimersByTime(47);
    const first = engine.getHardwareSourceState();
    expect(first.sequence).toBeGreaterThan(0);
    expect(first.lastFrameAtMs).toBe(Date.now());
    vi.advanceTimersByTime(47);
    expect(engine.getHardwareSourceState().sequence).toBeGreaterThan(first.sequence);
    stop();
  });
});
