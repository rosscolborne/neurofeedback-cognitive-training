export type ProtocolType =
  | 'theta-beta-ratio'
  | 'smr-enhancement'
  | 'alpha-enhancement'
  | 'alpha-theta-crossover'
  | 'beta-downtraining'
  | 'individualized-upper-alpha';

// NeuroGambit is the only remaining EEG experience; the other legacy
// neurofeedback experiences were retired. Brain-training games are defined in
// shared/ (@nfct/shared), not here (ADR-001).
export type ExperienceType = 'neuro-gambit';

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

export type DataUnavailableReason =
  | 'not-collected'
  | 'insufficient-samples'
  | 'poor-signal'
  | 'device-disconnected'
  | 'not-calibrated'
  | 'not-applicable'
  | 'legacy-unverified';

export interface MetricProvenance {
  algorithm: string;
  version: string;
  source: 'brainflow' | 'browser-dsp' | 'clinical-import' | 'clinician-entered' | 'legacy';
  computedAt?: PersistedTimestamp;
}

export interface BandPowers {
  delta: number; // 0.5 - 4 Hz (µV)
  theta: number; // 4 - 8 Hz (µV)
  alpha: number; // 8 - 12 Hz (µV)
  smr: number;   // 12 - 15 Hz (µV)
  beta: number;  // 15 - 30 Hz (µV)
  gamma: number; // 30 - 50 Hz (µV)
}

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

export interface ProtocolTemplate {
  id: string;
  /** Broad training engine mode represented by this clinical template. */
  protocolType?: ProtocolType;
  /** Opts a saved assignment into raw-EEG reward-band feedback, even when its values match the template. */
  customRewardEnabled?: boolean;
  /** A clinician-defined ratio of spectral powers. Used only by ratio protocols. */
  ratioReward?: {
    numerator: { freqMin: number; freqMax: number };
    denominator: { freqMin: number; freqMax: number };
    targetCondition: 'above' | 'below';
    targetThreshold: number;
  };
  /** Optional patient-facing label; `name` remains the evidence-based protocol name. */
  alias?: string;
  name: string;
  clinicalName: string;
  leadInvestigator: string;
  indication: string;
  montageSite: string; // e.g., 'Fz / Cz' or 'Pz / Oz'
  rewardBand: {
    name: string;
    freqMin: number;
    freqMax: number;
    targetCondition: 'above' | 'below';
    targetThreshold: number;
  };
  inhibitBand1?: {
    name: string;
    freqMin: number;
    freqMax: number;
    targetThreshold: number;
  };
  inhibitBand2?: {
    name: string;
    freqMin: number;
    freqMax: number;
    targetThreshold: number;
  };
  adaptiveStep: number;
  sensitivity: 'low' | 'balanced' | 'high';
  sessionDurationMinutes: number;
  recommendedExperiences: ExperienceType[];
  clinicalNotes: string;
  museChannelMapping?: string; // e.g. 'AF7 / AF8 Frontal (Derived Midline TBR)'
  schemaVersion?: number;
  version?: string;
  status?: 'draft' | 'approved' | 'retired';
  clinicId?: string;
  evidenceReferences?: string[];
  compatibleDeviceModels?: string[];
  approvedByPractitionerId?: string;
  approvedAt?: PersistedTimestamp;
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

export interface SessionRecord {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicianId?: string;
  date: string;
  timestamp: number;
  /**
   * Legacy protocol-session fields. Sessions saved since the EEG
   * simplification carry none of these: no protocol, in-zone, band, coherence,
   * threshold or time-series data is measured any more.
   */
  protocol?: ProtocolType;
  experience: ExperienceType;
  durationSeconds: number;
  timeInZonePercent?: number;
  /** Successful measured seconds; optional on sessions saved before time-based Garden XP. */
  inZoneSeconds?: number;
  /** Prescribed runtime used to normalize Garden XP, including early completions. */
  configuredDurationSeconds?: number;
  /** Mean measured interhemispheric coherence, or null when no valid pair/window was available. */
  averageCoherence?: number | null;
  peakFocusScore?: number;
  averageBands?: BandPowers;
  timeSeries?: Array<{
    t: number;
    thetaBetaRatio: number;
    alpha: number;
    smr: number;
    beta: number;
    inZone: boolean;
  }>;
  adaptiveAdjustmentsCount?: number;
  finalThreshold?: number;
  averageTrainingScore?: number | null;
  averageMindfulness?: number;          // brainflow_service mindfulness metric (0 – 100)
  averageValence?: number;              // brainflow_service valence (-1 to +1)
  averageArousal?: number;              // brainflow_service arousal (0 to 1)
  moodRating?: 1 | 2 | 3 | 4 | 5;
  patientNotes?: string;
  clinicianNotes?: string;
  isDemo?: boolean;
  learningRateScore?: number;
  schemaVersion?: number;
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
  completedAt?: PersistedTimestamp;
  metricProvenance?: Record<string, MetricProvenance>;
}

export interface SessionNotesPatch {
  patientNotes?: string | null;
  clinicianNotes?: string | null;
  moodRating?: 1 | 2 | 3 | 4 | 5 | null;
}

export interface SessionCreateResult {
  created: boolean;
  session: SessionRecord;
}

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  condition?: 'ADHD (Inattentive)' | 'ADHD (Combined)' | 'Generalized Anxiety' | 'Stress / Insomnia' | 'Peak Performance';
  status: 'active' | 'paused' | 'completed';
  assignedProtocol?: ProtocolType;
  customProtocolConfig?: ProtocolTemplate;
  brainMaps: QEEGBrainMap[];
  allowedExperiences: ExperienceType[];
  prescribedSessionsPerWeek?: number;
  completedSessionsCount: number;
  currentStreak: number;
  streakFreezeRemaining?: number;
  /** Legacy-only until a clinically/product-validated score definition exists. */
  brainCapacityScore?: number | null;
  lastSessionDate?: string;
  nextSessionDate?: string;
  customThresholdBounds?: {
    min: number;
    max: number;
  };
  tidalGardenState?: {
    stage: number;
    plantsUnlocked: string[];
    growthPoints: number;
    lastWatered: string;
  };
  skylineBiomesUnlocked?: string[];
  badges: string[];
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
  /**
   * Bounded, private idempotency ledger for completed-session aggregation.
   * This lets the client retry a session write without reading a not-yet-created
   * session document, which Firestore rules correctly cannot authorize.
   */
  recentCompletedSessionIds?: string[];
}

export interface MilestoneBadge {
  id: string;
  title: string;
  description: string;
  category: 'focus' | 'calm' | 'consistency' | 'exploration';
  iconName: string;
  unlockedAt?: string;
}
