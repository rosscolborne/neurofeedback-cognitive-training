import { describe, it, expect } from 'vitest';
import { EEGEngine } from '../eegEngine';

describe('EEGEngine Muse Packet Bit-Unpacker (decodeChannelPacket)', () => {
  it('returns empty array when byteLength < 2', () => {
    const buffer = new ArrayBuffer(1);
    const view = new DataView(buffer);
    expect(EEGEngine.decodeChannelPacket(view)).toEqual([]);
  });

  it('correctly unpacks centered ADC counts (2048) as 0.0 uV across 12 samples', () => {
    // 20-byte standard Muse packet:
    // Bytes 0..1: Packet sequence index
    // Bytes 2..19: 6 triplets of bytes (b0, b1, b2)
    // For 2048 (0x800):
    // b0 = 0x80, b1 = 0x08, b2 = 0x00
    // val1 = (0x80 << 4) | (0x08 >> 4) = 0x800 = 2048
    // val2 = ((0x08 & 0x0F) << 8) | 0x00 = 0x800 = 2048
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint16(0, 100, false); // Sequence #100

    for (let i = 2; i < 20; i += 3) {
      view.setUint8(i, 0x80);
      view.setUint8(i + 1, 0x08);
      view.setUint8(i + 2, 0x00);
    }

    const decoded = EEGEngine.decodeChannelPacket(view);
    expect(decoded.length).toBe(12);
    for (const uv of decoded) {
      expect(uv).toBeCloseTo(0.0, 4);
    }
  });

  it('correctly unpacks positive and negative full-scale ADC counts', () => {
    // val1 = 4095 (0xFFF) -> (4095 - 2048) * 0.48828 = 2047 * 0.48828 ≈ 999.50916 uV
    // val2 = 0 (0x000) -> (0 - 2048) * 0.48828 = -2048 * 0.48828 = -999.99744 uV
    // b0 = 0xFF, b1 = 0xF0, b2 = 0x00
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint16(0, 1, false);

    for (let i = 2; i < 20; i += 3) {
      view.setUint8(i, 0xff);
      view.setUint8(i + 1, 0xf0);
      view.setUint8(i + 2, 0x00);
    }

    const decoded = EEGEngine.decodeChannelPacket(view);
    expect(decoded.length).toBe(12);

    for (let i = 0; i < 12; i += 2) {
      expect(decoded[i]).toBeCloseTo(999.509, 2);
      expect(decoded[i + 1]).toBeCloseTo(-999.997, 2);
    }
  });

  it('correctly decodes realistic EEG signal counts (~48.8 uV)', () => {
    // val1 = 2148 (0x864) -> (2148 - 2048) * 0.48828 = 100 * 0.48828 = 48.828 uV
    // val2 = 1948 (0x79C) -> (1948 - 2048) * 0.48828 = -100 * 0.48828 = -48.828 uV
    // b0 = 0x86, b1 = (4 << 4) | 7 = 0x47, b2 = 0x9C
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint16(0, 42, false);

    view.setUint8(2, 0x86);
    view.setUint8(3, 0x47);
    view.setUint8(4, 0x9c);

    // Fill remaining bytes with center counts
    for (let i = 5; i < 20; i += 3) {
      view.setUint8(i, 0x80);
      view.setUint8(i + 1, 0x08);
      view.setUint8(i + 2, 0x00);
    }

    const decoded = EEGEngine.decodeChannelPacket(view);
    expect(decoded[0]).toBeCloseTo(48.828, 3);
    expect(decoded[1]).toBeCloseTo(-48.828, 3);
    expect(decoded[2]).toBeCloseTo(0.0, 3);
  });

  it('maps the backend nested channel identity to the fit-check indicators', () => {
    const engine = new EEGEngine();

    (engine as any).updateChannelQualityFromServer({
      state: 'good',
      ready: false,
      worn: true,
      blockers: [],
      channels: [
        { channel: { id: 'tp9', label: 'TP9' }, state: 'good' },
        { channel: { id: 'af7', label: 'AF7' }, state: 'adjusting' },
        { channel: { id: 'af8', label: 'AF8' }, state: 'good' },
        { channel: { id: 'tp10', label: 'TP10' }, state: 'good' },
      ],
    });

    expect(engine.channelQuality).toEqual({
      tp9: 'good',
      af7: 'fair',
      af8: 'good',
      tp10: 'good',
    });
  });

  it('computes theta/beta feedback in demo mode without leaking mock metrics into headset mode', () => {
    const engine = new EEGEngine();
    engine.isDemoMode = true;

    const demoSample = (engine as any).generateSample(0.1);
    expect(demoSample.thetaBetaRatioAvailable).toBe(true);
    expect(demoSample.thetaBetaRatio).toBeCloseTo(
      demoSample.bands.theta / demoSample.bands.beta,
      10,
    );
    expect(demoSample.brainflowScores).toBeDefined();
    expect(demoSample.trainingMetric).toBeDefined();
    expect(demoSample.batteryLevel).toBe(92);

    engine.jawClenched = true;
    engine.isHardwareConnected = true;
    const headsetSample = (engine as any).generateSample(0.1);
    expect(headsetSample.thetaBetaRatioAvailable).toBe(false);
    expect(headsetSample.brainflowScores).toBeUndefined();
    expect(headsetSample.trainingMetric).toBeUndefined();
    expect(headsetSample.batteryLevel).toBeUndefined();
    expect(headsetSample.artifacts.clench).toBe(false);
  });
});
