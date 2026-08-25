export type ProtocolType =
  | 'theta-beta-ratio'
  | 'smr-enhancement'
  | 'alpha-enhancement'
  | 'alpha-theta-crossover'
  | 'beta-downtraining';

export type ExperienceType =
  | 'skyline-drift'
  | 'tidal-garden'
  | 'breath-weave'
  | 'signal-sort'
  | 'rhythm-lock'
  | 'media-mode'
  | 'soundscape-mode'
  | 'mandala';

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
  focusScore: number;
  relaxScore: number;
  mindfulnessScore: number | null;
  restfulnessScore: number | null;
  valence?: number | null;       // -1 (negative) to +1 (positive)
  arousal?: number | null;       // 0 (calm) to 1 (activated)
  emotionLabel?: string | null;  // e.g. "calm", "excited", "stressed"
  method?: 'brainflow_welch_psd' | 'browser_dsp';
}

export type ServerFitChannelState = 'good' | 'fair' | 'poor' | 'off';

export interface ServerFitChannel {
  id: string;             // "TP9", "AF7", "AF8", "TP10"
  state: ServerFitChannelState;
  rms?: number;
}

export interface ServerFitState {
  state: 'checking' | 'good' | 'poor' | 'off';
  ready: boolean;
  worn: boolean;
  blockers: string[];
  channels: ServerFitChannel[];
}

export interface TrainingMetricSample {
  score: number;           // 0 – 100 baseline-relative
  baselineReady: boolean;
}

export interface EEGDataPoint {
  timestamp: number;
  rawSignal: number;
  bands: BandPowers;
  thetaBetaRatio: number;
  coherence: number; // 0 - 100%
  inZone: boolean;
  signalQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
  channelQuality: MuseChannelQuality;
  batteryLevel?: number;
  artifacts: {
    blink: boolean;
    clench: boolean;
  };
  brainflowScores?: BrainFlowScores;
  trainingMetric?: TrainingMetricSample;
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
  date: string;
  timestamp: number;
  protocol: ProtocolType;
  experience: ExperienceType;
  durationSeconds: number;
  timeInZonePercent: number;
  averageCoherence: number;
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
  averageTrainingScore?: number;        // brainflow_service training metric (0 – 100)
  averageMindfulness?: number;          // brainflow_service mindfulness metric (0 – 100)
  averageValence?: number;              // brainflow_service valence (-1 to +1)
  averageArousal?: number;              // brainflow_service arousal (0 to 1)
  moodRating?: 1 | 2 | 3 | 4 | 5;
  patientNotes?: string;
  clinicianNotes?: string;
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
  clientName: string;
  clientAvatar: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: MessageItem[];
}
