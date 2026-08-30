import { describe, it, expect } from 'vitest';
import { eegEngine } from '../eegEngine';
import { brainflowService } from '../brainflowService';

describe('Muse BLE Pipeline End-to-End Simulation', () => {
  it('streams simulated 20-byte BLE packets through parseChannelPacket into local backend analysis', async () => {
    // 1. Point brainflowService to the locally bundled backend
    brainflowService.setBaseUrl(import.meta.env.VITE_BRAINFLOW_SERVICE_URL || 'http://127.0.0.1:8000');

    // 2. Start a fit session
    const fitSessionId = await brainflowService.startFitSession();
    expect(fitSessionId).toBeDefined();
    (eegEngine as any).fitSessionId = fitSessionId;

    // 3. Start simulated 20-byte Bluetooth packets (10 Hz alpha wave, 30 uV amplitude)
    const stopSim = eegEngine.simulateMuseBluetoothPackets(2500, 10, 30);

    // 4. Wait for packets to populate rawBuffers (need >= 64 samples)
    await new Promise((resolve) => setTimeout(resolve, 800));

    const buffers = (eegEngine as any).rawBuffers;
    expect(buffers.tp9.length).toBeGreaterThan(64);
    expect(buffers.af7.length).toBeGreaterThan(64);
    expect(buffers.af8.length).toBeGreaterThan(64);
    expect(buffers.tp10.length).toBeGreaterThan(64);

    // 5. Dispatch server analysis across multiple windows (simulating the real 100ms eegEngine tick loop)
    for (let i = 0; i < 3; i++) {
      await (eegEngine as any).dispatchServerAnalysis(Date.now());
      await new Promise((r) => setTimeout(r, 200));
    }

    // 6. Assert serverFitState and channelQuality updated from live backend
    expect(eegEngine.serverFitState).toBeDefined();
    expect(eegEngine.serverFitState?.worn).toBeDefined();
    expect(eegEngine.serverFitState?.ready).toBeDefined();
    expect(eegEngine.channelQuality.tp9).toBeDefined();
    expect(eegEngine.channelQuality.af7).toBeDefined();

    // Clean up
    stopSim();
    await brainflowService.stopFitSession(fitSessionId);
  }, 20000);
});
