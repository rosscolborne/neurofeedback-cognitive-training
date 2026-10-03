import { BrainFlowScores, EEGDataPoint, MuseChannelQuality, ServerFitState } from '../types';
import { brainflowService } from './brainflowService';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { AthenaWasmDecoder, BleTransport } from '@elata-biosciences/eeg-web-ble';
import { initEegWasm, type HeadbandFrameV1 } from '@elata-biosciences/eeg-web';
import eegWasmUrl from '@elata-biosciences/eeg-web/wasm/eeg_wasm_bg.wasm?url';

// The consumer EEG pipeline: headset connection, buffering, headset fit, and
// BrainFlow's mindfulness and restfulness from the hosted analysis service.
// Nothing else is derived from EEG here. Without a configured service the
// headset still connects and its fit is checked in the browser, but no
// metrics are produced: they are never estimated outside BrainFlow.

// Muse's EEG data service contains the 273e0001–273e0006 control and signal
// characteristics. It is also the service advertised during device discovery.
const MUSE_EEG_SERVICE_UUID = '0000fe8d-0000-1000-8000-00805f9b34fb';

type DemoPreset = 'focus' | 'calm' | 'drift' | 'recovery';

/** Demo Mode's simulated mind-state presets: the centres its scores drift around. */
const DEMO_PRESETS: Record<DemoPreset, { focus: number; calm: number }> = {
  focus: { focus: 92, calm: 65 },
  calm: { focus: 70, calm: 96 },
  drift: { focus: 25, calm: 30 },
  recovery: { focus: 96, calm: 88 },
};

/** The auto cycle visits each preset for three seconds. */
const DEMO_AUTO_CYCLE: DemoPreset[] = ['focus', 'calm', 'drift', 'recovery'];
const DEMO_AUTO_PHASE_SECONDS = 3;

export class EEGEngine {
  private isRunning = false;
  private timer: number | null = null;
  private subscribers: Array<(data: EEGDataPoint) => void> = [];

  // Demo Mode drivers (0–100), used only while Demo Mode is active.
  public userFocus = 65;
  public userCalm = 60;

  // Real Muse Bluetooth Hardware State
  public isHardwareConnected = false;

  public deviceName: string | null = null;
  public batteryLevel: number | null = null;
  public packetsReceivedCount = 0;
  private sourceFrameSequence = 0;
  private lastSourceFrameAtMs = 0;

  // Real-time raw signal storage buffers (256 samples = 1 sec at 256Hz)
  public rawBuffers: Record<keyof MuseChannelQuality, number[]> = {
    tp9: [],
    af7: [],
    af8: [],
    tp10: [],
  };
  private maxBufferSize = 1536; // 6 seconds of buffer at 256 Hz

  // Fit state, from the hosted service or (without one) the browser fit check
  public serverFitState: ServerFitState | null = null;
  private fitSessionId: string | null = null;
  private bluetoothConnectionGeneration = 0;
  private isStartingFitSession = false;
  private hostedAnalysisFailures = 0;
  private lastAnalysisDiagnosticAt = 0;

  // Channel quality — driven by the fit assessment
  public channelQuality: MuseChannelQuality = {
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  };

  // Latest hosted BrainFlow scores
  private latestBrainFlowScores: BrainFlowScores | null = null;
  private lastAnalysisTime = 0;
  private isAnalyzing = false;
  private localFitStableSince: number | null = null;

  /** The connected headset on native builds (the browser transport owns its own connection). */
  private nativeDeviceId: string | null = null;
  private webBluetoothTransport: BleTransport | null = null;

  // Demo Mode State
  public isDemoMode = false;
  public demoTimeElapsed = 0;
  public demoCycleTime = 0;

  /** Monotonic evidence from the acquisition transport, never from the UI publish timer. */
  public getHardwareSourceState(): { sequence: number; lastFrameAtMs: number } {
    return { sequence: this.sourceFrameSequence, lastFrameAtMs: this.lastSourceFrameAtMs };
  }

  private markSourceFrameReceived(): void {
    this.sourceFrameSequence += 1;
    this.lastSourceFrameAtMs = Date.now();
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

      // Bluetooth acquisition stays in the app; BrainFlow is the only metric
      // source. With a hosted session, raw windows go to it for fit and
      // scores. Without one, only the fit is checked here.
      if (this.isHardwareConnected && !this.isAnalyzing && now - this.lastAnalysisTime > 150) {
        if (this.fitSessionId) {
          this.dispatchServerAnalysis(now);
        } else {
          this.runBrowserFitCheck(now);
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
   * Capacitor BLE bridge on native builds). The browser owns this connection;
   * the hosted BrainFlow service is required for all metrics.
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
        if (brainflowService.hasConfiguredService()) {
          try {
            await this.startHostedBluetoothAnalysis();
          } catch (e) {
            console.info('[EEG] Hosted analysis unavailable; checking fit in the browser only:', e);
          }
        }
        return { success: true, deviceName: this.deviceName || undefined };
      }

      // Native builds: the Capacitor BLE bridge.
      await BleClient.initialize({ androidNeverForLocation: true });
      const bleDevice = await BleClient.requestDevice({
        services: [MUSE_EEG_SERVICE_UUID],
      });
      const device = { id: bleDevice.deviceId, name: bleDevice.name };

      await BleClient.connect(device.id, () => {
        this.disconnectHardware();
      });

      const athenaEegChar = '273e0013-4c4d-454d-96be-f03bac821358';
      const athenaOtherChar = '273e0014-4c4d-454d-96be-f03bac821358';
      let isAthenaProfile = false;

      // This is intentionally logged before subscribing so an iOS device
      // whose Muse firmware uses a different profile can be identified from
      // the Xcode console without guessing UUIDs.
      try {
        const services = await BleClient.getServices(device.id);
        console.info('[EEG BLE] discovered GATT profile', services.map((service) => ({
          service: service.uuid,
          characteristics: service.characteristics.map((characteristic) => ({
            uuid: characteristic.uuid,
            properties: characteristic.properties,
          })),
        })));
        isAthenaProfile = services.some((service) => {
          const characteristicUuids = service.characteristics.map((characteristic) => characteristic.uuid.toLowerCase());
          return characteristicUuids.includes(athenaEegChar) && characteristicUuids.includes(athenaOtherChar);
        });
      } catch (error) {
        console.error('[EEG BLE] unable to read discovered GATT profile', error);
      }

      this.isHardwareConnected = true;
      this.isDemoMode = false;
      this.deviceName = device.name || 'Muse Headband';
      this.nativeDeviceId = device.id;

      const eegService = MUSE_EEG_SERVICE_UUID;
      if (isAthenaProfile) {
        // Muse S Athena multiplexes all eight EEG channels through 273e0013.
        // Decode those packets with the same WASM decoder used in the working
        // browser transport, then retain only the four scalp electrodes.
        await initEegWasm(eegWasmUrl);
        const athenaDecoder = new AthenaWasmDecoder();
        athenaDecoder.set_use_device_timestamps(true);
        athenaDecoder.set_clock_kind('windowed');
        athenaDecoder.set_reorder_window_ms(0);

        const ingestAthenaPacket = (value: DataView) => {
          this.packetsReceivedCount++;
          if (this.packetsReceivedCount <= 3) {
            console.info('[EEG BLE] Athena packet received', {
              packet: this.packetsReceivedCount,
              bytes: value.byteLength,
            });
          }
          try {
            const output = athenaDecoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            const channels = output.eeg_channel_count;
            const samples = output.eeg_samples;
            if (samples.length > 0) this.markSourceFrameReceived();
            for (let index = 0; index + channels <= samples.length && channels >= 4; index += channels) {
              this.rawBuffers.tp9.push(samples[index]);
              this.rawBuffers.af7.push(samples[index + 1]);
              this.rawBuffers.af8.push(samples[index + 2]);
              this.rawBuffers.tp10.push(samples[index + 3]);
            }
            for (const channel of Object.keys(this.rawBuffers) as Array<keyof MuseChannelQuality>) {
              if (this.rawBuffers[channel].length > this.maxBufferSize) {
                this.rawBuffers[channel] = this.rawBuffers[channel].slice(-this.maxBufferSize);
              }
            }
            output.free();
          } catch (error) {
            console.error('[EEG BLE] Athena packet decode failed', error);
          }
          if (this.packetsReceivedCount % 100 === 0) {
            console.info('[EEG BLE]', {
              protocol: 'athena',
              packets: this.packetsReceivedCount,
              tp9: this.rawBuffers.tp9.length,
              af7: this.rawBuffers.af7.length,
              af8: this.rawBuffers.af8.length,
              tp10: this.rawBuffers.tp10.length,
            });
          }
        };

        // Athena's control endpoint is notify-capable. The reference Muse
        // transport enables it before streaming; without that subscription
        // some firmware revisions accept commands but do not begin sending.
        await BleClient.startNotifications(
          device.id,
          eegService,
          '273e0001-4c4d-454d-96be-f03bac821358',
          () => console.info('[EEG BLE] Athena control notification received'),
        );
        await BleClient.startNotifications(device.id, eegService, athenaEegChar, ingestAthenaPacket);
        await BleClient.startNotifications(device.id, eegService, athenaOtherChar, ingestAthenaPacket);

        const sendAthenaCommand = async (command: string) => {
          const bytes = new Uint8Array(command.length + 2);
          bytes[0] = command.length + 1;
          for (let index = 0; index < command.length; index++) bytes[index + 1] = command.charCodeAt(index);
          bytes[bytes.length - 1] = 0x0a;
          await BleClient.writeWithoutResponse(
            device.id,
            eegService,
            '273e0001-4c4d-454d-96be-f03bac821358',
            new DataView(bytes.buffer),
          );
        };
        const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
        for (const [command, delay] of [
          ['v6', 200], ['s', 200], ['h', 200], ['p1041', 200], ['s', 200], ['dc001', 50], ['dc001', 100], ['s', 0],
        ] as const) {
          await sendAthenaCommand(command);
          if (delay > 0) await pause(delay);
        }

        console.info('[EEG BLE] Athena streaming started');
        if (brainflowService.hasConfiguredService()) {
          try {
            await this.startHostedBluetoothAnalysis();
          } catch (e) {
            console.info('[EEG] Hosted analysis unavailable; checking fit in the browser only:', e);
          }
        }
        return { success: true, deviceName: this.deviceName || undefined };
      }

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
              if (this.packetsReceivedCount % 100 === 0) {
                console.info('[EEG BLE]', {
                  packets: this.packetsReceivedCount,
                  tp9: this.rawBuffers.tp9.length,
                  af7: this.rawBuffers.af7.length,
                  af8: this.rawBuffers.af8.length,
                  tp10: this.rawBuffers.tp10.length,
                });
              }
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

      if (brainflowService.hasConfiguredService()) {
        try {
          await this.startHostedBluetoothAnalysis();
        } catch (e) {
          console.info('[EEG] Hosted analysis unavailable; checking fit in the browser only:', e);
        }
      }
      return { success: true, deviceName: this.deviceName || undefined };
    } catch (err: any) {
      this.disconnectHardware();
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
      sourceName: 'NFCT Muse Athena',
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

  /**
   * Start the remote analysis session after, never before, the user's browser
   * has connected to the headband. A session is required: metrics must never
   * fall back to estimates produced outside BrainFlow.
   */
  private async startHostedBluetoothAnalysis(): Promise<void> {
    if (!brainflowService.hasConfiguredService()) {
      throw new Error('A hosted BrainFlow service URL is required before connecting a headset.');
    }
    if (this.fitSessionId) return;
    if (this.isStartingFitSession) {
      throw new Error('Hosted BrainFlow analysis is already starting.');
    }

    const connectionGeneration = ++this.bluetoothConnectionGeneration;
    this.isStartingFitSession = true;
    this.hostedAnalysisFailures = 0;
    try {
      const fitSessionId = await brainflowService.startFitSession();
      // The user may have disconnected or begun a new connection while the
      // hosted service was waking up. Do not attach that stale session.
      if (!this.isHardwareConnected || connectionGeneration !== this.bluetoothConnectionGeneration) {
        void brainflowService.stopFitSession(fitSessionId);
        throw new Error('Headset connection changed before hosted BrainFlow analysis started.');
      }
      this.fitSessionId = fitSessionId;
    } finally {
      if (connectionGeneration === this.bluetoothConnectionGeneration) {
        this.isStartingFitSession = false;
      }
    }
  }

  private ingestDecodedMuseFrame(frame: HeadbandFrameV1) {
    const eeg = frame.eegRaw ?? frame.eeg;
    let ingestedUsableSamples = false;
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
      ingestedUsableSamples = true;
      if (buffer.length > this.maxBufferSize) {
        this.rawBuffers[channel] = buffer.slice(buffer.length - this.maxBufferSize);
      }
    }
    if (ingestedUsableSamples) this.markSourceFrameReceived();
  }

  public disconnectHardware() {
    // Invalidates an in-flight hosted-session request as well as active ones.
    this.bluetoothConnectionGeneration++;
    this.isStartingFitSession = false;
    this.hostedAnalysisFailures = 0;
    if (this.webBluetoothTransport) {
      const transport = this.webBluetoothTransport;
      this.webBluetoothTransport = null;
      transport.disconnect().catch(() => {});
    }
    if (this.nativeDeviceId) {
      BleClient.disconnect(this.nativeDeviceId).catch(() => {});
    }
    // Release server-side fit session
    if (this.fitSessionId) {
      brainflowService.stopFitSession(this.fitSessionId);
      this.fitSessionId = null;
    }

    this.isHardwareConnected = false;
    this.deviceName = null;
    this.nativeDeviceId = null;
    this.latestBrainFlowScores = null;
    this.lastSourceFrameAtMs = 0;
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
    this.markSourceFrameReceived();

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
   * The browser fit check for a headset connected without a hosted analysis
   * service. It mirrors the Bluetooth-specific fit thresholds in
   * brainflow_service so pairing and fit work from a static deployment; it
   * produces no metrics.
   */
  private runBrowserFitCheck(now: number) {
    const channels: Array<keyof MuseChannelQuality> = ['tp9', 'af7', 'af8', 'tp10'];
    const minLen = Math.min(...channels.map(channel => this.rawBuffers[channel].length));
    if (minLen < 64) return;

    this.isAnalyzing = true;
    this.lastAnalysisTime = now;

    try {
      const windowSize = Math.min(minLen, 512);
      const windows = Object.fromEntries(
        channels.map(channel => [channel, this.rawBuffers[channel].slice(-windowSize)]),
      ) as Record<keyof MuseChannelQuality, number[]>;

      this.updateBrowserFit(windows, now);
    } finally {
      this.isAnalyzing = false;
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

  /**
   * Send the latest sample window to brainflow_service for the fit assessment
   * and the smoothed mindfulness and restfulness scores.
   *
   * Samples are sent as row-major (time × channel) with only scalp electrodes.
   */
  private async dispatchServerAnalysis(now: number) {
    const tp9 = this.rawBuffers.tp9;
    const af7 = this.rawBuffers.af7;
    const af8 = this.rawBuffers.af8;
    const tp10 = this.rawBuffers.tp10;

    const minLen = Math.min(tp9.length, af7.length, af8.length, tp10.length);
    const diagnosticNow = Date.now();
    if (diagnosticNow - this.lastAnalysisDiagnosticAt >= 1000) {
      this.lastAnalysisDiagnosticAt = diagnosticNow;
      console.info('[EEG analysis]', {
        minLen,
        fitSessionId: this.fitSessionId,
        buffers: {
          tp9: tp9.length,
          af7: af7.length,
          af8: af8.length,
          tp10: tp10.length,
        },
      });
    }
    // The service analyzes two-second windows.
    if (minLen < 512 || !this.fitSessionId) return;

    const windowSize = Math.min(minLen, 512);

    const tp9Slice = tp9.slice(-windowSize);
    const af7Slice = af7.slice(-windowSize);
    const af8Slice = af8.slice(-windowSize);
    const tp10Slice = tp10.slice(-windowSize);

    const cleanChannel = (slice: number[]) => {
      let sum = 0;
      for (let i = 0; i < slice.length; i++) sum += slice[i];
      const mean = sum / slice.length;
      const isRawAdc = Math.abs(mean) > 150;
      const scale = isRawAdc ? 0.48828 : 1.0;
      return slice.map((v) => (v - mean) * scale);
    };

    const cleanTp9 = cleanChannel(tp9Slice);
    const cleanAf7 = cleanChannel(af7Slice);
    const cleanAf8 = cleanChannel(af8Slice);
    const cleanTp10 = cleanChannel(tp10Slice);

    // Build row-major format: one inner array per time sample, 4 columns (TP9, AF7, AF8, TP10)
    const samples: number[][] = [];
    for (let i = 0; i < windowSize; i++) {
      samples.push([
        cleanTp9[i],
        cleanAf7[i],
        cleanAf8[i],
        cleanTp10[i],
      ]);
    }

    this.isAnalyzing = true;
    this.lastAnalysisTime = now;

    try {
      const response = await brainflowService.analyzeFitWindow(this.fitSessionId, samples, 256);

      if (response) {
        this.hostedAnalysisFailures = 0;
        if (response.features) {
          this.latestBrainFlowScores = {
            mindfulnessScore: response.features.mindfulnessScore ?? null,
            restfulnessScore: response.features.restfulnessScore ?? null,
            method: 'brainflow',
          };
        }

        // Update channel quality from server fit assessment
        if (response.quality) {
          this.updateChannelQualityFromServer(response.quality);
        }
      } else {
        this.handleHostedAnalysisFailure();
      }
    } catch {
      this.handleHostedAnalysisFailure();
    } finally {
      this.isAnalyzing = false;
    }
  }

  /** Stop presenting metrics as soon as hosted BrainFlow analysis is unavailable. */
  private handleHostedAnalysisFailure() {
    this.hostedAnalysisFailures++;
    this.latestBrainFlowScores = null;
    this.lastSourceFrameAtMs = 0;
    if (this.hostedAnalysisFailures < 3 || !this.fitSessionId) return;

    const unavailableSessionId = this.fitSessionId;
    this.fitSessionId = null;
    this.hostedAnalysisFailures = 0;
    void brainflowService.stopFitSession(unavailableSessionId);
    console.warn('Hosted BrainFlow analysis stopped responding; EEG metrics are unavailable.');
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
    let brainFlowScores = this.latestBrainFlowScores;

    if (this.isDemoMode && !this.isHardwareConnected) {
      this.demoTimeElapsed += dt;

      // Channel quality is optimal in simulator mode
      this.channelQuality = {
        tp9: 'good',
        af7: 'good',
        af8: 'good',
        tp10: 'good',
      };

      this.demoCycleTime = (this.demoCycleTime + dt) % (DEMO_AUTO_CYCLE.length * DEMO_AUTO_PHASE_SECONDS);
      const preset = DEMO_PRESETS[DEMO_AUTO_CYCLE[Math.floor(this.demoCycleTime / DEMO_AUTO_PHASE_SECONDS)]];
      // Smooth interpolation between presets
      this.userFocus += (preset.focus - this.userFocus) * (dt * 1.8);
      this.userCalm += (preset.calm - this.userCalm) * (dt * 1.8);

      // Presets are centres, not frozen readings. Demo scores are deliberately
      // sample-local: never written into the fields a connected headset uses,
      // where they could stay visible while its first real window is analyzed.
      const simulatedFocus = Math.max(0, Math.min(100, this.userFocus + 4 * Math.sin(this.demoTimeElapsed * 1.15)));
      const simulatedCalm = Math.max(0, Math.min(100, this.userCalm + 4 * Math.sin(this.demoTimeElapsed * 0.9 + Math.PI / 3)));
      brainFlowScores = {
        mindfulnessScore: Math.round((simulatedFocus + simulatedCalm) / 2),
        restfulnessScore: Math.round(simulatedCalm),
        method: 'demo',
      };
    } else if (!this.isHardwareConnected) {
      brainFlowScores = null;
    }

    // Signal quality derived from the fit state or demo mode
    const qualities = Object.values(this.channelQuality);
    let overallQuality: EEGDataPoint['signalQuality'] = 'excellent';
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
      signalQuality: overallQuality,
      channelQuality: this.channelQuality,
      batteryLevel: this.isDemoMode && !this.isHardwareConnected
        ? 92
        : this.batteryLevel ?? undefined,
      brainflowScores: brainFlowScores || undefined,
    };
  }
}

export const eegEngine = new EEGEngine();
