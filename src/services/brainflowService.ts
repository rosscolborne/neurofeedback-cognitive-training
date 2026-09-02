/**
 * BrainFlow Service Client — v0.5.0
 * Connects to the configured FastAPI brainflow_service. Local development
 * defaults to http://127.0.0.1:8000; deployed builds must set
 * VITE_BRAINFLOW_SERVICE_URL to the hosted service (for example, Render).
 *
 * Primary flow for Web Bluetooth front-ends:
 *   1. POST /headset-fit/sessions → fitSessionId
 *   2. POST /headset-fit/sessions/{id}/analyze-window (per-window scoring + fit)
 *   3. DELETE /headset-fit/sessions/{id} on disconnect
 *
 * All scoring (mindfulness, restfulness, focus, relax, valence/arousal,
 * headset fit) runs server-side through the same analyze_window()
 * pipeline that BrainFlow-direct sessions use — smoothing can't drift.
 */

import { ServerFitState, TrainingMetricSample } from '../types';

// ─── Response Interfaces ────────────────────────────────────────────────────

export interface BrainFlowBandPowers {
  absolute: {
    delta?: number;
    theta?: number;
    alpha?: number;
    smr?: number;
    beta?: number;
    gamma?: number;
  };
  relative: Record<string, number>;
  ratios: Record<string, number>;
  windowSeconds: number;
  method: 'brainflow_welch_psd';
}

export interface BrainFlowFeatures {
  bandPowers?: BrainFlowBandPowers;
  brainflowConcentration?: number | null;
  brainflowRestfulness?: number | null;
  mindfulnessScore?: number | null;
  restfulnessScore?: number | null;
  valence?: number | null;
  arousal?: number | null;
  interhemisphericCoherence?: number | null;
  primaryMetricName?: string | null;
  primaryMetricValue?: number | null;
  inZone?: boolean | null;
  zoneScore?: number | null;
  stateLabel?: string | null;
  emotionLabel?: string | null;
  calibrationStatus?: 'off' | 'collecting' | 'active';
  calibrationProgress?: number;
  calibrationRequired?: number;
  rawMetrics?: Record<string, number>;
  baselineRelativeMetrics?: Record<string, number>;
}

export interface FitWindowResponse {
  features?: BrainFlowFeatures | null;
  quality?: ServerFitState | null;
  training?: TrainingMetricSample | null;
}

export interface FitAssessResponse {
  state: string;
  ready: boolean;
  worn: boolean;
  blockers: string[];
  channels: Array<{ id: string; state: string; rms?: number }>;
}

export interface BrainFlowDeviceItem {
  id: string;
  label: string;
  mode: string;
  boardId: string;
}

// Only scalp electrodes — never AUX channels (per Ross's guidance)
const SCALP_CHANNEL_IDS = ['TP9', 'AF7', 'AF8', 'TP10'];

// ─── Service Class ──────────────────────────────────────────────────────────

class BrainFlowService {
  private baseUrl: string;
  private isOnline = false;
  private lastHealthCheck = 0;
  private activeEventSource: EventSource | null = null;

  constructor() {
    const configuredUrl = typeof import.meta !== 'undefined'
      ? import.meta.env?.VITE_BRAINFLOW_SERVICE_URL
      : undefined;
    // Loopback is a convenient development default, but it must never be
    // baked into a deployed build: a remote page would then silently depend
    // on a service running on the visitor's own computer.
    this.baseUrl = configuredUrl || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * A production bundle has no implicit backend URL. This prevents a deployed
   * app from accidentally treating its own Vercel origin as the EEG service.
   */
  public hasConfiguredService(): boolean {
    return this.baseUrl.length > 0;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public isServiceOnline(): boolean {
    return this.isOnline;
  }

  public async startMetricCalibration(sessionId: string, fitSession = false, metrics?: string[]): Promise<void> {
    const base = fitSession ? `/headset-fit/sessions/${sessionId}` : `/sessions/${sessionId}`;
    const response = await fetch(`${this.baseUrl}${base}/metrics/calibration`, metrics === undefined ? { method: 'POST' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metrics }),
    });
    if (!response.ok) throw new Error('Unable to start metric calibration.');
  }

  public async resetMetricCalibration(sessionId: string, fitSession = false): Promise<void> {
    const base = fitSession ? `/headset-fit/sessions/${sessionId}` : `/sessions/${sessionId}`;
    const response = await fetch(`${this.baseUrl}${base}/metrics/calibration`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to reset metric calibration.');
  }

  /**
   * Healthcheck against local BrainFlow service
   */
  public async checkHealth(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastHealthCheck < 2000 && this.isOnline) {
      return this.isOnline;
    }
    this.lastHealthCheck = now;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      this.isOnline = res.ok;
      return this.isOnline;
    } catch {
      this.isOnline = false;
      return false;
    }
  }

  /**
   * List available BrainFlow device configurations
   */
  public async getDevices(): Promise<BrainFlowDeviceItem[]> {
    try {
      const res = await fetch(`${this.baseUrl}/devices`);
      if (!res.ok) throw new Error(`Failed to fetch devices: ${res.statusText}`);
      return await res.json();
    } catch (err) {
      console.warn('BrainFlow getDevices failed:', err);
      return [];
    }
  }

  // ─── Headset Fit Sessions (Bluetooth front-end path) ────────────────────

  /**
   * Start a stateful analysis session for Bluetooth-connected Muse.
   * Returns a fitSessionId used for all subsequent calls.
   */
  public async startFitSession(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/headset-fit/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to start fit session: ${errText}`);
    }

    const data = await res.json();
    this.isOnline = true;
    return data.fitSessionId;
  }

  /**
   * Send a raw EEG window to the server for full scoring and fit assessment.
   * This is the primary per-window endpoint — returns smoothed metrics and channel quality.
   *
   * Only sends scalp electrode data (TP9, AF7, AF8, TP10) — AUX channels excluded.
   *
   * @param fitSessionId  Session ID from startFitSession()
   * @param samples       2D array: outer = time samples, inner = channels (TP9, AF7, AF8, TP10)
   * @param sampleRateHz  Sampling rate (256 for Muse)
   */
  public async analyzeFitWindow(
    fitSessionId: string,
    samples: number[][],
    sampleRateHz = 256,
    protocol = 'theta-beta-ratio',
    threshold = 1.85,
  ): Promise<FitWindowResponse | null> {
    if (!samples || samples.length === 0) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(
        `${this.baseUrl}/headset-fit/sessions/${fitSessionId}/analyze-window`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sampleRateHz,
            samples,
            channelIds: SCALP_CHANNEL_IDS,
            protocol,
            threshold,
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      if (!res.ok) return null;

      const data: FitWindowResponse = await res.json();
      this.isOnline = true;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Fit-only assessment (no smoothing) — used during the headset fit modal
   * before the session starts.
   */
  public async assessFitOnly(
    fitSessionId: string,
    samples: number[][],
  ): Promise<FitAssessResponse | null> {
    if (!samples || samples.length === 0) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(
        `${this.baseUrl}/headset-fit/sessions/${fitSessionId}/assess`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            samples,
            channelIds: SCALP_CHANNEL_IDS,
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      if (!res.ok) return null;

      const data: FitAssessResponse = await res.json();
      this.isOnline = true;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Stop and release a headset fit session. Idle sessions auto-evict after ~2 min.
   */
  public async stopFitSession(fitSessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/headset-fit/sessions/${fitSessionId}`, {
        method: 'DELETE',
      });
    } catch {
      // Best-effort cleanup
    }
  }

  // ─── BrainFlow-Direct Sessions (native board path) ──────────────────────

  /**
   * Start a native BrainFlow board session (e.g. Muse Athena or Synthetic Board)
   */
  public async startSession(deviceId: string, macAddress?: string, serialNumber?: string, protocol = 'theta-beta-ratio', threshold = 1.85): Promise<{ sessionId: string; deviceInfo: any }> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        macAddress: macAddress || null,
        serialNumber: serialNumber || null,
        protocol, threshold,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`BrainFlow session start failed: ${errText}`);
    }

    return await res.json();
  }

  public async updateSessionProtocol(sessionId: string, protocol: string, threshold: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/sessions/${sessionId}/protocol`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol, threshold }),
      });
    } catch {
      // The local service may be offline; the browser feedback path still
      // applies the new settings immediately.
    }
  }

  /**
   * Open SSE stream from an active BrainFlow session
   */
  public streamSession(
    sessionId: string,
    onSignalFrame: (frame: any) => void,
    onError?: (err: any) => void,
    onDisconnect?: () => void
  ): () => void {
    if (this.activeEventSource) {
      this.activeEventSource.close();
    }

    const es = new EventSource(`${this.baseUrl}/sessions/${sessionId}/stream`);
    this.activeEventSource = es;

    es.addEventListener('signalFrame', (e: MessageEvent) => {
      try {
        const frame = JSON.parse(e.data);
        onSignalFrame(frame);
      } catch (err) {
        console.error('Failed to parse SSE signalFrame:', err);
      }
    });

    es.addEventListener('error', (e) => {
      console.warn('BrainFlow SSE stream error:', e);
      onError?.(e);
    });

    es.addEventListener('state', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.state === 'disconnected') {
          onDisconnect?.();
        }
      } catch {}
    });

    return () => {
      es.close();
      if (this.activeEventSource === es) {
        this.activeEventSource = null;
      }
    };
  }

  /**
   * Stop an active BrainFlow session
   */
  public async stopSession(sessionId: string): Promise<void> {
    if (this.activeEventSource) {
      this.activeEventSource.close();
      this.activeEventSource = null;
    }
    try {
      await fetch(`${this.baseUrl}/sessions/${sessionId}`, { method: 'DELETE' });
    } catch {}
  }
}

export const brainflowService = new BrainFlowService();
