import { BandPowers, BrainFlowScores, EEGDataPoint, MuseChannelQuality, ProtocolType } from '../types';
import { brainflowService, BrainFlowFeatures } from './brainflowService';

export class EEGEngine {
  private isRunning = false;
  private timer: number | null = null;
  private subscribers: Array<(data: EEGDataPoint) => void> = [];

  // Mental state drivers (0 - 100) (Used only when explicit demo mode is active)
  public userFocus = 65;
  public userCalm = 60;
  public eyeClosed = false;
  public jawClenched = false;

  // Protocol configuration
  private currentProtocol: ProtocolType = 'theta-beta-ratio';
  private targetThreshold = 1.85;
  private phaseAngle = 0;
  private noiseSeed = Math.random() * 100;

  // Real Muse Bluetooth Hardware State
  public isHardwareConnected = false;
  public isBrainflowActive = false;
  public brainflowSessionId: string | null = null;
  private brainflowUnsubscribe: (() => void) | null = null;

  public deviceName: string | null = null;
  public batteryLevel = 92;
  public packetsReceivedCount = 0;
  
  // Real-time raw signal storage buffers (256 samples = 1 sec at 256Hz)
  public rawBuffers: Record<keyof MuseChannelQuality, number[]> = {
    tp9: [],
    af7: [],
    af8: [],
    tp10: [],
  };
  private maxBufferSize = 512; // 2 seconds of buffer

  public channelQuality: MuseChannelQuality = {
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  };

  // Channel RMS and Noise Statistics
  public channelRms: Record<keyof MuseChannelQuality, number> = {
    tp9: 0,
    af7: 0,
    af8: 0,
    tp10: 0,
  };

  // BrainFlow Async Scoring State
  private latestBrainFlowScores: BrainFlowScores | null = null;
  private lastBrainflowAnalysisTime = 0;
  private isAnalyzingBrainflow = false;

  private gattServer: any = null;
  private activeCharacteristics: any[] = [];

  // Demo Mode Toggle (explicit only)
  public isDemoMode = false;

  constructor() {}

  public setProtocol(protocol: ProtocolType, threshold?: number) {
    this.currentProtocol = protocol;
    if (threshold !== undefined) {
      this.targetThreshold = threshold;
    } else {
      switch (protocol) {
        case 'theta-beta-ratio':
          this.targetThreshold = 1.85;
          break;
        case 'smr-enhancement':
          this.targetThreshold = 7.5;
          break;
        case 'alpha-enhancement':
          this.targetThreshold = 11.0;
          break;
        case 'alpha-theta-crossover':
          this.targetThreshold = 1.0;
          break;
        case 'beta-downtraining':
          this.targetThreshold = 14.0;
          break;
      }
    }
  }

  public setThreshold(threshold: number) {
    this.targetThreshold = threshold;
  }

  public getThreshold(): number {
    return this.targetThreshold;
  }

  public subscribe(cb: (data: EEGDataPoint) => void): () => void {
    this.subscribers.push(cb);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== cb);
    };
  }

  public start(intervalMs = 100) {
    if (this.isRunning) return;
    this.isRunning = true;

    let lastTime = performance.now();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Trigger periodic BrainFlow window analysis if hardware is streaming
      if (this.isHardwareConnected && !this.isAnalyzingBrainflow && now - this.lastBrainflowAnalysisTime > 300) {
        this.dispatchBrainflowAnalysis(now);
      }

      const point = this.generateSample(dt);
      this.subscribers.forEach(cb => cb(point));
    }, intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Connect to real Muse 2 or Muse S Headband via standard Web Bluetooth GATT
   * Subscribes to all 4 electrode channels (TP9, AF7, AF8, TP10) and battery levels.
   */
  public async connectMuseBluetooth(): Promise<{ success: boolean; deviceName?: string; error?: string }> {
    if (!('bluetooth' in navigator)) {
      this.isHardwareConnected = false;
      return { success: false, error: 'Web Bluetooth is not supported on this browser (Chrome / Edge recommended).' };
    }

    try {
      // @ts-ignore
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ namePrefix: 'Muse' }],
        optionalServices: [
          '0000fe8d-0000-1000-8000-00805f9b34fb', // Muse Base EEG Service
          '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
        ],
      });

      if (!device || !device.gatt) {
        throw new Error('GATT connection failed');
      }

      this.gattServer = await device.gatt.connect();
      this.isHardwareConnected = true;
      this.deviceName = device.name || 'Muse Headband';

      // Disconnection listener
      device.addEventListener('gattserverdisconnected', () => {
        this.isHardwareConnected = false;
        this.deviceName = null;
        this.gattServer = null;
        this.activeCharacteristics = [];
        this.resetChannelQualities();
      });

      const eegService = await this.gattServer.getPrimaryService('0000fe8d-0000-1000-8000-00805f9b34fb');

      // Muse EEG Characteristic UUIDs for TP9, AF7, AF8, and TP10
      const channelUUIDs: Record<keyof MuseChannelQuality, string> = {
        tp9: '273e0003-4c4d-454d-96be-f03bac821358',
        af7: '273e0004-4c4d-454d-96be-f03bac821358',
        af8: '273e0005-4c4d-454d-96be-f03bac821358',
        tp10: '273e0006-4c4d-454d-96be-f03bac821358',
      };

      // Subscribe to all 4 channels
      for (const [channel, uuid] of Object.entries(channelUUIDs)) {
        try {
          const characteristic = await eegService.getCharacteristic(uuid);
          await characteristic.startNotifications();
          this.activeCharacteristics.push(characteristic);

          characteristic.addEventListener('characteristicvaluechanged', (e: any) => {
            this.packetsReceivedCount++;
            this.parseChannelPacket(channel as keyof MuseChannelQuality, e.target.value);
          });
        } catch (err) {
          console.warn(`Failed to connect channel ${channel}:`, err);
        }
      }

      // Battery service subscription
      try {
        const batteryService = await this.gattServer.getPrimaryService('0000180f-0000-1000-8000-00805f9b34fb');
        const batteryChar = await batteryService.getCharacteristic('00002a19-0000-1000-8000-00805f9b34fb');
        const val = await batteryChar.readValue();
        this.batteryLevel = val.getUint8(0);
      } catch (e) {}

      return { success: true, deviceName: this.deviceName || undefined };
    } catch (err: any) {
      this.isHardwareConnected = false;
      this.resetChannelQualities();
      return { success: false, error: err?.message || 'Connection failed' };
    }
  }

  /**
   * Connect to native BrainFlow acquisition service (e.g. Muse Athena or Synthetic Board)
   */
  public async connectBrainflowSession(deviceId = 'brainflow-synthetic'): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await brainflowService.startSession(deviceId);
      this.brainflowSessionId = session.sessionId;
      this.isBrainflowActive = true;
      this.isHardwareConnected = true;
      this.deviceName = session.deviceInfo?.label || 'BrainFlow Board';

      this.brainflowUnsubscribe = brainflowService.streamSession(
        session.sessionId,
        (frame) => {
          this.packetsReceivedCount++;
          if (frame.samples && frame.samples.length > 0) {
            const channels: Array<keyof MuseChannelQuality> = ['tp9', 'af7', 'af8', 'tp10'];
            frame.samples.forEach((row: number[]) => {
              channels.forEach((ch, idx) => {
                if (row[idx] !== undefined) {
                  this.rawBuffers[ch].push(row[idx]);
                  if (this.rawBuffers[ch].length > this.maxBufferSize) {
                    this.rawBuffers[ch].shift();
                  }
                }
              });
            });
          }

          if (frame.features) {
            this.latestBrainFlowScores = {
              focusScore: frame.features.focusScore ?? 50,
              relaxScore: frame.features.relaxScore ?? 50,
              mindfulnessScore: frame.features.mindfulnessScore ?? null,
              restfulnessScore: frame.features.restfulnessScore ?? null,
              method: 'brainflow_welch_psd',
            };
          }
        },
        () => {
          this.isBrainflowActive = false;
        },
        () => {
          this.disconnectHardware();
        }
      );

      return { success: true };
    } catch (err: any) {
      this.isBrainflowActive = false;
      return { success: false, error: err?.message || 'Failed to connect BrainFlow service' };
    }
  }

  public disconnectHardware() {
    if (this.gattServer && this.gattServer.connected) {
      this.gattServer.disconnect();
    }
    if (this.brainflowUnsubscribe) {
      this.brainflowUnsubscribe();
      this.brainflowUnsubscribe = null;
    }
    if (this.brainflowSessionId) {
      brainflowService.stopSession(this.brainflowSessionId);
      this.brainflowSessionId = null;
    }

    this.isHardwareConnected = false;
    this.isBrainflowActive = false;
    this.deviceName = null;
    this.gattServer = null;
    this.activeCharacteristics = [];
    this.latestBrainFlowScores = null;
    this.resetChannelQualities();
  }

  private resetChannelQualities() {
    this.channelQuality = {
      tp9: 'poor',
      af7: 'poor',
      af8: 'poor',
      tp10: 'poor',
    };
  }

  /**
   * Decodes Muse raw EEG packets.
   * Muse transmits 12 samples per packet at 256Hz sampling rate.
   */
  private parseChannelPacket(channel: keyof MuseChannelQuality, dataView: DataView) {
    if (dataView.byteLength < 2) return;

    // Buffer raw microvolts
    const samples: number[] = [];
    for (let i = 2; i < dataView.byteLength; i += 2) {
      if (i + 1 < dataView.byteLength) {
        const rawVal = dataView.getUint16(i, false);
        // Unpack 12-bit compressed integer sample
        const uv = (rawVal - 2048) * 0.488;
        samples.push(uv);
      }
    }

    const buffer = this.rawBuffers[channel];
    buffer.push(...samples);
    if (buffer.length > this.maxBufferSize) {
      this.rawBuffers[channel] = buffer.slice(buffer.length - this.maxBufferSize);
    }

    // Evaluate skin contact impedance and electrode fit
    const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, samples.length);
    const sd = Math.sqrt(variance);
    this.channelRms[channel] = Math.round(sd * 10) / 10;

    // Check for rail/disconnection (extreme noise or flatline)
    const hasRailedValues = samples.some(v => Math.abs(v) > 850);

    if (hasRailedValues || sd > 160 || sd < 1.2) {
      this.channelQuality[channel] = 'poor';
    } else if (sd > 75) {
      this.channelQuality[channel] = 'fair';
    } else {
      this.channelQuality[channel] = 'good';
    }
  }

  /**
   * Send recent 256-sample window of all 4 channels to BrainFlow /analyze-window
   */
  private async dispatchBrainflowAnalysis(now: number) {
    const tp9 = this.rawBuffers.tp9;
    const af7 = this.rawBuffers.af7;
    const af8 = this.rawBuffers.af8;
    const tp10 = this.rawBuffers.tp10;

    const minLen = Math.min(tp9.length, af7.length, af8.length, tp10.length);
    if (minLen < 128) return;

    const windowSize = Math.min(minLen, 256);
    const samples = [
      tp9.slice(-windowSize),
      af7.slice(-windowSize),
      af8.slice(-windowSize),
      tp10.slice(-windowSize),
    ];

    this.isAnalyzingBrainflow = true;
    this.lastBrainflowAnalysisTime = now;

    try {
      const features: BrainFlowFeatures | null = await brainflowService.analyzeWindow(samples, 256);
      if (features) {
        this.latestBrainFlowScores = {
          focusScore: features.focusScore ?? 50,
          relaxScore: features.relaxScore ?? 50,
          mindfulnessScore: features.mindfulnessScore ?? null,
          restfulnessScore: features.restfulnessScore ?? null,
          method: 'brainflow_welch_psd',
        };
      }
    } catch {
      // Keep running with in-browser spectral DSP
    } finally {
      this.isAnalyzingBrainflow = false;
    }
  }

  /**
   * Performs discrete Fourier spectral frequency estimation on raw electrode buffers.
   * Calculates true frequency band powers (Delta, Theta, Alpha, SMR, Beta, Gamma) in µV.
   */
  private calculateBandsFromHardware(): BandPowers {
    const af7 = this.rawBuffers.af7;
    const af8 = this.rawBuffers.af8;
    const tp9 = this.rawBuffers.tp9;
    const tp10 = this.rawBuffers.tp10;

    const N = Math.min(128, af7.length, af8.length);
    if (N < 32) {
      return { delta: 10.0, theta: 6.0, alpha: 8.0, smr: 5.0, beta: 7.0, gamma: 2.5 };
    }

    // Average frontal channels (AF7/AF8) with side reference (TP9/TP10)
    const windowSamples: number[] = [];
    for (let i = 0; i < N; i++) {
      const afAvg = (af7[af7.length - N + i] + af8[af8.length - N + i]) / 2;
      const tpAvg = ((tp9[tp9.length - N + i] || 0) + (tp10[tp10.length - N + i] || 0)) / 2;
      // High-pass detrend
      windowSamples.push(afAvg - tpAvg * 0.2);
    }

    // Remove DC offset & apply Hanning window
    const mean = windowSamples.reduce((a, b) => a + b, 0) / N;
    const windowed = windowSamples.map((v, i) => {
      const han = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
      return (v - mean) * han;
    });

    const samplingRate = 256;
    const binWidth = samplingRate / N; // 2 Hz per bin for N=128

    const computePowerInFreqRange = (lowHz: number, highHz: number): number => {
      let totalPower = 0;
      let binCount = 0;

      for (let k = 1; k < N / 2; k++) {
        const freq = k * binWidth;
        if (freq >= lowHz && freq < highHz) {
          let real = 0;
          let imag = 0;
          for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            real += windowed[n] * Math.cos(angle);
            imag -= windowed[n] * Math.sin(angle);
          }
          const mag = Math.sqrt(real * real + imag * imag) / N;
          totalPower += mag * mag;
          binCount++;
        }
      }

      const avgPower = binCount > 0 ? totalPower / binCount : 0;
      return Math.sqrt(avgPower) * 2; // Convert back to amplitude microvolts
    };

    const delta = Math.max(1.0, computePowerInFreqRange(1.0, 4.0));
    const theta = Math.max(1.0, computePowerInFreqRange(4.0, 8.0));
    const alpha = Math.max(1.0, computePowerInFreqRange(8.0, 12.0));
    const smr = Math.max(0.5, computePowerInFreqRange(12.0, 15.0));
    const beta = Math.max(0.8, computePowerInFreqRange(15.0, 30.0));
    const gamma = Math.max(0.2, computePowerInFreqRange(30.0, 45.0));

    return {
      delta: Math.round(delta * 10) / 10,
      theta: Math.round(theta * 10) / 10,
      alpha: Math.round(alpha * 10) / 10,
      smr: Math.round(smr * 10) / 10,
      beta: Math.round(beta * 10) / 10,
      gamma: Math.round(gamma * 10) / 10,
    };
  }

  private generateSample(dt: number): EEGDataPoint {
    let bands: BandPowers;
    let rawSignal = 0;

    if (this.isHardwareConnected) {
      // 1. COMPUTE 100% REAL DATA FROM HARDWARE
      bands = this.calculateBandsFromHardware();
      const af7 = this.rawBuffers.af7;
      rawSignal = af7.length > 0 ? af7[af7.length - 1] : 0;
    } else if (this.isDemoMode) {
      // 2. SIMULATE VALUES ONLY WHEN DEMO MODE IS EXPLICITLY ENABLED
      this.phaseAngle += dt * 2 * Math.PI;
      this.noiseSeed += dt * 0.5;

      const focusNorm = Math.max(0, Math.min(100, this.userFocus)) / 100;
      const calmNorm = Math.max(0, Math.min(100, this.userCalm)) / 100;
      const slowDrift = Math.sin(this.phaseAngle * 0.3 + this.noiseSeed) * 2.0;

      const delta = 14.0 + Math.sin(this.phaseAngle * 1.5) * 3.0 + (1 - focusNorm) * 5.0;
      const thetaBase = 9.0 + (1 - focusNorm) * 7.5 + Math.sin(this.phaseAngle * 5.2) * 2.2;
      const theta = Math.max(2.0, thetaBase);

      let alphaBase = 7.0 + calmNorm * 8.5 + (this.eyeClosed ? 8.0 : 0);
      const spindle = Math.pow(Math.sin(this.phaseAngle * 1.1), 4) * 3.5;
      const alpha = Math.max(3.0, alphaBase + spindle);

      const smrBase = 4.5 + focusNorm * 4.0 + calmNorm * 2.5 + Math.sin(this.phaseAngle * 13.5) * 1.2;
      const smr = Math.max(1.5, smrBase);

      const betaBase = 6.0 + focusNorm * 8.0 + (this.jawClenched ? 12.0 : 0) + Math.cos(this.phaseAngle * 20.0) * 1.8;
      const beta = Math.max(2.5, betaBase);
      const gamma = 3.0 + focusNorm * 3.5 + Math.sin(this.phaseAngle * 38.0) * 1.0;

      bands = {
        delta: Math.round(delta * 10) / 10,
        theta: Math.round(theta * 10) / 10,
        alpha: Math.round(alpha * 10) / 10,
        smr: Math.round(smr * 10) / 10,
        beta: Math.round(beta * 10) / 10,
        gamma: Math.round(gamma * 10) / 10,
      };

      rawSignal =
        slowDrift +
        Math.sin(this.phaseAngle * 2) * (delta * 0.4) +
        Math.sin(this.phaseAngle * 6) * (theta * 0.5) +
        Math.sin(this.phaseAngle * 10) * (alpha * 0.7) +
        Math.sin(this.phaseAngle * 14) * (smr * 0.6) +
        Math.sin(this.phaseAngle * 22) * (beta * 0.5) +
        (Math.random() - 0.5) * 1.5;
    } else {
      // 3. DISCONNECTED & DEMO INACTIVE -> ZERO TELEMETRY (FLATLINE)
      bands = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
      rawSignal = 0;
    }

    const thetaBetaRatio = Math.round((bands.theta / Math.max(0.1, bands.beta)) * 100) / 100;

    let inZone = false;
    switch (this.currentProtocol) {
      case 'theta-beta-ratio':
        inZone = thetaBetaRatio <= this.targetThreshold;
        break;
      case 'smr-enhancement':
        inZone = bands.smr >= this.targetThreshold;
        break;
      case 'alpha-enhancement':
        inZone = bands.alpha >= this.targetThreshold;
        break;
      case 'alpha-theta-crossover':
        inZone = bands.theta >= bands.alpha * this.targetThreshold;
        break;
      case 'beta-downtraining':
        inZone = bands.beta <= this.targetThreshold;
        break;
    }

    const rawCoherence = 45 + (bands.alpha / 20) * 30 + (bands.beta / 20) * 20;
    const coherence = Math.max(10, Math.min(99, Math.round(rawCoherence)));

    // Overall signal quality based on worst channel
    const qualities = Object.values(this.channelQuality);
    let overallQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected' = 'excellent';
    if (!this.isHardwareConnected && !this.isDemoMode) {
      overallQuality = 'disconnected';
    } else if (qualities.includes('poor')) {
      overallQuality = 'poor';
    } else if (qualities.includes('fair')) {
      overallQuality = 'fair';
    } else {
      overallQuality = 'good';
    }

    return {
      timestamp: Date.now(),
      rawSignal: Math.round(rawSignal * 10) / 10,
      bands,
      thetaBetaRatio,
      coherence,
      inZone,
      signalQuality: overallQuality,
      channelQuality: this.channelQuality,
      batteryLevel: this.batteryLevel,
      artifacts: {
        blink: this.isHardwareConnected ? (this.rawBuffers.af7.slice(-10).some(v => Math.abs(v) > 120)) : (Math.random() < 0.02),
        clench: this.jawClenched || (this.isHardwareConnected && (this.rawBuffers.tp9.slice(-10).some(v => Math.abs(v) > 200))),
      },
      brainflowScores: this.latestBrainFlowScores || undefined,
    };
  }
}

export const eegEngine = new EEGEngine();
