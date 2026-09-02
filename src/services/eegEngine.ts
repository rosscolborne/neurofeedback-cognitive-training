import { BandPowers, BrainFlowScores, EEGDataPoint, MuseChannelQuality, ProtocolType, ServerFitState, TrainingMetricSample, IndividualBaselineModel } from '../types';
import { getDefaultProtocolThreshold } from './protocols';
import { brainflowService } from './brainflowService';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { AthenaWasmDecoder, BleTransport } from '@elata-biosciences/eeg-web-ble';
import { initEegWasm, type HeadbandFrameV1 } from '@elata-biosciences/eeg-web';
import eegWasmUrl from '@elata-biosciences/eeg-web/wasm/eeg_wasm_bg.wasm?url';

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
  public batteryLevel: number | null = null;
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
  private latestServerBandAvailability: Partial<Record<keyof BandPowers, boolean>> = {};
  private latestServerRatios: Record<string, number> = {};
  private latestMetricCalibration: { status: 'off' | 'collecting' | 'active'; progress: number; required: number } = { status: 'off', progress: 0, required: 24 };
  private latestRawMetrics: Record<string, number> = {};
  private latestBaselineRelativeMetrics: Record<string, number> = {};
  private latestInterhemisphericCoherence: number | null = null;
  private latestTrainingFeedback: { ratio: number | null; inZone: boolean | null; zoneScore: number | null } | null = null;
  private localFitStableSince: number | null = null;

  private gattServer: any = null;
  private activeCharacteristics: any[] = [];
  private webBluetoothTransport: BleTransport | null = null;

  // Demo Mode State & Fast Simulator Cycle (<10 seconds loop)
  public isDemoMode = false;
  public demoTimeElapsed = 0;
  public demoCycleTime = 0;
  public demoState: 'auto' | 'focus' | 'calm' | 'drift' | 'recovery' = 'auto';
  public currentSimulatedStateName = 'Auto 10s Cycle';

  public isCalibrating = false;
  public individualBaselineModel: IndividualBaselineModel | null = null;

  constructor() {}

  public setSimulatedState(state: 'auto' | 'focus' | 'calm' | 'drift' | 'recovery') {
    this.demoState = state;
    if (state !== 'auto') {
      switch (state) {
        case 'focus':
          this.userFocus = 92;
          this.userCalm = 65;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'High Focus & SMR Activation';
          break;
        case 'calm':
          this.userFocus = 70;
          this.userCalm = 96;
          this.eyeClosed = true;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Deep Calm & Alpha Burst';
          break;
        case 'drift':
          this.userFocus = 25;
          this.userCalm = 30;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Cognitive Drift / Distraction';
          break;
        case 'recovery':
          this.userFocus = 96;
          this.userCalm = 88;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Operant Recovery & Peak Flow';
          break;
      }
    } else {
      this.currentSimulatedStateName = 'Auto 10s Multi-State Cycle';
    }
  }

  public setProtocol(protocol: ProtocolType, threshold?: number) {
    this.currentProtocol = protocol;
    this.targetThreshold = threshold ?? getDefaultProtocolThreshold(protocol);
    this.syncProtocolToBrainflowSession();
  }

  public setThreshold(threshold: number) {
    this.targetThreshold = threshold;
    this.syncProtocolToBrainflowSession();
  }

  public getThreshold(): number {
    return this.targetThreshold;
  }

  public getProtocol(): ProtocolType {
    return this.currentProtocol;
  }

  private syncProtocolToBrainflowSession() {
    if (this.brainflowSessionId) {
      void brainflowService.updateSessionProtocol(
        this.brainflowSessionId,
        this.currentProtocol,
        this.targetThreshold,
      );
    }
  }

  public async startMetricCalibration(metrics?: string[]): Promise<void> {
    if (this.brainflowSessionId) return brainflowService.startMetricCalibration(this.brainflowSessionId, false, metrics);
    if (this.fitSessionId) return brainflowService.startMetricCalibration(this.fitSessionId, true, metrics);
    throw new Error('Connect an EEG device before calibrating metrics.');
  }

  public async resetMetricCalibration(): Promise<void> {
    if (this.brainflowSessionId) return brainflowService.resetMetricCalibration(this.brainflowSessionId);
    if (this.fitSessionId) return brainflowService.resetMetricCalibration(this.fitSessionId, true);
    throw new Error('Connect an EEG device before resetting metric calibration.');
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

      // Browser Bluetooth is deliberately self-contained. A fit session is
      // only present for explicitly selected backend/BrainFlow workflows.
      if (this.isHardwareConnected && !this.isAnalyzingBrainflow && now - this.lastBrainflowAnalysisTime > 400) {
        if (this.fitSessionId) {
          this.dispatchServerAnalysis(now);
        } else if (!this.isBrainflowActive) {
          this.runBrowserAnalysis(now);
        }
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
   * Connect to real Muse 2 or Muse S Headband via Web Bluetooth (or the
   * Capacitor BLE bridge on native builds). This path must not depend on the
   * optional BrainFlow service: deployed web builds connect and process EEG
   * entirely in the browser.
   */
  public async connectMuseBluetooth(): Promise<{ success: boolean; deviceName?: string; error?: string }> {
    if (!Capacitor.isNativePlatform() && !('bluetooth' in navigator)) {
      this.isHardwareConnected = false;
      return { success: false, error: 'Web Bluetooth is not supported on this browser (Chrome / Edge recommended).' };
    }

    try {
      // Use the same supported Muse Athena decoder as eeg_demo in a browser.
      if (!Capacitor.isNativePlatform()) {
        await this.connectMuseBluetoothInBrowser();
        return { success: true, deviceName: this.deviceName || undefined };
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
        this.isDemoMode = false;
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
      }

      if (!device || !device.gatt) {
        throw new Error('GATT connection failed');
      }

      this.gattServer = await device.gatt.connect();
      this.isHardwareConnected = true;
      this.isDemoMode = false;
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
      this.isHardwareConnected = false;
      this.resetState();
      return { success: false, error: err?.message || 'Connection failed' };
    }
  }

  /**
   * Browser Muse acquisition through Elata's Athena WASM decoder. This is
   * deliberately the same decoder and normalized sample format used by the
   * known-working eeg_demo frontend.
   */
  private async connectMuseBluetoothInBrowser(): Promise<void> {
    await initEegWasm(eegWasmUrl);

    const transport = new BleTransport({
      deviceOptions: {
        athenaDecoderFactory: () => new AthenaWasmDecoder(),
        onDisconnected: () => this.disconnectHardware(),
      },
      sourceName: 'Waveable Muse Athena',
      eegProcessing: false,
    });
    this.webBluetoothTransport = transport;

    transport.onFrame = (frame: HeadbandFrameV1) => {
      this.ingestDecodedMuseFrame(frame);
    };

    await transport.connect();
    const board = transport.getBoardInfo() as { device_name?: string } | null;
    this.isHardwareConnected = true;
    this.isDemoMode = false;
    this.deviceName = board?.device_name || 'Muse Athena';
    await transport.start();
  }

  private ingestDecodedMuseFrame(frame: HeadbandFrameV1) {
    const eeg = frame.eegRaw ?? frame.eeg;
    const channelIndices: Record<keyof MuseChannelQuality, number> = {
      tp9: eeg.channelNames.findIndex((name) => name.toLowerCase() === 'tp9'),
      af7: eeg.channelNames.findIndex((name) => name.toLowerCase() === 'af7'),
      af8: eeg.channelNames.findIndex((name) => name.toLowerCase() === 'af8'),
      tp10: eeg.channelNames.findIndex((name) => name.toLowerCase() === 'tp10'),
    };

    for (const [channel, index] of Object.entries(channelIndices) as Array<[keyof MuseChannelQuality, number]>) {
      if (index < 0) continue;
      const samples = eeg.samples
        .map((row) => row[index])
        .filter((sample): sample is number => Number.isFinite(sample));
      if (samples.length === 0) continue;

      const buffer = this.rawBuffers[channel];
      buffer.push(...samples);
      if (buffer.length > this.maxBufferSize) {
        this.rawBuffers[channel] = buffer.slice(buffer.length - this.maxBufferSize);
      }
    }
  }

  /**
   * Connect to Muse Athena through the local BrainFlow service. This is the
   * same `brainflow-muse-athena` BoardShim configuration used by eeg_demo;
   * the app never opens a browser or Capacitor Bluetooth connection itself.
   */
  public async connectMuseAthenaBrainflow(): Promise<{
    success: boolean;
    deviceName?: string;
    error?: string;
  }> {
    const result = await this.connectBrainflowSession('brainflow-muse-athena');
    return {
      ...result,
      deviceName: result.success ? this.deviceName || undefined : undefined,
    };
  }

  /**
   * Connect to native BrainFlow acquisition service (also used by the dev-only
   * synthetic board).
   */
  public async connectBrainflowSession(deviceId = 'brainflow-synthetic'): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await brainflowService.startSession(deviceId, undefined, undefined, this.currentProtocol, this.targetThreshold);
      this.brainflowSessionId = session.sessionId;
      this.isBrainflowActive = true;
      this.isHardwareConnected = true;
      this.isDemoMode = false;
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
            const absoluteBands = frame.features.bandPowers?.absolute;
            if (absoluteBands) {
              this.latestServerBands = {
                delta: absoluteBands.delta ?? 0,
                theta: absoluteBands.theta ?? 0,
                alpha: absoluteBands.alpha ?? 0,
                smr: absoluteBands.smr ?? 0,
                beta: absoluteBands.beta ?? 0,
                gamma: absoluteBands.gamma ?? 0,
              };
              this.latestServerBandAvailability = {
                delta: typeof absoluteBands.delta === 'number',
                theta: typeof absoluteBands.theta === 'number',
                alpha: typeof absoluteBands.alpha === 'number',
                smr: typeof absoluteBands.smr === 'number',
                beta: typeof absoluteBands.beta === 'number',
                gamma: typeof absoluteBands.gamma === 'number',
              };
              this.latestServerRatios = frame.features.bandPowers?.ratios ?? {};
            }

            this.latestBrainFlowScores = {
              mindfulnessScore: frame.features.mindfulnessScore ?? null,
              restfulnessScore: frame.features.restfulnessScore ?? null,
              valence: frame.features.valence ?? null,
              arousal: frame.features.arousal ?? null,
              emotionLabel: frame.features.stateLabel ?? frame.features.emotionLabel ?? null,
              method: 'brainflow_welch_psd',
            };
            this.latestInterhemisphericCoherence = frame.features.interhemisphericCoherence ?? null;
            this.latestMetricCalibration = { status: frame.features.calibrationStatus ?? 'off', progress: frame.features.calibrationProgress ?? 0, required: frame.features.calibrationRequired ?? 24 };
            this.latestRawMetrics = frame.features.rawMetrics ?? {};
            this.latestBaselineRelativeMetrics = frame.features.baselineRelativeMetrics ?? {};
            this.latestTrainingFeedback = { ratio: frame.features.bandPowers?.ratios?.thetaBeta ?? null, inZone: frame.features.inZone ?? null, zoneScore: frame.features.zoneScore ?? null };
          }

          if (frame.training) {
            this.latestTrainingMetric = {
              score: frame.training.score ?? null,
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
    if (this.webBluetoothTransport) {
      const transport = this.webBluetoothTransport;
      this.webBluetoothTransport = null;
      transport.disconnect().catch(() => {});
    }
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
    this.latestServerBandAvailability = {};
    this.latestServerRatios = {};
    this.latestInterhemisphericCoherence = null;
    this.latestTrainingFeedback = null;
    this.localFitStableSince = null;
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
    this.localFitStableSince = null;
  }

  /**
   * Decodes Muse raw EEG packets with 12-bit bit-unpacking.
   * Muse transmits 12 12-bit samples per 20-byte packet at 256Hz sampling rate.
   * Raw samples are buffered for server-side analysis (via analyzeFitWindow) which provides
   * authoritative channel quality and serverFitState.
   */
  public static decodeChannelPacket(dataView: DataView): number[] {
    if (dataView.byteLength < 2) return [];

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

    return samples;
  }

  private parseChannelPacket(channel: keyof MuseChannelQuality, dataView: DataView) {
    const samples = EEGEngine.decodeChannelPacket(dataView);
    if (samples.length === 0) return;

    const buffer = this.rawBuffers[channel];
    buffer.push(...samples);
    if (buffer.length > this.maxBufferSize) {
      this.rawBuffers[channel] = buffer.slice(buffer.length - this.maxBufferSize);
    }
  }

  /**
   * DEV-ONLY helper to simulate raw 20-byte BLE Muse packets and exercise
   * parseChannelPacket() -> buffers -> dispatchServerAnalysis() without physical BLE hardware.
   */
  public simulateMuseBluetoothPackets(durationMs = 5000, frequencyHz = 10, amplitudeUv = 30): () => void {
    this.isHardwareConnected = true;
    this.deviceName = 'Simulated Muse S (Dev)';
    let packetSeq = 0;
    let elapsedMs = 0;

    const interval = setInterval(() => {
      elapsedMs += 47; // ~21.3 packets/sec per channel (12 samples * 21.33 ≈ 256Hz)
      packetSeq = (packetSeq + 1) & 0xFFFF;

      const channels: Array<keyof MuseChannelQuality> = ['tp9', 'af7', 'af8', 'tp10'];
      for (const channel of channels) {
        const buffer = new ArrayBuffer(20);
        const view = new DataView(buffer);
        view.setUint16(0, packetSeq, false); // Sequence number

        for (let i = 0; i < 6; i++) {
          const t1 = (elapsedMs + i * 2 * (1000 / 256)) / 1000;
          const t2 = (elapsedMs + (i * 2 + 1) * (1000 / 256)) / 1000;

          // Generate realistic EEG sine wave + small noise
          const uv1 = amplitudeUv * Math.sin(2 * Math.PI * frequencyHz * t1);
          const uv2 = amplitudeUv * Math.sin(2 * Math.PI * frequencyHz * t2);

          const raw1 = Math.max(0, Math.min(4095, Math.round(uv1 / 0.48828 + 2048)));
          const raw2 = Math.max(0, Math.min(4095, Math.round(uv2 / 0.48828 + 2048)));

          const b0 = (raw1 >> 4) & 0xFF;
          const b1 = ((raw1 & 0x0F) << 4) | ((raw2 >> 8) & 0x0F);
          const b2 = raw2 & 0xFF;

          view.setUint8(2 + i * 3, b0);
          view.setUint8(2 + i * 3 + 1, b1);
          view.setUint8(2 + i * 3 + 2, b2);
        }

        this.parseChannelPacket(channel, view);
      }
    }, 47);

    const stopSim = () => {
      clearInterval(interval);
      if (this.deviceName === 'Simulated Muse S (Dev)') {
        this.isHardwareConnected = false;
        this.deviceName = null;
      }
    };

    if (durationMs > 0) {
      setTimeout(stopSim, durationMs);
    }

    return stopSim;
  }

  /**
   * Browser-side analysis for the Web Bluetooth path. This intentionally
   * mirrors the Bluetooth-specific fit thresholds in brainflow_service, but
   * never contacts it. That keeps pairing, fit validation, band telemetry and
   * protocol feedback usable from a static Vercel deployment.
   */
  private runBrowserAnalysis(now: number) {
    const channels: Array<keyof MuseChannelQuality> = ['tp9', 'af7', 'af8', 'tp10'];
    const minLen = Math.min(...channels.map(channel => this.rawBuffers[channel].length));
    if (minLen < 64) return;

    this.isAnalyzingBrainflow = true;
    this.lastBrainflowAnalysisTime = now;

    try {
      const windowSize = Math.min(minLen, 512);
      const windows = Object.fromEntries(
        channels.map(channel => [channel, this.rawBuffers[channel].slice(-windowSize)]),
      ) as Record<keyof MuseChannelQuality, number[]>;

      this.updateBrowserFit(windows, now);
      const bands = this.calculateBrowserBands(windows);
      this.latestServerBands = bands;
      this.latestServerBandAvailability = {
        delta: true,
        theta: true,
        alpha: true,
        smr: true,
        beta: true,
        gamma: true,
      };

      const ratio = (numerator: number, denominator: number) => numerator / Math.max(1e-9, denominator);
      const thetaBeta = ratio(bands.theta, bands.beta);
      this.latestServerRatios = {
        thetaBeta,
        betaTheta: ratio(bands.beta, bands.theta),
        alphaTheta: ratio(bands.alpha, bands.theta),
        thetaAlpha: ratio(bands.theta, bands.alpha),
        smrTheta: ratio(bands.smr, bands.theta),
        thetaAlphaBeta: ratio(bands.theta, bands.alpha + bands.beta),
        alphaBeta: ratio(bands.alpha, bands.beta),
        betaAlpha: ratio(bands.beta, bands.alpha),
        arousal: ratio(bands.beta + bands.gamma, bands.alpha + bands.theta),
        valence: ratio(bands.alpha, bands.theta + bands.beta),
        betaOverAlphaTheta: ratio(bands.beta, bands.alpha + bands.theta),
      };
      this.latestInterhemisphericCoherence = this.calculateBrowserCoherence(windows);
      this.updateBrowserDerivedMetrics();
      this.latestTrainingFeedback = this.calculateBrowserFeedback(bands, thetaBeta);
    } finally {
      this.isAnalyzingBrainflow = false;
    }
  }

  private updateBrowserFit(
    windows: Record<keyof MuseChannelQuality, number[]>,
    now: number,
  ) {
    const labels: Record<keyof MuseChannelQuality, string> = {
      tp9: 'TP9 (Left Ear)',
      af7: 'AF7 (Left Forehead)',
      af8: 'AF8 (Right Forehead)',
      tp10: 'TP10 (Right Ear)',
    };
    const channels = (Object.keys(windows) as Array<keyof MuseChannelQuality>).map(channel => {
      const values = windows[channel].filter(Number.isFinite);
      const count = values.length;
      const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
      const squareMean = count ? values.reduce((sum, value) => sum + value * value, 0) / count : 0;
      const variance = count ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count : 0;
      const rmsUv = Math.sqrt(squareMean);
      const stdDevUv = Math.sqrt(variance);
      const ordered = [...values].sort((a, b) => a - b);
      const percentile = (fraction: number) => ordered[Math.floor(Math.max(0, ordered.length - 1) * fraction)] ?? 0;
      const peakToPeakUv = percentile(0.95) - percentile(0.05);
      let totalStepUv = 0;
      let maxStepUv = 0;
      for (let index = 1; index < count; index++) {
        const step = Math.abs(values[index] - values[index - 1]);
        totalStepUv += step;
        maxStepUv = Math.max(maxStepUv, step);
      }
      const meanStepUv = totalStepUv / Math.max(1, count - 1);
      const maxAbsUv = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
      const clippedFraction = count
        ? values.filter(value => Math.abs(value) > 100000).length / count
        : 1;

      let state: 'good' | 'adjusting' | 'poor';
      if (count < 16) {
        state = 'adjusting';
      } else if (rmsUv < 0.35 || stdDevUv < 0.25 || maxAbsUv > 100000 || clippedFraction > 0.3) {
        state = 'poor';
      } else if (
        rmsUv > 20000 ||
        maxStepUv > 6500 ||
        stdDevUv > 320 ||
        peakToPeakUv > 850 ||
        meanStepUv > 300 ||
        maxStepUv > 700
      ) {
        state = 'adjusting';
      } else {
        state = 'good';
      }

      this.channelQuality[channel] = state === 'adjusting' ? 'fair' : state;
      return {
        channel: { id: channel, label: labels[channel] },
        state,
        rmsUv,
      };
    });

    const good = channels.filter(channel => channel.state === 'good');
    const poor = channels.filter(channel => channel.state === 'poor');
    const adjusting = channels.filter(channel => channel.state === 'adjusting');
    const enoughGood = good.length >= 2 && good.length / channels.length >= 0.5;
    const allFlat = channels.every(channel => {
      const values = windows[channel.channel.id as keyof MuseChannelQuality];
      const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
      return Math.sqrt(variance) < 0.25;
    });
    const worn = enoughGood && !allFlat;
    const excessiveArtifact = channels.some(channel => {
      const values = windows[channel.channel.id as keyof MuseChannelQuality];
      return values.slice(1).some((value, index) => Math.abs(value - values[index]) > 9750);
    });
    const acceptable = worn && poor.length / channels.length <= 0.5 && !excessiveArtifact;

    if (acceptable) {
      this.localFitStableSince ??= now;
    } else {
      this.localFitStableSince = null;
    }
    const ready = acceptable && this.localFitStableSince !== null && now - this.localFitStableSince >= 3500;
    const blockers: string[] = [];
    if (!worn) blockers.push(good.length ? `Need stable signal on more channels (${good.length}/${channels.length} good).` : 'Check headset fit.');
    if (poor.length) blockers.push(`Check headset fit near ${poor[0].channel.label}.`);
    if (adjusting.length) blockers.push(`Stabilize ${adjusting[0].channel.label}.`);
    if (excessiveArtifact) blockers.push('Excessive noise or movement.');

    this.serverFitState = {
      state: ready ? 'ready' : acceptable ? 'good' : poor.length / channels.length > 0.5 ? 'poor' : 'adjusting',
      ready,
      worn,
      blockers: ready ? [] : blockers,
      channels,
    };
  }

  private calculateBrowserBands(windows: Record<keyof MuseChannelQuality, number[]>): BandPowers {
    const sampleRate = 256;
    const sampleCount = Math.min(...Object.values(windows).map(values => values.length));
    const signal = Array.from({ length: sampleCount }, (_, index) => (
      windows.tp9[index] + windows.af7[index] + windows.af8[index] + windows.tp10[index]
    ) / 4);
    const mean = signal.reduce((sum, value) => sum + value, 0) / sampleCount;
    const windowed = signal.map((value, index) => (
      (value - mean) * 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, sampleCount - 1)))
    ));
    const binWidth = sampleRate / sampleCount;

    const amplitude = (lowHz: number, highHz: number) => {
      let power = 0;
      let bins = 0;
      for (let bin = 1; bin < sampleCount / 2; bin++) {
        const frequency = bin * binWidth;
        if (frequency < lowHz || frequency >= highHz) continue;
        let real = 0;
        let imaginary = 0;
        for (let index = 0; index < sampleCount; index++) {
          const angle = (2 * Math.PI * bin * index) / sampleCount;
          real += windowed[index] * Math.cos(angle);
          imaginary -= windowed[index] * Math.sin(angle);
        }
        power += real * real + imaginary * imaginary;
        bins++;
      }
      return bins ? (2 * Math.sqrt(power / bins)) / sampleCount : 0;
    };

    return {
      delta: amplitude(1, 4),
      theta: amplitude(4, 8),
      alpha: amplitude(8, 12),
      smr: amplitude(12, 15),
      beta: amplitude(15, 30),
      gamma: amplitude(30, 45),
    };
  }

  /** A frequency-domain AF7↔AF8 / TP9↔TP10 coherence estimate in 4–30 Hz. */
  private calculateBrowserCoherence(windows: Record<keyof MuseChannelQuality, number[]>): number | null {
    const sampleCount = Math.min(...Object.values(windows).map(values => values.length));
    if (sampleCount < 64) return null;
    const sampleRate = 256;
    const coherenceForPair = (left: number[], right: number[]) => {
      const leftMean = left.reduce((sum, value) => sum + value, 0) / sampleCount;
      const rightMean = right.reduce((sum, value) => sum + value, 0) / sampleCount;
      let crossReal = 0;
      let crossImaginary = 0;
      let leftPower = 0;
      let rightPower = 0;
      for (let bin = 1; bin < sampleCount / 2; bin++) {
        const frequency = (bin * sampleRate) / sampleCount;
        if (frequency < 4 || frequency > 30) continue;
        let leftReal = 0;
        let leftImaginary = 0;
        let rightReal = 0;
        let rightImaginary = 0;
        for (let index = 0; index < sampleCount; index++) {
          const weight = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, sampleCount - 1)));
          const angle = (2 * Math.PI * bin * index) / sampleCount;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const leftValue = (left[index] - leftMean) * weight;
          const rightValue = (right[index] - rightMean) * weight;
          leftReal += leftValue * cosine;
          leftImaginary -= leftValue * sine;
          rightReal += rightValue * cosine;
          rightImaginary -= rightValue * sine;
        }
        crossReal += leftReal * rightReal + leftImaginary * rightImaginary;
        crossImaginary += leftImaginary * rightReal - leftReal * rightImaginary;
        leftPower += leftReal * leftReal + leftImaginary * leftImaginary;
        rightPower += rightReal * rightReal + rightImaginary * rightImaginary;
      }
      const denominator = leftPower * rightPower;
      return denominator > 0
        ? Math.max(0, Math.min(1, (crossReal * crossReal + crossImaginary * crossImaginary) / denominator))
        : null;
    };
    const values = [
      coherenceForPair(windows.af7.slice(-sampleCount), windows.af8.slice(-sampleCount)),
      coherenceForPair(windows.tp9.slice(-sampleCount), windows.tp10.slice(-sampleCount)),
    ].filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  /**
   * Populate the console's shared metric contract from browser-computed
   * bands. These are deterministic band-power proxies, not BrainFlow's
   * pretrained classifiers, and are marked `browser_dsp` on the data point.
   */
  private updateBrowserDerivedMetrics() {
    const ratios = this.latestServerRatios;
    const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
    const mapRatioToAxis = (value: number) => value > 0 && Number.isFinite(value)
      ? clamp(Math.tanh(Math.log2(value) / 2.5), -1, 1)
      : 0;
    const valence = mapRatioToAxis(ratios.valence);
    const arousal = mapRatioToAxis(ratios.arousal);
    const confidenceFactor = this.serverFitState?.ready ? 1 : this.serverFitState?.state === 'good' ? 0.75 : 0.45;
    const confidence = clamp(Math.hypot(valence, arousal) * confidenceFactor, 0, 1);
    const mindfulness = clamp(50 + 25 * valence - 20 * arousal, 0, 100);
    const restfulness = clamp(50 + 35 * valence - 30 * arousal, 0, 100);
    const emotionLabel = Math.hypot(valence, arousal) < 0.18
      ? 'Neutral'
      : arousal > 0.35 && valence >= 0 ? 'Excited'
      : arousal > 0.35 ? 'Tense'
      : valence > 0.25 ? 'Relaxed'
      : valence < -0.25 ? 'Bored'
      : 'Neutral';

    this.latestBrainFlowScores = {
      mindfulnessScore: Math.round(mindfulness),
      restfulnessScore: Math.round(restfulness),
      valence,
      arousal,
      emotionLabel,
      method: 'browser_dsp',
    };
    this.latestRawMetrics = {
      mindfulness: Math.round(mindfulness),
      restfulness: Math.round(restfulness),
      valence,
      arousal,
      confidence,
      ...(this.latestInterhemisphericCoherence === null ? {} : { ihc: this.latestInterhemisphericCoherence }),
      ...Object.fromEntries(Object.entries(ratios).map(([name, value]) => [`ratio:${name}`, value])),
    };
    this.latestBaselineRelativeMetrics = {};
  }

  private calculateBrowserFeedback(bands: BandPowers, thetaBeta: number) {
    let metric = thetaBeta;
    let inZone = false;
    let zoneScore = 0;
    switch (this.currentProtocol) {
      case 'theta-beta-ratio':
        inZone = metric <= this.targetThreshold;
        zoneScore = 1 - (metric - this.targetThreshold) / 1.5;
        break;
      case 'smr-enhancement':
        metric = bands.smr;
        inZone = metric >= this.targetThreshold;
        zoneScore = (metric - this.targetThreshold + 1.5) / 3;
        break;
      case 'alpha-enhancement':
      case 'individualized-upper-alpha':
        metric = bands.alpha;
        inZone = metric >= this.targetThreshold;
        zoneScore = (metric - this.targetThreshold + 2) / 4;
        break;
      case 'alpha-theta-crossover':
        metric = bands.theta / Math.max(1e-9, bands.alpha);
        inZone = metric >= this.targetThreshold;
        zoneScore = (metric - this.targetThreshold + 0.5) / 1.5;
        break;
      case 'beta-downtraining':
        metric = bands.beta;
        inZone = metric <= this.targetThreshold;
        zoneScore = 1 - (metric - this.targetThreshold) / 5;
        break;
    }
    return { ratio: thetaBeta, inZone, zoneScore: Math.max(0, Math.min(1, zoneScore)) };
  }

  /**
   * Send the latest sample window to brainflow_service for full fit assessment, quality scoring,
   * and band powers.
   * 
   * Samples are sent as row-major (time × channel) with only scalp electrodes.
   */
  private async dispatchServerAnalysis(now: number) {
    const tp9 = this.rawBuffers.tp9;
    const af7 = this.rawBuffers.af7;
    const af8 = this.rawBuffers.af8;
    const tp10 = this.rawBuffers.tp10;

    const minLen = Math.min(tp9.length, af7.length, af8.length, tp10.length);
    // Interhemispheric coherence is a cross-spectral estimate. It needs at
    // least two 1-second segments, so keep a two-second window rather than
    // sending the one-second window used by the other band metrics.
    if (minLen < 512 || !this.fitSessionId) return;

    const windowSize = Math.min(minLen, 512);

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

    try {
      const response = await brainflowService.analyzeFitWindow(
        this.fitSessionId,
        samples,
        256,
        this.currentProtocol,
        this.targetThreshold,
      );

      if (response) {
        // Update scores from server features
        if (response.features) {
          const f = response.features;
          this.latestBrainFlowScores = {
            mindfulnessScore: f.mindfulnessScore ?? null,
            restfulnessScore: f.restfulnessScore ?? null,
            valence: f.valence ?? null,
            arousal: f.arousal ?? null,
            emotionLabel: f.emotionLabel ?? null,
            method: 'brainflow_welch_psd',
          };
          this.latestInterhemisphericCoherence = f.interhemisphericCoherence ?? null;
          this.latestMetricCalibration = { status: f.calibrationStatus ?? 'off', progress: f.calibrationProgress ?? 0, required: f.calibrationRequired ?? 24 };
          this.latestRawMetrics = f.rawMetrics ?? {};
          this.latestBaselineRelativeMetrics = f.baselineRelativeMetrics ?? {};
          this.latestTrainingFeedback = { ratio: f.bandPowers?.ratios?.thetaBeta ?? null, inZone: f.inZone ?? null, zoneScore: f.zoneScore ?? null };

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
            this.latestServerBandAvailability = {
              delta: typeof abs.delta === 'number',
              theta: typeof abs.theta === 'number',
              alpha: typeof abs.alpha === 'number',
              smr: typeof abs.smr === 'number',
              beta: typeof abs.beta === 'number',
              gamma: typeof abs.gamma === 'number',
            };
            this.latestServerRatios = f.bandPowers.ratios ?? {};
          }
        }

        // Update channel quality from server fit assessment
        if (response.quality) {
          this.updateChannelQualityFromServer(response.quality);
        }

        if (response.training) {
          this.latestTrainingMetric = {
            score: response.training.score ?? null,
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
  private updateChannelQualityFromServer(quality: ServerFitState) {
    this.serverFitState = {
      state: quality.state ?? 'poor',
      ready: quality.ready ?? false,
      worn: quality.worn ?? false,
      blockers: quality.blockers || [],
      channels: quality.channels || [],
    };

    // Map server channel states to local MuseChannelQuality
    const channelMap: Record<string, keyof MuseChannelQuality> = {
      tp9: 'tp9',
      af7: 'af7',
      af8: 'af8',
      tp10: 'tp10',
    };

    if (quality.channels && Array.isArray(quality.channels)) {
      for (const ch of quality.channels) {
        const localKey = channelMap[ch.channel?.id?.toLowerCase()];
        if (localKey) {
          const serverState = (ch.state || 'poor').toLowerCase();
          if (serverState === 'good') {
            this.channelQuality[localKey] = 'good';
          } else if (serverState === 'adjusting') {
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
    let bandAvailability: Partial<Record<keyof BandPowers, boolean>> = {};
    let bandRatios = this.latestServerRatios;
    let trainingFeedback = this.latestTrainingFeedback;
    let brainFlowScores = this.latestBrainFlowScores;
    let trainingMetric = this.latestTrainingMetric;
    let rawSignal = 0;

    if (this.isHardwareConnected) {
      // Use server-provided band powers when available, otherwise zero
      if (this.latestServerBands) {
        bands = { ...this.latestServerBands };
        bandAvailability = { ...this.latestServerBandAvailability };
      } else {
        bands = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
      }
      const af7 = this.rawBuffers.af7;
      rawSignal = af7.length > 0 ? af7[af7.length - 1] : 0;
    } else if (this.isDemoMode) {
      // Fast Simulator Multi-State Neural Cycle (<10s loop) or Manual Override
      this.phaseAngle += dt * 2 * Math.PI;
      this.noiseSeed += dt * 0.5;
      this.demoTimeElapsed += dt;

      // Channel quality is optimal in simulator mode
      this.channelQuality = {
        tp9: 'good',
        af7: 'good',
        af8: 'good',
        tp10: 'good',
      };

      if (this.demoState === 'auto') {
        this.demoCycleTime = (this.demoCycleTime + dt) % 12.0;
        const cycle = this.demoCycleTime;

        let targetFocus = 70;
        let targetCalm = 70;

        if (cycle < 3.0) {
          // PHASE 1: High Focus & SMR Activation (0.0s - 3.0s)
          targetFocus = 92;
          targetCalm = 68;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Focus & SMR Peak (Active Attention)';
        } else if (cycle < 6.0) {
          // PHASE 2: Deep Calm & Alpha Burst (3.0s - 6.0s)
          targetFocus = 65;
          targetCalm = 95;
          this.eyeClosed = true;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Deep Calm & Alpha Burst (Meditation)';
        } else if (cycle < 9.0) {
          // PHASE 3: Cognitive Drift / Distraction (6.0s - 9.0s)
          targetFocus = 30;
          targetCalm = 35;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Cognitive Drift & Distraction';
        } else {
          // PHASE 4: Operant Recovery & Flow Mastery (9.0s - 12.0s)
          targetFocus = 95;
          targetCalm = 90;
          this.eyeClosed = false;
          this.jawClenched = false;
          this.currentSimulatedStateName = 'Operant Recovery & Flow Mastery';
        }

        // Smooth physiological interpolation
        this.userFocus += (targetFocus - this.userFocus) * (dt * 1.8);
        this.userCalm += (targetCalm - this.userCalm) * (dt * 1.8);

      }

      const focusNorm = Math.max(0, Math.min(100, this.userFocus)) / 100;
      const calmNorm = Math.max(0, Math.min(100, this.userCalm)) / 100;
      const slowDrift = Math.sin(this.phaseAngle * 0.3 + this.noiseSeed) * 1.5;

      const delta = 12.0 + Math.sin(this.phaseAngle * 1.5) * 2.0 + (1 - focusNorm) * 4.0;
      const thetaBase = 5.0 + (1 - focusNorm) * 12.0 + Math.sin(this.phaseAngle * 4.2) * 1.5;
      const theta = Math.max(2.0, thetaBase);

      const alphaBase = 6.0 + calmNorm * 13.0 + (this.eyeClosed ? 6.0 : 0);
      const spindle = Math.pow(Math.sin(this.phaseAngle * 1.1), 4) * 2.5;
      const alpha = Math.max(3.0, alphaBase + spindle);

      const smrBase = 3.5 + focusNorm * 8.5 + calmNorm * 2.0 + Math.sin(this.phaseAngle * 13.5) * 1.2;
      const smr = Math.max(1.5, smrBase);

      const betaBase = 5.0 + focusNorm * 10.5 + (this.jawClenched ? 12.0 : 0) + Math.cos(this.phaseAngle * 20.0) * 1.5;
      const beta = Math.max(2.5, betaBase);
      const gamma = 3.0 + focusNorm * 4.0 + Math.sin(this.phaseAngle * 38.0) * 1.0;

      bands = {
        delta: Math.round(delta * 10) / 10,
        theta: Math.round(theta * 10) / 10,
        alpha: Math.round(alpha * 10) / 10,
        smr: Math.round(smr * 10) / 10,
        beta: Math.round(beta * 10) / 10,
        gamma: Math.round(gamma * 10) / 10,
      };
      bandAvailability = {
        delta: true, theta: true, alpha: true, smr: true, beta: true, gamma: true,
      };

      // Demo metrics are deliberately sample-local. Never write them into the
      // shared fields consumed by a connected headset, where they could remain
      // visible while the first real analysis window is being collected.
      const ratio = (numerator: number, denominator: number) => numerator / Math.max(1e-9, denominator);
      const thetaBeta = ratio(bands.theta, bands.beta);
      bandRatios = {
        thetaBeta,
        betaTheta: ratio(bands.beta, bands.theta),
        alphaTheta: ratio(bands.alpha, bands.theta),
        thetaAlpha: ratio(bands.theta, bands.alpha),
        smrTheta: ratio(bands.smr, bands.theta),
        thetaAlphaBeta: ratio(bands.theta, bands.alpha + bands.beta),
        alphaBeta: ratio(bands.alpha, bands.beta),
        betaAlpha: ratio(bands.beta, bands.alpha),
        arousal: ratio(bands.beta + bands.gamma, bands.alpha + bands.theta),
        valence: ratio(bands.alpha, bands.theta + bands.beta),
        betaOverAlphaTheta: ratio(bands.beta, bands.alpha + bands.theta),
      };
      trainingFeedback = this.calculateBrowserFeedback(bands, thetaBeta);
      brainFlowScores = {
        mindfulnessScore: Math.round((this.userFocus + this.userCalm) / 2),
        restfulnessScore: Math.round(this.userCalm),
        valence: (this.userCalm - 50) / 50,
        arousal: (this.userFocus - 50) / 50,
        emotionLabel: this.userCalm > 60 ? 'calm flow' : 'seeking focus',
        method: 'brainflow_welch_psd',
      };
      trainingMetric = { score: Math.round(Math.max(this.userFocus, this.userCalm)), baselineReady: true };

      rawSignal =
        slowDrift +
        Math.sin(this.phaseAngle * 2) * (delta * 0.4) +
        Math.sin(this.phaseAngle * 6) * (theta * 0.5) +
        Math.sin(this.phaseAngle * 10) * (alpha * 0.7) +
        Math.sin(this.phaseAngle * 14) * (smr * 0.6) +
        Math.sin(this.phaseAngle * 22) * (beta * 0.5) +
        (Math.random() - 0.5) * 1.2;
    } else {
      // DISCONNECTED & DEMO INACTIVE -> ZERO TELEMETRY (FLATLINE)
      bands = { delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0 };
      rawSignal = 0;
    }

    const thetaBetaRatioAvailable = trainingFeedback?.ratio != null;
    const thetaBetaRatio = trainingFeedback?.ratio ?? 0;
    const inZoneAvailable = trainingFeedback?.inZone != null;
    const inZone = trainingFeedback?.inZone ?? false;
    const zoneScore = trainingFeedback?.zoneScore ?? 0;
    
    /*switch (this.currentProtocol) {
      case 'theta-beta-ratio':
        inZoneAvailable = thetaBetaRatioAvailable;
        if (inZoneAvailable) {
          inZone = thetaBetaRatio <= this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, 1 - (thetaBetaRatio - this.targetThreshold) / 1.5));
        }
        break;
      case 'smr-enhancement':
        inZoneAvailable = Boolean(bandAvailability.smr);
        if (inZoneAvailable) {
          inZone = bands.smr >= this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, (bands.smr - this.targetThreshold + 1.5) / 3.0));
        }
        break;
      case 'alpha-enhancement':
        inZoneAvailable = Boolean(bandAvailability.alpha);
        if (inZoneAvailable) {
          inZone = bands.alpha >= this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, (bands.alpha - this.targetThreshold + 2.0) / 4.0));
        }
        break;
      case 'alpha-theta-crossover':
        inZoneAvailable = Boolean(bandAvailability.theta && bandAvailability.alpha);
        if (inZoneAvailable) {
          inZone = bands.theta >= bands.alpha * this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, (bands.theta / Math.max(0.1, bands.alpha) - this.targetThreshold + 0.5) / 1.5));
        }
        break;
      case 'beta-downtraining':
        inZoneAvailable = Boolean(bandAvailability.beta);
        if (inZoneAvailable) {
          inZone = bands.beta <= this.targetThreshold;
          zoneScore = Math.max(0, Math.min(1, 1 - (bands.beta - this.targetThreshold) / 5.0));
        }
        break;
      case 'individualized-upper-alpha':
        if (this.individualBaselineModel) {
          const paf = this.individualBaselineModel.alphaPeakHz;
          inZoneAvailable = Boolean(bandAvailability.alpha);
          if (inZoneAvailable) {
            inZone = bands.alpha >= (paf + 1.0);
            zoneScore = Math.max(0, Math.min(1, (bands.alpha - paf + 1.0) / 4.0));
          }
        } else {
          inZoneAvailable = Boolean(bandAvailability.alpha);
          if (inZoneAvailable) {
            inZone = bands.alpha >= this.targetThreshold;
            zoneScore = Math.max(0, Math.min(1, (bands.alpha - this.targetThreshold + 2.0) / 4.0));
          }
        }
        break;
    }*/

    // This value comes from the server's cross-spectral AF7↔AF8 / TP9↔TP10
    // calculation. Do not replace unavailable coherence with a band-power proxy.
    const interhemisphericCoherence = this.latestInterhemisphericCoherence;
    const coherenceAvailable = interhemisphericCoherence !== null;
    const coherence = coherenceAvailable
      ? Math.round(interhemisphericCoherence * 100)
      : null;

    // Signal quality derived from server fit state or demo mode
    const qualities = Object.values(this.channelQuality);
    let overallQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected' = 'excellent';
    if (!this.isHardwareConnected && !this.isDemoMode) {
      overallQuality = 'disconnected';
    } else if (!this.isHardwareConnected && this.isDemoMode) {
      overallQuality = 'good';
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
      bandAvailability,
      bandRatios: { ...bandRatios },
      calibrationStatus: this.latestMetricCalibration.status,
      calibrationProgress: this.latestMetricCalibration.progress,
      calibrationRequired: this.latestMetricCalibration.required,
      rawMetrics: this.latestRawMetrics,
      baselineRelativeMetrics: this.latestBaselineRelativeMetrics,
      thetaBetaRatio,
      thetaBetaRatioAvailable,
      coherence,
      coherenceAvailable,
      inZone,
      inZoneAvailable,
      zoneScore,
      signalQuality: overallQuality,
      channelQuality: this.channelQuality,
      batteryLevel: this.isDemoMode && !this.isHardwareConnected
        ? 92
        : this.batteryLevel ?? undefined,
      artifacts: {
        blink: this.isHardwareConnected ? (this.rawBuffers.af7.slice(-10).some(v => Math.abs(v) > 120)) : (Math.random() < 0.01),
        clench: this.isHardwareConnected
          ? this.rawBuffers.tp9.slice(-10).some(v => Math.abs(v) > 200)
          : this.jawClenched,
      },
      brainflowScores: brainFlowScores || undefined,
      trainingMetric: trainingMetric || undefined,
      isCalibrating: this.isCalibrating,
    };
  }
}

export const eegEngine = new EEGEngine();
