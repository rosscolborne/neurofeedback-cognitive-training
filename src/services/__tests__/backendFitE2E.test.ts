import { describe, it, expect } from 'vitest';

const BACKEND_URL = import.meta.env.VITE_BRAINFLOW_SERVICE_URL || 'http://127.0.0.1:8000';

describe('Local BrainFlow Backend Headset Fit API E2E', () => {
  it('checks backend health', async () => {
    const res = await fetch(`${BACKEND_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('starts a fit session, analyzes zero/flatline, sine wave, and noise samples, and closes the session', async () => {
    // 1. Start session
    const startRes = await fetch(`${BACKEND_URL}/headset-fit/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(startRes.ok).toBe(true);
    const startData = await startRes.json();
    expect(startData.fitSessionId).toBeDefined();
    const fitSessionId = startData.fitSessionId;

    // 2a. Analyze all-zero flatline (simulating no contact / off head)
    const zeroSamples = Array.from({ length: 256 }, () => [0, 0, 0, 0]);
    const zeroRes = await fetch(`${BACKEND_URL}/headset-fit/sessions/${fitSessionId}/analyze-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleRateHz: 256,
        channelIds: ['TP9', 'AF7', 'AF8', 'TP10'],
        samples: zeroSamples,
      }),
    });
    expect(zeroRes.ok).toBe(true);
    const zeroData = await zeroRes.json();
    expect(zeroData.quality).toBeDefined();
    // Flatline is not considered ready
    expect(zeroData.quality.ready).toBe(false);
    expect(zeroData.quality.worn).toBe(false);

    // 2b. Analyze clean realistic EEG sine wave (10 Hz alpha wave @ 30 uV, simulating good contact)
    // Repeat for multiple windows so the server-side rolling fit window stabilizes
    let goodData: any = null;
    for (let w = 0; w < 4; w++) {
      const sineSamples = Array.from({ length: 256 }, (_, i) => {
        const t = (w * 256 + i) / 256;
        const v = 25 * Math.sin(2 * Math.PI * 10 * t) + (Math.random() - 0.5) * 4;
        return [v, v, v, v];
      });

      const goodRes = await fetch(`${BACKEND_URL}/headset-fit/sessions/${fitSessionId}/analyze-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleRateHz: 256,
          channelIds: ['TP9', 'AF7', 'AF8', 'TP10'],
          samples: sineSamples,
        }),
      });
      expect(goodRes.ok).toBe(true);
      goodData = await goodRes.json();
    }

    expect(goodData.quality).toBeDefined();
    expect(goodData.features).toBeDefined();
    expect(goodData.features.bandPowers).toBeDefined();

    // 2c. Analyze extreme noise artifact (e.g. 500 uV railed noise)
    const noiseSamples = Array.from({ length: 256 }, () => [
      (Math.random() - 0.5) * 1000,
      (Math.random() - 0.5) * 1000,
      (Math.random() - 0.5) * 1000,
      (Math.random() - 0.5) * 1000,
    ]);
    const noiseRes = await fetch(`${BACKEND_URL}/headset-fit/sessions/${fitSessionId}/analyze-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleRateHz: 256,
        channelIds: ['TP9', 'AF7', 'AF8', 'TP10'],
        samples: noiseSamples,
      }),
    });
    expect(noiseRes.ok).toBe(true);
    const noiseData = await noiseRes.json();
    expect(noiseData.quality.ready).toBe(false);

    // 3. Delete session
    const delRes = await fetch(`${BACKEND_URL}/headset-fit/sessions/${fitSessionId}`, {
      method: 'DELETE',
    });
    expect(delRes.ok).toBe(true);
  }, 30000);
});
