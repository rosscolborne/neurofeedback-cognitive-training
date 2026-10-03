/**
 * BrainFlow Service Client
 * Connects to the configured FastAPI brainflow_service. Local development
 * defaults to http://127.0.0.1:8000; deployed builds must set
 * VITE_BRAINFLOW_SERVICE_URL to the hosted service.
 *
 * The app uses one flow, for a headset connected over Bluetooth:
 *   1. POST /headset-fit/sessions → fitSessionId
 *   2. POST /headset-fit/sessions/{id}/analyze-window (per-window fit + scores)
 *   3. DELETE /headset-fit/sessions/{id} on disconnect
 *
 * Of the service's outputs the app reads only the headset fit and BrainFlow's
 * smoothed mindfulness and restfulness. It sends no protocol, threshold or
 * reward rule; whatever the service computes from its defaults is ignored.
 */

import { ServerFitState } from '../types';

// ─── Response Interfaces ────────────────────────────────────────────────────

/** The service's per-window features, narrowed to what the app reads. */
export interface BrainFlowFeatures {
  mindfulnessScore?: number | null;
  restfulnessScore?: number | null;
}

export interface FitWindowResponse {
  features?: BrainFlowFeatures | null;
  quality?: ServerFitState | null;
}

// Only scalp electrodes — never AUX channels
const SCALP_CHANNEL_IDS = ['TP9', 'AF7', 'AF8', 'TP10'];

// ─── Service Class ──────────────────────────────────────────────────────────

class BrainFlowService {
  private baseUrl: string;

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
   * app from accidentally treating its own origin as the EEG service.
   */
  public hasConfiguredService(): boolean {
    return this.baseUrl.length > 0;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  /**
   * Start a stateful analysis session for a Bluetooth-connected Muse.
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
    return data.fitSessionId;
  }

  /**
   * Send a raw EEG window to the server for scoring and fit assessment.
   * Returns the smoothed scores and channel quality.
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
  ): Promise<FitWindowResponse | null> {
    if (!samples || samples.length === 0) return null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      let res: Response;
      try {
        res = await fetch(
          `${this.baseUrl}/headset-fit/sessions/${fitSessionId}/analyze-window`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sampleRateHz,
              samples,
              channelIds: SCALP_CHANNEL_IDS,
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        console.error('[EEG analysis] API error', {
          status: res.status,
          statusText: res.statusText,
          body: await res.text(),
        });
        return null;
      }

      return await res.json() as FitWindowResponse;
    } catch (error) {
      console.error('[EEG analysis] request failed', error);
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
}

export const brainflowService = new BrainFlowService();
