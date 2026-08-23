/**
 * BrainFlow Service Client
 * Connects to the local FastAPI BrainFlow acquisition & DSP microservice (http://127.0.0.1:8000)
 */

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
  ratios: {
    alphaTheta?: number;
    betaTheta?: number;
    thetaBeta?: number;
    betaOverAlphaTheta?: number;
  };
  windowSeconds: number;
  method: 'brainflow_welch_psd';
}

export interface BrainFlowFeatures {
  bandPowers?: BrainFlowBandPowers;
  brainflowConcentration?: number | null;
  brainflowRestfulness?: number | null;
  mindfulnessScore?: number | null;
  restfulnessScore?: number | null;
  focusScore?: number;
  relaxScore?: number;
}

export interface AnalyzeWindowResponse {
  features?: BrainFlowFeatures | null;
}

export interface BrainFlowDeviceItem {
  id: string;
  label: string;
  mode: string;
  boardId: string;
}

class BrainFlowService {
  private baseUrl: string;
  private isOnline = false;
  private lastHealthCheck = 0;
  private activeEventSource: EventSource | null = null;

  constructor() {
    this.baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BRAINFLOW_SERVICE_URL) || 'http://127.0.0.1:8000';
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public isServiceOnline(): boolean {
    return this.isOnline;
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

  /**
   * Send genuine raw EEG samples from Web Bluetooth or buffer to BrainFlow for
   * Welch PSD filtering and ML scoring (stateless single-window computation).
   * 
   * @param samples 2D array of EEG channels (e.g. 4 rows: [TP9, AF7, AF8, TP10])
   * @param sampleRateHz Sampling rate (e.g. 256 for Muse)
   */
  public async analyzeWindow(samples: number[][], sampleRateHz = 256): Promise<BrainFlowFeatures | null> {
    if (!samples || samples.length === 0 || samples[0].length === 0) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(`${this.baseUrl}/analyze-window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleRateHz,
          samples,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return null;
      }

      const data: AnalyzeWindowResponse = await res.json();
      this.isOnline = true;
      return data.features || null;
    } catch {
      return null;
    }
  }

  /**
   * Start a native BrainFlow board session (e.g. Muse Athena or Synthetic Board)
   */
  public async startSession(deviceId: string, macAddress?: string, serialNumber?: string): Promise<{ sessionId: string; deviceInfo: any }> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        macAddress: macAddress || null,
        serialNumber: serialNumber || null,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`BrainFlow session start failed: ${errText}`);
    }

    return await res.json();
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
