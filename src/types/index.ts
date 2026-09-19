export type ProtocolType =
  | 'theta-beta-ratio'
  | 'smr-enhancement'
  | 'alpha-enhancement'
  | 'alpha-theta-crossover'
  | 'beta-downtraining'
  | 'individualized-upper-alpha';

export type ExperienceType =
  | 'skyline-drift'
  | 'tidal-garden'
  | 'breath-weave'
  | 'signal-sort'
  | 'rhythm-lock'
  | 'media-mode'
  | 'soundscape-mode'
  | 'mandala'
  | 'eeg-mandala'
  | 'immersive-3d'
  | 'generative-music'
  | 'narrative-story'
  | 'neuro-gambit';

export type SessionPhase = 'calibration' | 'warmup' | 'training' | 'cooldown' | 'debrief';

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

export type DataAvailability<T> =
  | { status: 'available'; value: T; measuredAt?: string; source?: string; version?: string }
  | { status: 'unavailable'; value: null; reason: DataUnavailableReason; detail?: string };

export interface MetricProvenance {
  algorithm: string;
  version: string;
  source: 'brainflow' | 'browser-dsp' | 'clinical-import' | 'clinician-entered' | 'legacy';
  computedAt?: PersistedTimestamp;
}

export interface VersionedMetric<T = number> {
  value: T | null;
  availability: 'available' | 'unavailable';
  unavailableReason?: DataUnavailableReason;
  provenance?: MetricProvenance;
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

export interface BrainFlowScores {
  mindfulnessScore: number | null;
  restfulnessScore: number | null;
  valence?: number | null;       // -1 (negative) to +1 (positive)
  arousal?: number | null;       // 0 (calm) to 1 (activated)
  emotionLabel?: string | null;  // e.g. "calm", "excited", "stressed"
  method?: 'brainflow_welch_psd' | 'browser_dsp';
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

export interface TrainingMetricSample {
  score: number | null;    // 0 – 100 baseline-relative, when available
  baselineReady: boolean;
}

export interface EEGDataPoint {
  timestamp: number;
  rawSignal: number;
  bands: BandPowers;
  /** Which server band-power values were actually supplied for this frame. */
  bandAvailability: Partial<Record<keyof BandPowers, boolean>>;
  /** Server-computed ratios, all derived from the same smoothed band snapshot. */
  bandRatios: Record<string, number>;
  calibrationStatus?: 'off' | 'collecting' | 'active';
  calibrationProgress?: number;
  calibrationRequired?: number;
  rawMetrics?: Record<string, number>;
  baselineRelativeMetrics?: Record<string, number>;
  thetaBetaRatio: number;
  thetaBetaRatioAvailable: boolean;
  /** 0–100 measured coherence percentage; null when the service could not compute it. */
  coherence: number | null;
  coherenceAvailable: boolean;
  inZone: boolean;
  inZoneAvailable: boolean;
  zoneScore: number; // 0.0 - 1.0 continuous feedback score
  signalQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
  channelQuality: MuseChannelQuality;
  batteryLevel?: number;
  artifacts: {
    blink: boolean;
    clench: boolean;
  };
  brainflowScores?: BrainFlowScores;
  trainingMetric?: TrainingMetricSample;
  isCalibrating?: boolean;
}

export interface IndividualBaselineModel {
  alphaPeakHz: number;
  oneOverFSlope: number;
  lastCalibratedAt: string;
  thetaMean?: number;
  thetaStd?: number;
  betaMean?: number;
  betaStd?: number;
  alphaMean?: number;
  alphaStd?: number;
  /** Optional on legacy baselines; required for newly validated calibration records. */
  schemaVersion?: number;
  status?: 'collecting' | 'valid' | 'invalid' | 'expired';
  sampleCount?: number;
  cleanSampleCount?: number;
  durationSeconds?: number;
  sourceDeviceId?: string;
  sampleRateHz?: number;
  algorithmVersion?: string;
  expiresAt?: PersistedTimestamp;
  invalidReason?: DataUnavailableReason | 'cancelled' | 'processing-error';
}

export type DeviceConnectionType = 'bluetooth-le' | 'usb' | 'wifi' | 'clinical-import' | 'unknown';

export interface DeviceCapability {
  model: string;
  manufacturer?: string;
  connectionType: DeviceConnectionType;
  sampleRateHz: number | null;
  adcResolutionBits?: number | null;
  channelIds: string[];
  supportsImpedance: boolean;
  supportsBatteryLevel: boolean;
  firmwareVersion?: string;
  capabilityVersion?: string;
}

export interface DeviceAssignment {
  deviceId: string;
  patientId: string;
  clinicId?: string;
  model: string;
  displayName?: string;
  serialNumberLast4?: string;
  assignedAt?: PersistedTimestamp;
  unassignedAt?: PersistedTimestamp | null;
  capability?: DeviceCapability;
  assignedByUserId?: string;
}

export interface PractitionerCredential {
  id: string;
  type: 'medical-license' | 'board-certification' | 'neurofeedback-certification' | 'other';
  label: string;
  jurisdiction?: string;
  identifier?: string;
  status: 'unverified' | 'pending' | 'verified' | 'expired' | 'revoked';
  verifiedAt?: PersistedTimestamp;
  expiresAt?: PersistedTimestamp;
}

export interface PractitionerProfile {
  id: string;
  userId: string;
  clinicId: string;
  displayName: string;
  professionalSuffixes?: string[];
  credentials: PractitionerCredential[];
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
}

export interface ProtocolTemplate {
  id: string;
  /** Broad training engine mode represented by this clinical template. */
  protocolType?: ProtocolType;
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

export interface ProtocolCatalogEntry {
  protocol: ProtocolTemplate;
  source: 'system' | 'clinic' | 'patient-override';
  revision: string;
  effectiveAt?: PersistedTimestamp;
}

export interface ProtocolCatalog {
  getById(id: string, clinicId?: string): Promise<ProtocolCatalogEntry | null>;
  list(clinicId?: string): Promise<ProtocolCatalogEntry[]>;
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
  topographyColorMap?: string;
  rawTelemetrySnippet?: string;
}

export interface ClinicBrandConfig {
  clinicId: string;
  name: string;
  tagline: string;
  logoUrl: string; // Base64 data URL or preset identifier
  primaryAccent: string;      // e.g. #E8967A
  primaryHover: string;
  primarySubtle: string;
  onPrimary: string;
  patientBaseSurface: string; // #F8F7F4
  clinicianBaseSurface: string; // #FAFAFA
  typographyStyle: 'editorial-serif' | 'modern-sans';
  createdAt: string;
  updatedAt?: PersistedTimestamp;
  schemaVersion?: number;
}

export interface ClinicProfile {
  id: string;
  name: string;
  timezone: string;
  branding?: ClinicBrandConfig;
  practitionerIds: string[];
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
}

export interface SessionDeviceSnapshot {
  deviceId?: string;
  model?: string;
  firmwareVersion?: string;
  sampleRateHz?: number;
  channelIds?: string[];
  transport?: DeviceConnectionType;
}

export interface SessionRecord {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicianId?: string;
  date: string;
  timestamp: number;
  protocol: ProtocolType;
  experience: ExperienceType;
  durationSeconds: number;
  timeInZonePercent: number;
  /** Mean measured interhemispheric coherence, or null when no valid pair/window was available. */
  averageCoherence: number | null;
  peakFocusScore: number;
  averageBands: BandPowers;
  timeSeries: Array<{
    t: number;
    thetaBetaRatio: number;
    alpha: number;
    smr: number;
    beta: number;
    inZone: boolean;
  }>;
  adaptiveAdjustmentsCount: number;
  finalThreshold: number;
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
  device?: SessionDeviceSnapshot;
  metricProvenance?: Record<string, MetricProvenance>;
}

export type SessionQueryScope =
  | { role: 'patient'; patientId: string }
  | { role: 'clinician'; clinicianId: string; patientId?: string }
  | { role: 'clinic'; clinicId: string; patientId?: string };

export interface SessionNotesPatch {
  patientNotes?: string | null;
  clinicianNotes?: string | null;
  moodRating?: 1 | 2 | 3 | 4 | 5 | null;
}

export interface SessionCreateResult {
  created: boolean;
  session: SessionRecord;
}

export type PatientInvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface PatientInvitation {
  id: string;
  clinicianId: string;
  clinicianName: string;
  patientEmail: string;
  patientName: string;
  condition: ClientProfile['condition'];
  assignedProtocol: ProtocolType;
  prescribedSessionsPerWeek: number;
  notes?: string;
  status: PatientInvitationStatus;
  patientId?: string;
  createdAt?: PersistedTimestamp;
  updatedAt?: PersistedTimestamp;
  acceptedAt?: PersistedTimestamp;
  expiresAt?: PersistedTimestamp;
  /** Deterministic clinician + normalized-email claim used to prevent concurrent duplicate invites. */
  uniquenessClaimId?: string;
  schemaVersion: number;
}

export type PatientInvitationInput = Pick<
  PatientInvitation,
  'patientEmail' | 'patientName' | 'condition' | 'assignedProtocol' | 'prescribedSessionsPerWeek' | 'notes'
> & { clinicianName: string };

export interface ClientProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  condition: 'ADHD (Inattentive)' | 'ADHD (Combined)' | 'Generalized Anxiety' | 'Stress / Insomnia' | 'Peak Performance';
  status: 'active' | 'paused' | 'completed';
  assignedProtocol: ProtocolType;
  customProtocolConfig?: ProtocolTemplate;
  individualBaselineModel?: IndividualBaselineModel;
  brainMaps: QEEGBrainMap[];
  allowedExperiences: ExperienceType[];
  prescribedSessionsPerWeek: number;
  completedSessionsCount: number;
  currentStreak: number;
  streakFreezeRemaining: number;
  brainCapacityScore: number; // 0 - 100
  lastSessionDate: string;
  nextSessionDate: string;
  customThresholdBounds?: {
    min: number;
    max: number;
  };
  tidalGardenState: {
    stage: number;
    plantsUnlocked: string[];
    growthPoints: number;
    lastWatered: string;
  };
  skylineBiomesUnlocked: string[];
  badges: string[];
  linkedClinicianCode?: string;
  clinicianId?: string;
  acceptedInvitationId?: string;
  patientId?: string;
  isDemo?: boolean;
  notes?: string;
  clinicId?: string;
  assignedDevice?: DeviceAssignment;
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

export interface MessageItem {
  id: string;
  sender: 'clinician' | 'patient';
  text: string;
  timestamp: string;
  isRead: boolean;
  attachmentUrl?: string;
}

export interface MessageThread {
  clientId: string;
  patientId?: string;
  clinicianId?: string;
  clientName: string;
  clientAvatar: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: MessageItem[];
  isDemo?: boolean;
}

export type AppointmentType =
  | 'remote-training'
  | 'in-clinic-evaluation'
  | 'qeeg-mapping'
  | 'protocol-review'
  | 'consultation';

export type AppointmentStatus = 'scheduled' | 'in-progress' | 'completed' | 'cancelled' | 'missed';

export interface CalendarAppointment {
  id: string;
  clientId: string;
  patientId?: string;
  clinicianId?: string;
  clientName: string;
  clientAvatar: string;
  clientCondition: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (e.g., "10:30")
  durationMinutes: number;
  type: AppointmentType;
  protocol: ProtocolType;
  experience?: ExperienceType;
  status: AppointmentStatus;
  notes?: string;
  isDemo?: boolean;
  hardwareProfile?: 'Muse S (Athena)' | 'Muse 2' | '19-Ch QEEG Clinical';
}

export interface PracticeOutcomeMetrics {
  totalActivePatients: number;
  totalCompletedSessions: number;
  averageCohortCompliance: number; // e.g. 86%
  averageCohortInZone: number;     // e.g. 78%
  averageTbrReductionPercent: number; // e.g. 24%
  averageAlphaPeakFrequency: number;  // e.g. 10.2 Hz
  cohortConditionsBreakdown: {
    adhd: number;
    anxiety: number;
    insomnia: number;
    peakPerformance: number;
  };
}
