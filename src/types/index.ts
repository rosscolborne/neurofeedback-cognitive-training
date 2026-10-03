export interface MuseChannelQuality {
  tp9: 'good' | 'fair' | 'poor';
  af7: 'good' | 'fair' | 'poor';
  af8: 'good' | 'fair' | 'poor';
  tp10: 'good' | 'fair' | 'poor';
}

/**
 * The consumer EEG metrics: BrainFlow's mindfulness and restfulness
 * classifiers, smoothed by the analysis service (0–100), or simulated in Demo
 * Mode. Nothing else derived from EEG reaches the app.
 */
export interface BrainFlowScores {
  mindfulnessScore: number | null;
  restfulnessScore: number | null;
  method: 'brainflow' | 'demo';
}

export type ServerFitChannelState = 'good' | 'adjusting' | 'poor';

export interface ServerFitChannelIdentity {
  id: string;
  label: string;
}

export interface ServerFitChannel {
  // `brainflow_service` serializes the electrode as a nested SignalChannel.
  channel: ServerFitChannelIdentity;
  state: ServerFitChannelState;
  rmsUv?: number;
}

export interface ServerFitState {
  state: 'adjusting' | 'good' | 'poor' | 'ready';
  ready: boolean;
  worn: boolean;
  blockers: string[];
  channels: ServerFitChannel[];
}

/** One published EEG frame: headset fit and the consumer metrics, nothing more. */
export interface EEGDataPoint {
  timestamp: number;
  signalQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
  channelQuality: MuseChannelQuality;
  batteryLevel?: number;
  brainflowScores?: BrainFlowScores;
}
