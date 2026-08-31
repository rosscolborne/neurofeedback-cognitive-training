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
  | 'immersive-3d'
  | 'generative-music'
  | 'narrative-story';

export type SessionPhase = 'calibration' | 'warmup' | 'training' | 'cooldown' | 'debrief';

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
}

export interface ProtocolTemplate {
  id: string;
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
}

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
  patientId?: string;
  isDemo?: boolean;
  notes?: string;
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
