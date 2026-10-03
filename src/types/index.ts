/**
 * Firestore timestamps are intentionally represented structurally here so the
 * domain layer can read persisted documents without depending on the Firebase
 * SDK. New writes should use a server timestamp; legacy ISO strings and epoch
 * milliseconds remain readable during migration.
 */
export interface FirestoreTimestampLike {
  seconds: number;
  nanoseconds?: number;
  toDate?: () => Date;
}

export type PersistedTimestamp = string | number | Date | FirestoreTimestampLike;

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

export interface QEEGBrainMap {
  id: string;
  uploadDate: string;
  fileName: string;
  recordingDate: string;
  deviceSource: string; // e.g. 'Deymed 19-Ch TruScan' or 'BrainMaster Discovery'
  technicianNotes: string;
  zScores: {
    frontalTheta: number; // Z-score
    centralBeta: number;
    occipitalAlpha: number;
    temporalDelta: number;
    sensorimotorSMR: number;
  };
  dominantAlphaPeakHz: number;
  /** Authenticated clinician who persisted this record. */
  createdBy?: string;
  /** Server-owned creation time for canonical records. */
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
  schemaVersion?: number;
  topographyColorMap?: string;
  rawTelemetrySnippet?: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  condition?: 'ADHD (Inattentive)' | 'ADHD (Combined)' | 'Generalized Anxiety' | 'Stress / Insomnia' | 'Peak Performance';
  status: 'active' | 'paused' | 'completed';
  brainMaps: QEEGBrainMap[];
  linkedClinicianCode?: string;
  clinicianId?: string;
  acceptedInvitationId?: string;
  /** Set once account deletion starts. Retained profiles can never be linked again. */
  accountDeletionStartedAt?: PersistedTimestamp;
  patientId?: string;
  isDemo?: boolean;
  notes?: string;
  clinicId?: string;
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
  schemaVersion?: number;
}
