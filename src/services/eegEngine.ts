import { BandPowers, BrainFlowScores, EEGDataPoint, MuseChannelQuality, ProtocolType, ServerFitState, TrainingMetricSample, IndividualBaselineModel } from '../types';
import { brainflowService, BrainFlowFeatures } from './brainflowService';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

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

  // Server-side fit state from brainflow_service
  public serverFitState: ServerFitState | null = null;
  private fitSessionId: string | null = null;

  // Channel quality — driven exclusively by server-side fit assessment
  public channelQuality: MuseChannelQuality = {
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  };

  // BrainFlow Async Scoring State
  private latestBrainFlowScores: BrainFlowScores | null = null;
  private latestTrainingMetric: TrainingMetricSample | null = null;
  private lastBrainflowAnalysisTime = 0;
  private isAnalyzingBrainflow = false;

  // Latest band powers from server
  private latestServerBands: BandPowers | null = null;

  private gattServer: any = null;
  private activeCharacteristics: any[] = [];

  // Demo Mode Toggle (explicit only)
  public isDemoMode = false;
  public demoTimeElapsed = 0;

  // Web Worker for FFT / Baseline
  private eegWorker: Worker | null = null;
  public isCalibrating = false;
  public individualBaselineModel: IndividualBaselineModel | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.eegWorker = new Worker(new URL('./eegWorker.ts', import.meta.url), { type: 'module' });
      this.eegWorker.onmessage = (e) => this.handleWorkerMessage(e);
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, payload } = e.data;
    if (type === 'BASELINE_CALIBRATED') {
      this.individualBaselineModel = {
        alphaPeakHz: payload.alphaPeakHz,
        oneOverFSlope: payload.oneOverFSlope,
        lastCalibratedAt: new Date().toISOString()
      };
      this.isCalibrating = false;
    } else if (type === 'FEATURES_EXTRACTED') {
      if (payload.bands) {
        this.latestServerBands = {
          delta: payload.bands.delta || 0,
          theta: payload.bands.theta || 0,
          alpha: payload.bands.alpha || 0,
          smr: payload.bands.smr || 0,
          beta: payload.bands.beta || 0,
          gamma: payload.bands.gamma || 0
        };
      }
      if (payload.learningScore !== undefined) {
        this.latestTrainingMetric = {
          score: payload.learningScore,
          baselineReady: true
        };
      }
      this.isAnalyzingBrainflow = false;
    }
  }

  public startCalibration() {
    this.isCalibrating = true;
    this.individualBaselineModel = null;
    
    // In a real scenario, this collects 2 minutes of Eyes Open/Closed data before sending
    if (this.eegWorker) {
      this.eegWorker.postMessage({
        type: 'CALIBRATE_BASELINE',
        payload: {
          rawData: [this.rawBuffers.tp9, this.rawBuffers.af7, this.rawBuffers.af8, this.rawBuffers.tp10]
        }
      });
    } else {
      // Fallback if no worker
      setTimeout(() => {
        this.individualBaselineModel = {
          alphaPeakHz: 10.0,
          oneOverFSlope: -1.0,
          lastCalibratedAt: new Date().toISOString()
        };
        this.isCalibrating = false;
      }, 2000);
    }
  }

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

      // Trigger periodic brainflow_service analysis if hardware is streaming
      if (this.isHardwareConnected && this.fitSessionId && !this.isAnalyzingBrainflow && now - this.lastBrainflowAnalysisTime > 400) {
        this.dispatchServerAnalysis(now);
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
   * Connect to real Muse 2 or Muse S Headband via standard Web Bluetooth GATT.
   * Also creates a server-side fit session for scoring via brainflow_service.
   */
  public async connectMuseBluetooth(): Promise<{ success: boolean; deviceName?: string; error?: string }> {
    if (!Capacitor.isNativePlatform() && !('bluetooth' in navigator)) {
      this.isHardwareConnected = false;
      return { success: false, error: 'Web Bluetooth is not supported on this browser (Chrome / Edge recommended).' };
    }

    try {
      // Start server-side fit session first — required for all scoring
      try {
        this.fitSessionId = await brainflowService.startFitSession();
      } catch (err: any) {
        return { success: false, error: `brainflow_service unavailable: ${err?.message || 'Cannot connect to http://127.0.0.1:8000'}` };
      }

      // @ts-ignore
      let device: any = null;
      
      if (Capacitor.isNativePlatform()) {
        await BleClient.initialize({ androidNeverForLocation: true });
        const bleDevice = await BleClient.requestDevice({
          services: ['0000fe8d-0000-1000-8000-00805f9b34fb'],
        });
        device = { id: bleDevice.deviceId, name: bleDevice.name };
        
        await BleClient.connect(device.id, (deviceId) => {
          this.disconnectHardware();
        });

        this.isHardwareConnected = true;
        this.deviceName = device.name || 'Muse Headband';
        this.gattServer = { connected: true, deviceId: device.id };

        const eegService = '0000fe8d-0000-1000-8000-00805f9b34fb';
        const channelUUIDs: Record<keyof MuseChannelQuality, string> = {
          tp9: '273e0003-4c4d-454d-96be-f03bac821358',
          af7: '273e0004-4c4d-454d-96be-f03bac821358',
          af8: '273e0005-4c4d-454d-96be-f03bac821358',
          tp10: '273e0006-4c4d-454d-96be-f03bac821358',
        };

        for (const [channel, uuid] of Object.entries(channelUUIDs)) {
          try {
            await BleClient.startNotifications(
              device.id,
              eegService,
              uuid,
              (value) => {
                this.packetsReceivedCount++;
                this.parseChannelPacket(channel as keyof MuseChannelQuality, value);
              }
            );
          } catch (err) {
            console.warn(`Failed to connect channel ${channel}:`, err);
          }
        }

        const controlChar = '273e0001-4c4d-454d-96be-f03bac821358';
        try {
          await BleClient.write(device.id, eegService, controlChar, new DataView(new Uint8Array([0x02, 0x68, 0x0a]).buffer));
          await BleClient.write(device.id, eegService, controlChar, new DataView(new Uint8Array([0x04, 0x70, 0x32, 0x31, 0x0a]).buffer));
          await BleClient.write(device.id, eegService, controlChar, new DataView(new Uint8Array([0x02, 0x73, 0x0a]).buffer));
          await BleClient.write(device.id, eegService, controlChar, new DataView(new Uint8Array([0x02, 0x64, 0x0a]).buffer));
        } catch (ctrlErr) {
          console.log('Muse control characteristic notice:', ctrlErr);
        }

        try {
          const batteryService = '0000180f-0000-1000-8000-00805f9b34fb';
          const batteryChar = '00002a19-0000-1000-8000-00805f9b34fb';
          const val = await BleClient.read(device.id, batteryService, batteryChar);
          this.batteryLevel = val.getUint8(0);
        } catch (e) {}

        return { success: true, deviceName: this.deviceName || undefined };
      } else {
        device = await (navigator as any).bluetooth.requestDevice({
          filters: [{ namePrefix: 'Muse' }],
          optionalServices: [
            '0000fe8d-0000-1000-8000-00805f9b34fb', // Muse Base EEG Service
            '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
          ],
        });
      }

      if (!device || !device.gatt) {
        throw new Error('GATT connection failed');
      }

      this.gattServer = await device.gatt.connect();
      this.isHardwareConnected = true;
      this.deviceName = device.name || 'Muse Headband';

      // Disconnection listener
      device.addEventListener('gattserverdisconnected', () => {
        this.disconnectHardware();
      });

      const eegService = await this.gattServer.getPrimaryService('0000fe8d-0000-1000-8000-00805f9b34fb');

      // Muse EEG Characteristic UUIDs for TP9, AF7, AF8, and TP10 (scalp electrodes only — no AUX)
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

      // Send the Muse start streaming command to the control characteristic
      try {
        const controlChar = await eegService.getCharacteristic('273e0001-4c4d-454d-96be-f03bac821358');
        
        // 1. Halt: '\x02h\n'
        await controlChar.writeValue(new Uint8Array([0x02, 0x68, 0x0a])).catch(() => {});
        
        // 2. Preset 21 (256Hz 4-channel): '\x04p21\n'
        await controlChar.writeValue(new Uint8Array([0x04, 0x70, 0x32, 0x31, 0x0a])).catch(() => {});
        
        // 3. Start transmission: '\x02s\n'
        await controlChar.writeValue(new Uint8Array([0x02, 0x73, 0x0a])).catch(() => {});
        
        // 4. Resume: '\x02d\n'
        await controlChar.writeValue(new Uint8Array([0x02, 0x64, 0x0a])).catch(() => {});
      } catch (ctrlErr) {
        console.log('Muse control characteristic notice:', ctrlErr);
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
      // Clean up the fit session if BLE pairing fails
      if (this.fitSessionId) {
        brainflowService.stopFitSession(this.fitSessionId);
        this.fitSessionId = null;
      }
      this.isHardwareConnected = false;
      this.resetState();
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
              valence: frame.features.valence ?? null,
              arousal: frame.features.arousal ?? null,
              emotionLabel: frame.features.emotionLabel ?? null,
              method: 'brainflow_welch_psd',
            };
          }

          if (frame.training) {
            this.latestTrainingMetric = {
              score: frame.training.score ?? 50,
              baselineReady: frame.training.baselineReady ?? false,
            };
          }

          if (frame.quality) {
            this.updateChannelQualityFromServer(frame.quality);
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
    if (Capacitor.isNativePlatform() && this.gattServer?.deviceId) {
      BleClient.disconnect(this.gattServer.deviceId).catch(() => {});
    } else if (this.gattServer && this.gattServer.connected) {
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
    // Release server-side fit session
    if (this.fitSessionId) {
      brainflowService.stopFitSession(this.fitSessionId);
      this.fitSessionId = null;
    }

    this.isHardwareConnected = false;
    this.isBrainflowActive = false;
    this.deviceName = null;
    this.gattServer = null;
    this.activeCharacteristics = [];
    this.latestBrainFlowScores = null;
    this.latestTrainingMetric = null;
    this.latestServerBands = null;
    this.serverFitState = null;
    this.resetState();
  }

  private resetState() {
    this.channelQuality = {
      tp9: 'poor',
      af7: 'poor',
      af8: 'poor',
      tp10: 'poor',
    };
    this.rawBuffers = { tp9: [], af7: [], af8: [], tp10: [] };
  }

  /**
   * Decodes Muse raw EEG packets with 12-bit bit-unpacking.
   * Muse transmits 12 12-bit samples per 20-byte packet at 256Hz sampling rate.
   * Raw samples are buffered for server-side analysis — no local quality assessment.
   */
  private parseChannelPacket(channel: keyof MuseChannelQuality, dataView: DataView) {
    if (dataView.byteLength < 2) return;

    const samples: number[] = [];

    // Muse 2 / S standard: 20 bytes payload with 12 bit-packed 12-bit samples in bytes 2-19
    if (dataView.byteLength >= 20) {
      for (let i = 2; i < 20; i += 3) {
        if (i + 2 < dataView.byteLength) {
          const b0 = dataView.getUint8(i);
          const b1 = dataView.getUint8(i + 1);
          const b2 = dataView.getUint8(i + 2);
          const val1 = (b0 << 4) | (b1 >> 4);
          const val2 = ((b1 & 0x0F) << 8) | b2;
          // Scale 12-bit ADC raw integer (0-4095) to microvolts (0.48828 uV/count)
          const uv1 = (val1 - 2048) * 0.48828;
          const uv2 = (val2 - 2048) * 0.48828;
          if (Number.isFinite(uv1) && Number.isFinite(uv2)) {
            samples.push(uv1, uv2);
          }
        }
      }
    } else {
      // 16-bit integer fallback
      for (let i = 2; i < dataView.byteLength; i += 2) {
        const rawVal = dataView.getInt16(i, false);
        const uv = rawVal * 0.48828;
        if (Number.isFinite(uv)) {
          samples.push(uv);
        }
      }
    }

    if (samples.length === 0) return;

    const buffer = this.rawBuffers[channel];
    buffer.push(...samples);
    if (buffer.length > this.maxBufferSize) {
      this.rawBuffers[channel] = buffer.slice(buffer.length - this.maxBufferSize);
    }
  }

  /**
   * Send the latest sample window to eegWorker for client-side FFT extraction, 
   * falling back to brainflow_service if needed.
   * 
   * Samples are sent as row-major (time × channel) with only scalp electrodes.
   */
  private async dispatchServerAnalysis(now: number) {
    const tp9 = this.rawBuffers.tp9;
    const af7 = this.rawBuffers.af7;
    const af8 = this.rawBuffers.af8;
    const tp10 = this.rawBuffers.tp10;

    const minLen = Math.min(tp9.length, af7.length, af8.length, tp10.length);
    if (minLen < 64 || !this.fitSessionId) return;

    const windowSize = Math.min(minLen, 256);

    // Build row-major format: one inner array per time sample, 4 columns (TP9, AF7, AF8, TP10)
    const samples: number[][] = [];
    for (let i = 0; i < windowSize; i++) {
      samples.push([
        tp9[tp9.length - windowSize + i],
        af7[af7.length - windowSize + i],
        af8[af8.length - windowSize + i],
        tp10[tp10.length - windowSize + i],
      ]);
    }

    this.isAnalyzingBrainflow = true;
    this.lastBrainflowAnalysisTime = now;

    if (this.eegWorker) {
      // Use Dedicated Web Worker to avoid blocking main thread
      this.eegWorker.postMessage({
        type: 'EXTRACT_FEATURES',
        payload: {
          rawData: samples,
          baselineModel: this.individualBaselineModel
        }
      });
      // The rest of the state updates happen in handleWorkerMessage
      return;
    }

    try {
      const response = await brainflowService.analyzeFitWindow(this.fitSessionId, samples, 256);

      if (response) {
        // Update scores from server features
        if (response.features) {
          const f = response.features;
          this.latestBrainFlowScores = {
            focusScore: f.focusScore ?? 50,
            relaxScore: f.relaxScore ?? 50,
            mindfulnessScore: f.mindfulnessScore ?? null,
            restfulnessScore: f.restfulnessScore ?? null,
            valence: f.valence ?? null,
            arousal: f.arousal ?? null,
            emotionLabel: f.emotionLabel ?? null,
            method: 'brainflow_welch_psd',
          };

          // Extract band powers from server if available
          if (f.bandPowers?.absolute) {
            const abs = f.bandPowers.absolute;
            this.latestServerBands = {
              delta: abs.delta ?? 0,
              theta: abs.theta ?? 0,
              alpha: abs.alpha ?? 0,
              smr: abs.smr ?? 0,
              beta: abs.beta ?? 0,
              gamma: abs.gamma ?? 0,
            };
          }
        }

        // Update channel quality from server fit assessment
        if (response.quality) {
          this.updateChannelQualityFromServer(response.quality);
        }

        // Update training metric
        if (response.training) {
          this.latestTrainingMetric = {
            score: response.training.score ?? 50,
            baselineReady: response.training.baselineReady ?? false,
          };
        }
      }
    } catch {
      // Server analysis failed — scores remain stale
    } finally {
      this.isAnalyzingBrainflow = false;
    }
  }

  /**
   * Map server-side fit quality to the local MuseChannelQuality and ServerFitState.
   */
  private updateChannelQualityFromServer(quality: any) {
    this.serverFitState = {
      state: quality.state || 'checking',
      ready: quality.ready ?? false,
      worn: quality.worn ?? false,
      blockers: quality.blockers || [],
      channels: quality.channels || [],
    };

    // Map server channel states to local MuseChannelQuality
    const channelMap: Record<string, keyof MuseChannelQuality> = {
      'TP9': 'tp9', 'tp9': 'tp9',
      'AF7': 'af7', 'af7': 'af7',
      'AF8': 'af8', 'af8': 'af8',
      'TP10': 'tp10', 'tp10': 'tp10',
    };

    if (quality.channels && Array.isArray(quality.channels)) {
      for (const ch of quality.channels) {
        const localKey = channelMap[ch.id];
        if (localKey) {
          const serverState = (ch.state || 'poor').toLowerCase();
          if (serverState === 'good') {
            this.channelQuality[localKey] = 'good';
          } else if (serverState === 'fair') {
            this.channelQuality[localKey] = 'fair';
          } else {
            this.channelQuality[localKey] = 'poor';
          }
        }
      }
    }
  }

  private generateSample(dt: number): EEGDataPoint {
    let bands: BandPowers;
    let rawSignal = 0;

    if (this.isHardwareConnected) {
      // Use server-provided band powers when available, otherwise zero
      if (this.latestServerBands) {
        bands = { ...this.latestServerBands };
      } else {
        bands = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
      }
      const af7 = this.rawBuffers.af7;
      rawSignal = af7.length > 0 ? af7[af7.length - 1] : 0;
    } else if (this.isDemoMode) {
      // SIMULATE VALUES ONLY WHEN DEMO MODE IS EXPLICITLY ENABLED
      if (this.isCalibrating) {
        // Just return empty point while calibrating
        return {
          timestamp: Date.now(),
          rawSignal: 0,
          bands: { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 },
          thetaBetaRatio: 0,
          coherence: 0,
          inZone: false,
          zoneScore: 0,
          signalQuality: 'good',
          channelQuality: this.channelQuality,
          batteryLevel: this.batteryLevel,
          artifacts: { blink: false, clench: false },
          isCalibrating: true
        };
      }
      this.phaseAngle += dt * 2 * Math.PI;
      this.noiseSeed += dt * 0.5;
      this.demoTimeElapsed += dt;

      // Ornstein-Uhlenbeck process for smoothed random walk
      // dx = theta * (mu - x) * dt + sigma * dW
      const thetaVal = 0.2; // Mean reversion speed
      const mu = 65;        // Mean target state
      const sigma = 18;     // Volatility

      const dW1 = (Math.random() - 0.5) * 2 * Math.sqrt(dt);
      const dW2 = (Math.random() - 0.5) * 2 * Math.sqrt(dt);
      
      this.userFocus += thetaVal * (mu - this.userFocus) * dt + sigma * dW1;
      this.userCalm += thetaVal * (mu - this.userCalm) * dt + sigma * dW2;
      
      // Keep within bounds
      this.userFocus = Math.max(10, Math.min(90, this.userFocus));
      this.userCalm = Math.max(10, Math.min(90, this.userCalm));

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
      // DISCONNECTED & DEMO INACTIVE -> ZERO TELEMETRY (FLATLINE)
      bands = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
      rawSignal = 0;
    }

    const thetaBetaRatio = Math.round((bands.theta / Math.max(0.1, bands.beta)) * 100) / 100;

    let inZone = false;
    let zoneScore = 0.0;
    
    switch (this.currentProtocol) {
      case 'theta-beta-ratio':
        inZone = thetaBetaRatio <= this.targetThreshold;
        zoneScore = Math.max(0, Math.min(1, 1 - (thetaBetaRatio - this.targetThreshold) / 1.5));
        break;
      case 'smr-enhancement':
        inZone = bands.smr >= this.targetThreshold;
        zoneScore = Math.max(0, Math.min(1, (bands.smr - this.targetThreshold + 1.5) / 3.0));
        break;
      case 'alpha-enhancement':
        inZone = bands.alpha >= this.targetThreshold;
        zoneScore = Math.max(0, Math.min(1, (bands.alpha - this.targetThreshold + 2.0) / 4.0));
        break;
      case 'alpha-theta-crossover':
        inZone = bands.theta >= bands.alpha * this.targetThreshold;
        zoneScore = Math.max(0, Math.min(1, (bands.theta / Math.max(0.1, bands.alpha) - this.targetThreshold + 0.5) / 1.5));
        break;
      case 'beta-downtraining':
        inZone = bands.beta <= this.targetThreshold;
        zoneScore = Math.max(0, Math.min(1, 1 - (bands.beta - this.targetThreshold) / 5.0));
        break;
      case 'individualized-upper-alpha':
        if (this.individualBaselineModel) {
          const paf = this.individualBaselineModel.alphaPeakHz;
          inZone = bands.alpha >= (paf + 1.0);
          zoneScore = Math.max(0, Math.min(1, (bands.alpha - paf + 1.0) / 4.0));
        } else {
          inZone = bands.alpha >= this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, (bands.alpha - this.targetThreshold + 2.0) / 4.0));
        }
        break;
    }

    const rawCoherence = 45 + (bands.alpha / 20) * 30 + (bands.beta / 20) * 20;
    const coherence = Math.max(10, Math.min(99, Math.round(rawCoherence)));

    // Signal quality derived from server fit state
    const qualities = Object.values(this.channelQuality);
    let overallQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected' = 'excellent';
    if (!this.isHardwareConnected && !this.isDemoMode) {
      overallQuality = 'disconnected';
    } else if (this.serverFitState) {
      // Use server's overall assessment
      if (this.serverFitState.state === 'good' && this.serverFitState.ready) {
        overallQuality = 'good';
      } else if (this.serverFitState.state === 'poor') {
        overallQuality = 'poor';
      } else if (qualities.includes('poor')) {
        overallQuality = 'poor';
      } else if (qualities.includes('fair')) {
        overallQuality = 'fair';
      } else {
        overallQuality = 'good';
      }
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
      zoneScore,
      signalQuality: overallQuality,
      channelQuality: this.channelQuality,
      batteryLevel: this.batteryLevel,
      artifacts: {
        blink: this.isHardwareConnected ? (this.rawBuffers.af7.slice(-10).some(v => Math.abs(v) > 120)) : (Math.random() < 0.02),
        clench: this.jawClenched || (this.isHardwareConnected && (this.rawBuffers.tp9.slice(-10).some(v => Math.abs(v) > 200))),
      },
      brainflowScores: this.latestBrainFlowScores || undefined,
      trainingMetric: this.latestTrainingMetric || undefined,
      isCalibrating: this.isCalibrating,
    };
  }
}

export const eegEngine = new EEGEngine();
