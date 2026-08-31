import type { DeviceInfo, EegProviderEvents } from "../domain/eeg";

export interface EegProviderDescriptor {
  id: string;
  label: string;
  description: string;
}

export interface EegProvider {
  readonly descriptor: EegProviderDescriptor;
  connectAndStart(): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  getDeviceInfo(): DeviceInfo | null;
  // Only implemented by providers backed by `brainflow_service` (BrainFlow
  // and Bluetooth) -- that's where valence/arousal calibration actually
  // runs (see `affective_state.AffectiveStateProvider`). Providers without
  // a server session (Mock, replay) omit these; callers fall back to a
  // client-only calibration when they're absent.
  startAffectiveCalibration?(): Promise<void>;
  resetAffectiveCalibration?(): Promise<void>;
}

export type EegProviderFactory = (events: EegProviderEvents) => EegProvider;
