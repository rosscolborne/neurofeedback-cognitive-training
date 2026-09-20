import {
  ClientProfile,
  ClinicProfile,
  ClinicBrandConfig,
  DeviceAssignment,
  MessageThread,
  MilestoneBadge,
  SessionRecord,
  CalendarAppointment,
  SessionCreateResult,
  SessionNotesPatch,
  SessionQueryScope,
  PractitionerProfile,
  PatientInvitation,
  PatientInvitationInput,
  QEEGBrainMap,
} from '../types';
import { BRAND_PRESETS } from './brandEngine';
import { auth, db } from './firebase';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  applySessionCompletionToClient,
  getPatientClinicianId,
  isPatientInvitationExpired,
  readClientProfile,
  readPatientInvitation,
  readSessionRecord,
  removeUndefined,
  timestampToMillis,
  timestampToIso,
} from './dataMappers';
import { DEMO_CLINICIAN_ID, isClinicianDemoWorkspace } from './clinicianDemoBoundary';
import { mapClinicBrand } from './clinicSettingsRepository';

const STORAGE_KEYS = {
  BRAND: 'waveable_brand_config',
  CLIENTS: 'waveable_clients',
  SESSIONS: 'waveable_sessions',
  MESSAGES: 'waveable_messages',
  APPOINTMENTS: 'waveable_appointments',
  CURRENT_CLIENT_ID: 'waveable_current_client_id',
};

// Invitation addresses are stored case-normalized. Firestore rules lowercase
// the Firebase Auth token email before comparing it with the stored address.
// Invitations do not require an existing patient document: the account/profile
// may be created later, and acceptance links that authenticated profile.
const normalizeEmail = (email: string) => email.trim().toLowerCase();

const createInvitationCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
};

const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const INVITATION_CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const getInvitationClaimRef = (clinicianId: string, normalizedEmail: string) =>
  doc(db, 'patientInvitationClaims', clinicianId, 'emails', normalizedEmail);

const QEEG_Z_SCORE_KEYS = ['centralBeta', 'frontalTheta', 'occipitalAlpha', 'sensorimotorSMR', 'temporalDelta'] as const;

const normalizeQeegInput = (input: QEEGBrainMap) => {
  const keys = Object.keys(input.zScores ?? {}).sort();
  const parsedRecordingDate = /^\d{4}-\d{2}-\d{2}$/.test(input.recordingDate)
    ? new Date(`${input.recordingDate}T00:00:00.000Z`)
    : new Date(Number.NaN);
  const uploadMillis = Date.parse(input.uploadDate);
  const validRecordingDate = Number.isFinite(parsedRecordingDate.getTime()) &&
    parsedRecordingDate.toISOString().slice(0, 10) === input.recordingDate;
  const zScores = QEEG_Z_SCORE_KEYS.map((key) => input.zScores?.[key]);
  if (
    keys.join('|') !== [...QEEG_Z_SCORE_KEYS].sort().join('|') ||
    zScores.some((value) => !Number.isFinite(value) || value < -10 || value > 10) ||
    !Number.isFinite(input.dominantAlphaPeakHz) ||
    input.dominantAlphaPeakHz <= 0 ||
    input.dominantAlphaPeakHz > 30 ||
    !validRecordingDate ||
    !Number.isFinite(uploadMillis) ||
    input.deviceSource.trim().length < 1 ||
    input.deviceSource.trim().length > 200 ||
    input.technicianNotes.trim().length > 5000
  ) {
    throw new Error('QEEG record contains invalid clinical values');
  }
  return {
    id: input.id,
    uploadDate: new Date(uploadMillis).toISOString(),
    fileName: '',
    recordingDate: input.recordingDate,
    deviceSource: input.deviceSource.trim(),
    technicianNotes: input.technicianNotes.trim(),
    zScores: {
      frontalTheta: input.zScores.frontalTheta,
      centralBeta: input.zScores.centralBeta,
      occipitalAlpha: input.zScores.occipitalAlpha,
      temporalDelta: input.zScores.temporalDelta,
      sensorimotorSMR: input.zScores.sensorimotorSMR,
    },
    dominantAlphaPeakHz: input.dominantAlphaPeakHz,
  };
};

const readCanonicalBrainMap = (data: unknown, id: string): QEEGBrainMap => {
  const raw = data as Record<string, unknown>;
  const recordingDate = timestampToIso(raw.recordingDate as QEEGBrainMap['createdAt'])?.slice(0, 10) ?? '';
  const uploadDate = timestampToIso(raw.uploadDate as QEEGBrainMap['createdAt']) ??
    timestampToIso(raw.createdAt as QEEGBrainMap['createdAt']) ?? '';
  return { ...(raw as unknown as QEEGBrainMap), id, recordingDate, uploadDate };
};

const qeegPayloadMatches = (saved: QEEGBrainMap, expected: ReturnType<typeof normalizeQeegInput>) =>
  saved.id === expected.id &&
  saved.fileName === expected.fileName &&
  saved.recordingDate === expected.recordingDate &&
  saved.deviceSource === expected.deviceSource &&
  saved.technicianNotes === expected.technicianNotes &&
  saved.dominantAlphaPeakHz === expected.dominantAlphaPeakHz &&
  saved.zScores?.frontalTheta === expected.zScores.frontalTheta &&
  saved.zScores?.centralBeta === expected.zScores.centralBeta &&
  saved.zScores?.occipitalAlpha === expected.zScores.occipitalAlpha &&
  saved.zScores?.temporalDelta === expected.zScores.temporalDelta &&
  saved.zScores?.sensorimotorSMR === expected.zScores.sensorimotorSMR;

export const INITIAL_BADGES: MilestoneBadge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    description: 'Completed your very first neurofeedback training session.',
    category: 'consistency',
    iconName: 'Award',
    unlockedAt: undefined,
  },
  {
    id: 'steady-state',
    title: 'Steady State',
    description: 'Maintained a 7-day training consistency streak.',
    category: 'consistency',
    iconName: 'Waves',
    unlockedAt: undefined,
  },
  {
    id: 'deep-focus',
    title: 'Deep Focus Master',
    description: 'Achieved 80%+ time-in-zone in a Theta/Beta session.',
    category: 'focus',
    iconName: 'Target',
    unlockedAt: undefined,
  },
  {
    id: 'still-waters',
    title: 'Still Waters',
    description: 'Sustained calm Alpha wave dominance for over 15 minutes.',
    category: 'calm',
    iconName: 'Wind',
    unlockedAt: undefined,
  },
  {
    id: 'garden-keeper',
    title: 'Garden Keeper',
    description: 'Evolved Tidal Garden to Stage 3 with thriving bioluminescence.',
    category: 'exploration',
    iconName: 'Compass',
    unlockedAt: undefined,
  },
  {
    id: 'skyline-explorer',
    title: 'Skyline Pilot',
    description: 'Soared through 5 distinct procedurally generated flight biomes.',
    category: 'exploration',
    iconName: 'Send',
    unlockedAt: undefined,
  },
];

export const createBlankProfile = (uid: string, email: string, displayName?: string | null): ClientProfile => {
  const name = displayName?.trim() || '';
  const cleanName = name
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: uid,
    name: cleanName,
    email: email,
    status: 'active',
    allowedExperiences: [
      'immersive-3d',
      'generative-music',
      'narrative-story',
      'skyline-drift',
      'tidal-garden',
      'breath-weave',
      'signal-sort',
      'rhythm-lock',
      'media-mode',
      'soundscape-mode',
      'mandala',
      'eeg-mandala',
      'neuro-gambit'
    ],
    completedSessionsCount: 0,
    currentStreak: 0,
    brainMaps: [],
    badges: [],
    isDemo: false,
  };
};

export const INITIAL_DEMO_CLIENTS: ClientProfile[] = [
  {
    id: 'demo-sarah-mitchell',
    name: 'Sarah Mitchell',
    email: 'sarah.m@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    condition: 'ADHD (Inattentive)',
    status: 'active',
    assignedProtocol: 'theta-beta-ratio',
    allowedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'eeg-mandala', 'neuro-gambit'],
    prescribedSessionsPerWeek: 4,
    completedSessionsCount: 14,
    currentStreak: 5,
    streakFreezeRemaining: 1,
    brainCapacityScore: 84,
    lastSessionDate: 'Today, 9:45 AM',
    nextSessionDate: 'Tomorrow, 10:00 AM',
    isDemo: true,
    notes: 'Responds well to Skyline Drift visual neuro-luminosity. Frontal theta suppression target at AF7/AF8 (virtual Fz).',
    brainMaps: [
      {
        id: 'qeeg-sarah-baseline',
        uploadDate: 'Aug 1, 2026',
        recordingDate: 'Jul 28, 2026',
        fileName: 'Mitchell_Sarah_QEEG_Baseline.edf',
        deviceSource: 'Deymed 19-Ch QEEG TruScan',
        technicianNotes: 'Elevated frontal theta excess (Z = +2.4 at Fz/AF7/AF8). IAF dominant peak at 9.8 Hz.',
        zScores: {
          frontalTheta: 2.4,
          centralBeta: -0.6,
          occipitalAlpha: -0.8,
          temporalDelta: 0.9,
          sensorimotorSMR: -0.4,
        },
        dominantAlphaPeakHz: 9.8,
      },
    ],
    tidalGardenState: {
      stage: 2,
      plantsUnlocked: ['amber-coral', 'emerald-kelp'],
      growthPoints: 420,
      lastWatered: new Date().toISOString().split('T')[0],
    },
    skylineBiomesUnlocked: ['Alpine Meadows', 'Coastline Cliffs', 'Whispering Forest'],
    badges: ['first-light', 'steady-state', 'deep-focus'],
  },
  {
    id: 'demo-david-miller',
    name: 'David Miller',
    email: 'david.m@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    condition: 'Generalized Anxiety',
    status: 'active',
    assignedProtocol: 'alpha-enhancement',
    allowedExperiences: ['neuro-gambit', 'immersive-3d', 'generative-music', 'narrative-story', 'tidal-garden', 'breath-weave', 'soundscape-mode', 'mandala', 'eeg-mandala'],
    prescribedSessionsPerWeek: 3,
    completedSessionsCount: 9,
    currentStreak: 3,
    streakFreezeRemaining: 2,
    brainCapacityScore: 78,
    lastSessionDate: 'Yesterday, 4:15 PM',
    nextSessionDate: 'Thursday, 3:30 PM',
    isDemo: true,
    notes: 'Posterior alpha conditioning via Muse S Athena temporoparietal sensors (TP9/TP10).',
    brainMaps: [],
    tidalGardenState: {
      stage: 3,
      plantsUnlocked: ['amber-coral', 'emerald-kelp', 'bioluminescent-anemone'],
      growthPoints: 680,
      lastWatered: new Date().toISOString().split('T')[0],
    },
    skylineBiomesUnlocked: ['Alpine Meadows'],
    badges: ['first-light', 'still-waters', 'garden-keeper'],
  },
  {
    id: 'demo-marcus-chen',
    name: 'Marcus Chen',
    email: 'marcus.c@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    condition: 'Stress / Insomnia',
    status: 'paused',
    assignedProtocol: 'beta-downtraining',
    allowedExperiences: ['neuro-gambit', 'immersive-3d', 'generative-music', 'narrative-story', 'breath-weave', 'soundscape-mode', 'mandala', 'eeg-mandala'],
    prescribedSessionsPerWeek: 3,
    completedSessionsCount: 6,
    currentStreak: 0,
    streakFreezeRemaining: 1,
    brainCapacityScore: 64,
    lastSessionDate: 'Aug 14, 9:00 PM',
    nextSessionDate: 'Paused by Clinician',
    isDemo: true,
    notes: 'High sympathetic arousal and high-beta muscle guarding at scalp.',
    brainMaps: [],
    tidalGardenState: {
      stage: 1,
      plantsUnlocked: ['amber-coral'],
      growthPoints: 110,
      lastWatered: '2026-08-14',
    },
    skylineBiomesUnlocked: ['Alpine Meadows'],
    badges: ['first-light'],
  },
  {
    id: 'demo-elena-rostova',
    name: 'Elena Rostova',
    email: 'elena.r@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    condition: 'Peak Performance',
    status: 'active',
    assignedProtocol: 'smr-enhancement',
    allowedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'signal-sort', 'rhythm-lock', 'skyline-drift', 'eeg-mandala', 'neuro-gambit'],
    prescribedSessionsPerWeek: 4,
    completedSessionsCount: 18,
    currentStreak: 8,
    streakFreezeRemaining: 2,
    brainCapacityScore: 92,
    lastSessionDate: 'Aug 24, 7:30 AM',
    nextSessionDate: 'Tomorrow, 7:30 AM',
    isDemo: true,
    notes: 'Cognitive resilience & sensorimotor 12-15 Hz enhancement for executive flow.',
    brainMaps: [],
    tidalGardenState: {
      stage: 2,
      plantsUnlocked: ['amber-coral', 'emerald-kelp'],
      growthPoints: 380,
      lastWatered: new Date().toISOString().split('T')[0],
    },
    skylineBiomesUnlocked: ['Alpine Meadows', 'Coastline Cliffs'],
    badges: ['first-light', 'steady-state', 'deep-focus'],
  },
];

export const INITIAL_DEMO_MESSAGES: MessageThread[] = [
  {
    clientId: 'demo-sarah-mitchell',
    clientName: 'Sarah Mitchell',
    clientAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    lastMessageTime: 'Today 9:45 AM',
    unreadCount: 1,
    isDemo: true,
    messages: [
      {
        id: 'm1',
        sender: 'clinician',
        text: 'Hi Sarah, I reviewed your Skyline Drift sessions from this week. Your Theta/Beta ratio showed steady suppression during the 15-minute mark.',
        timestamp: 'Aug 21, 4:30 PM',
        isRead: true,
      },
      {
        id: 'm2',
        sender: 'patient',
        text: 'Thank you Dr. Vance. I noticed I felt much calmer while starting my work tasks right after the morning session.',
        timestamp: 'Aug 21, 5:12 PM',
        isRead: true,
      },
      {
        id: 'm3',
        sender: 'clinician',
        text: 'That is positive neuroplastic adaptation in action. I have adjusted your adaptive threshold slightly to challenge your sustained focus duration on your Muse S Athena.',
        timestamp: 'Aug 22, 9:10 AM',
        isRead: true,
      },
      {
        id: 'm4',
        sender: 'patient',
        text: 'Just completed my session today: 84% time in zone. The audio cues are very clear!',
        timestamp: 'Today 9:45 AM',
        isRead: false,
      },
    ],
  },
  {
    clientId: 'demo-david-miller',
    clientName: 'David Miller',
    clientAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    lastMessageTime: 'Aug 20, 2:15 PM',
    unreadCount: 0,
    isDemo: true,
    messages: [
      {
        id: 'm201',
        sender: 'clinician',
        text: 'Hi David, how is the Tidal Garden alpha training experience feeling for your evening wind-down?',
        timestamp: 'Aug 20, 1:00 PM',
        isRead: true,
      },
      {
        id: 'm202',
        sender: 'patient',
        text: 'It is very relaxing. Seeing the corals glow when my mind quiets down provides clear biofeedback.',
        timestamp: 'Aug 20, 2:15 PM',
        isRead: true,
      },
    ],
  },
  {
    clientId: 'demo-elena-rostova',
    clientName: 'Elena Rostova',
    clientAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    lastMessageTime: 'Aug 24, 8:00 AM',
    unreadCount: 0,
    isDemo: true,
    messages: [
      {
        id: 'm301',
        sender: 'clinician',
        text: 'Elena, outstanding SMR stability on your last three sessions. We are seeing sustained 12-15 Hz enhancement with low EMG interference.',
        timestamp: 'Aug 23, 5:00 PM',
        isRead: true,
      },
      {
        id: 'm302',
        sender: 'patient',
        text: 'The Signal Sort task has really helped me dial in stillness before high-stakes presentations.',
        timestamp: 'Aug 24, 8:00 AM',
        isRead: true,
      },
    ],
  },
];

export const INITIAL_DEMO_SESSIONS: SessionRecord[] = [
  {
    id: 'demo-sess-001',
    patientId: 'demo-sarah-mitchell',
    patientName: 'Sarah Mitchell',
    clinicId: 'evolve-brain-training',
    date: 'Aug 25, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 2,
    protocol: 'theta-beta-ratio',
    experience: 'skyline-drift',
    durationSeconds: 1500, // 25 min
    timeInZonePercent: 84,
    averageCoherence: 80,
    peakFocusScore: 89,
    averageBands: { delta: 11.8, theta: 6.9, alpha: 11.5, smr: 7.2, beta: 10.4, gamma: 4.5 },
    timeSeries: Array.from({ length: 25 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: Math.max(1.1, 2.0 - i * 0.03 + (Math.random() - 0.5) * 0.15),
      alpha: 10.5 + Math.sin(i * 0.5) * 1.5,
      smr: 6.5 + i * 0.04,
      beta: 9.0 + i * 0.07,
      inZone: i > 2,
    })),
    adaptiveAdjustmentsCount: 1,
    finalThreshold: 1.72,
    moodRating: 5,
    patientNotes: 'Clear flight path through Alpine Meadows. High mental clarity post-flight.',
    clinicianNotes: 'Target TBR suppression achieved. Frontal theta bursts decreased by 32% from baseline.',
    isDemo: true,
  },
  {
    id: 'demo-sess-002',
    patientId: 'demo-sarah-mitchell',
    patientName: 'Sarah Mitchell',
    clinicId: 'evolve-brain-training',
    date: 'Aug 23, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 48,
    protocol: 'theta-beta-ratio',
    experience: 'signal-sort',
    durationSeconds: 1500,
    timeInZonePercent: 79,
    averageCoherence: 76,
    peakFocusScore: 82,
    averageBands: { delta: 12.4, theta: 7.6, alpha: 10.8, smr: 6.8, beta: 9.7, gamma: 4.1 },
    timeSeries: Array.from({ length: 25 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: 1.95 - i * 0.02,
      alpha: 10.0,
      smr: 6.2,
      beta: 9.1,
      inZone: Math.random() > 0.2,
    })),
    adaptiveAdjustmentsCount: 0,
    finalThreshold: 1.80,
    moodRating: 4,
    patientNotes: 'Focused during sorting task.',
    isDemo: true,
  },
  {
    id: 'demo-sess-003',
    patientId: 'demo-david-miller',
    patientName: 'David Miller',
    clinicId: 'evolve-brain-training',
    date: 'Aug 24, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 20,
    protocol: 'alpha-enhancement',
    experience: 'tidal-garden',
    durationSeconds: 1500,
    timeInZonePercent: 78,
    averageCoherence: 82,
    peakFocusScore: 76,
    averageBands: { delta: 14.1, theta: 8.5, alpha: 13.8, smr: 5.9, beta: 7.6, gamma: 3.2 },
    timeSeries: Array.from({ length: 25 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: 1.6,
      alpha: 11.0 + Math.sin(i * 0.3) * 3.0,
      smr: 5.5,
      beta: 7.2,
      inZone: true,
    })),
    adaptiveAdjustmentsCount: 1,
    finalThreshold: 11.2,
    moodRating: 5,
    patientNotes: 'Very calming coral bioluminescence.',
    isDemo: true,
  },
  {
    id: 'demo-sess-004',
    patientId: 'demo-elena-rostova',
    patientName: 'Elena Rostova',
    clinicId: 'evolve-brain-training',
    date: 'Aug 24, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 26,
    protocol: 'smr-enhancement',
    experience: 'signal-sort',
    durationSeconds: 1800,
    timeInZonePercent: 91,
    averageCoherence: 88,
    peakFocusScore: 94,
    averageBands: { delta: 9.8, theta: 5.8, alpha: 10.2, smr: 9.4, beta: 11.8, gamma: 5.1 },
    timeSeries: Array.from({ length: 30 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: 1.4,
      alpha: 10.0,
      smr: 8.5 + i * 0.05,
      beta: 11.2,
      inZone: true,
    })),
    adaptiveAdjustmentsCount: 2,
    finalThreshold: 8.2,
    moodRating: 5,
    patientNotes: 'High physical stillness and zero motor restlessness.',
    isDemo: true,
  },
];

export const INITIAL_DEMO_APPOINTMENTS: CalendarAppointment[] = [
  {
    id: 'demo-appt-001',
    clientId: 'demo-sarah-mitchell',
    clientName: 'Sarah Mitchell',
    clientAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    clientCondition: 'ADHD (Inattentive)',
    date: new Date().toISOString().split('T')[0], // Today
    time: '14:00',
    durationMinutes: 45,
    type: 'remote-training',
    protocol: 'theta-beta-ratio',
    experience: 'skyline-drift',
    status: 'scheduled',
    notes: 'Supervised remote session. Target Fz virtual midline theta suppression with Muse S Athena.',
    isDemo: true,
    hardwareProfile: 'Muse S (Athena)',
  },
  {
    id: 'demo-appt-002',
    clientId: 'demo-david-miller',
    clientName: 'David Miller',
    clientAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    clientCondition: 'Generalized Anxiety',
    date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
    time: '10:30',
    durationMinutes: 30,
    type: 'protocol-review',
    protocol: 'alpha-enhancement',
    experience: 'tidal-garden',
    status: 'scheduled',
    notes: 'Review posterior alpha synchrony and adjust adaptive step sensitivity.',
    isDemo: true,
    hardwareProfile: 'Muse S (Athena)',
  },
  {
    id: 'demo-appt-003',
    clientId: 'demo-elena-rostova',
    clientName: 'Elena Rostova',
    clientAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    clientCondition: 'Peak Performance',
    date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // In 2 days
    time: '08:00',
    durationMinutes: 30,
    type: 'remote-training',
    protocol: 'smr-enhancement',
    experience: 'signal-sort',
    status: 'scheduled',
    notes: 'Morning executive flow training.',
    isDemo: true,
    hardwareProfile: 'Muse S (Athena)',
  },
  {
    id: 'demo-appt-004',
    clientId: 'demo-marcus-chen',
    clientName: 'Marcus Chen',
    clientAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    clientCondition: 'Stress / Insomnia',
    date: new Date(Date.now() - 86400000 * 3).toISOString().split('T')[0], // 3 days ago
    time: '16:00',
    durationMinutes: 60,
    type: 'in-clinic-evaluation',
    protocol: 'beta-downtraining',
    experience: 'breath-weave',
    status: 'completed',
    notes: 'In-clinic 19-channel EEG baseline and impedance check conducted.',
    isDemo: true,
    hardwareProfile: '19-Ch QEEG Clinical',
  },
];

class StorageEngine {
  private demoClients: ClientProfile[] = [...INITIAL_DEMO_CLIENTS];
  private demoSessions: SessionRecord[] = [...INITIAL_DEMO_SESSIONS];
  private demoMessages: MessageThread[] = [...INITIAL_DEMO_MESSAGES];
  private demoAppointments: CalendarAppointment[] = [...INITIAL_DEMO_APPOINTMENTS];
  private demoBrand: ClinicBrandConfig = BRAND_PRESETS[0];

  private isDemoWorkspace(): boolean {
    return isClinicianDemoWorkspace();
  }

  private requireDemoWorkspace(action: string): void {
    if (!this.isDemoWorkspace()) {
      throw new Error(`${action} is available only in the isolated sample clinician workspace`);
    }
  }

  public getBrandConfig(): ClinicBrandConfig {
    if (this.isDemoWorkspace()) return this.demoBrand;
    const raw = localStorage.getItem(STORAGE_KEYS.BRAND) || localStorage.getItem('brainswell_brand_config') || localStorage.getItem('brainwell_brand_config');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return BRAND_PRESETS[0];
  }

  public saveBrandConfig(brand: ClinicBrandConfig) {
    if (this.isDemoWorkspace()) {
      this.demoBrand = brand;
      return;
    }
    localStorage.setItem(STORAGE_KEYS.BRAND, JSON.stringify(brand));
  }

  public async getClinicBrandConfig(clinicId: string): Promise<ClinicBrandConfig> {
    const clinic = await this.getClinic(clinicId);
    // Never fall back to the historical global browser key here: it is not
    // account/tenant scoped and can leak the previous account's branding.
    return mapClinicBrand(clinic?.branding, clinicId) ?? BRAND_PRESETS[0];
  }

  public async saveClinicBrandConfig(brand: ClinicBrandConfig): Promise<void> {
    this.saveBrandConfig(brand);
    if (this.isDemoWorkspace()) throw new Error('Clinic branding is unavailable in the sample clinician workspace');
    if (!auth.currentUser) return;
    await setDoc(
      doc(db, 'clinics', brand.clinicId),
      { branding: removeUndefined({ ...brand, updatedAt: serverTimestamp() }), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  public async getClinic(clinicId: string): Promise<ClinicProfile | null> {
    if (this.isDemoWorkspace() || !auth.currentUser) return null;
    const snapshot = await getDoc(doc(db, 'clinics', clinicId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<ClinicProfile>;
    return {
      ...data,
      id: data.id || snapshot.id,
      name: data.name ?? '',
      timezone: data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      practitionerIds: Array.isArray(data.practitionerIds) ? data.practitionerIds : [],
    };
  }

  public async saveClinic(clinic: ClinicProfile): Promise<void> {
    if (this.isDemoWorkspace()) throw new Error('Clinic settings are unavailable in the sample clinician workspace');
    if (!auth.currentUser) return;
    await setDoc(
      doc(db, 'clinics', clinic.id),
      removeUndefined({ ...clinic, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  }

  public async getPractitioner(practitionerId: string): Promise<PractitionerProfile | null> {
    if (this.isDemoWorkspace() || !auth.currentUser) return null;
    const snapshot = await getDoc(doc(db, 'practitioners', practitionerId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<PractitionerProfile>;
    return {
      ...data,
      id: data.id || snapshot.id,
      userId: data.userId ?? '',
      clinicId: data.clinicId ?? '',
      displayName: data.displayName ?? '',
      credentials: Array.isArray(data.credentials) ? data.credentials : [],
    };
  }

  public async savePractitioner(practitioner: PractitionerProfile): Promise<void> {
    if (this.isDemoWorkspace()) throw new Error('Practitioner settings are unavailable in the sample clinician workspace');
    if (!auth.currentUser) return;
    await setDoc(
      doc(db, 'practitioners', practitioner.id),
      removeUndefined({ ...practitioner, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  }

  private async canManagePatient(patientId: string): Promise<boolean> {
    if (this.isDemoWorkspace()) return false;
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return false;
    if (currentUserId === patientId) return true;

    try {
      const patient = await getDoc(doc(db, 'clients', patientId));
      if (!patient.exists()) return false;
      const profile = readClientProfile(patient.data(), patient.id);
      return getPatientClinicianId(profile) === currentUserId;
    } catch {
      return false;
    }
  }

  public async getDeviceAssignment(patientId: string): Promise<DeviceAssignment | null> {
    if (this.isDemoWorkspace() || !(await this.canManagePatient(patientId))) return null;
    const snapshot = await getDoc(doc(db, 'deviceAssignments', patientId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<DeviceAssignment>;
    if (!data.deviceId || !data.model) return null;
    return { ...data, patientId, deviceId: data.deviceId, model: data.model };
  }

  public async saveDeviceAssignment(assignment: DeviceAssignment): Promise<void> {
    if (this.isDemoWorkspace()) throw new Error('Device assignments are unavailable in the sample clinician workspace');
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return;
    if (!(await this.canManagePatient(assignment.patientId))) {
      throw new Error('Not authorized to manage this patient device assignment');
    }

    const assignmentRef = doc(db, 'deviceAssignments', assignment.patientId);
    const existing = await getDoc(assignmentRef);
    const existingData = existing.exists() ? (existing.data() as Partial<DeviceAssignment>) : null;
    await setDoc(
      assignmentRef,
      removeUndefined({
        ...assignment,
        assignedByUserId: existingData?.assignedByUserId ?? currentUserId,
        assignedAt: existingData?.assignedAt ?? assignment.assignedAt ?? serverTimestamp(),
      }),
      { merge: true }
    );
  }

  public async getClient(id: string): Promise<ClientProfile | null> {
    if (this.isDemoWorkspace()) return this.demoClients.find((client) => client.id === id) ?? null;
    if (!auth.currentUser) return null;
    const snap = await getDoc(doc(db, 'clients', id));
    if (snap.exists()) {
      return readClientProfile(snap.data(), snap.id);
    }
    return null;
  }

  public async getClients(clinicianId?: string): Promise<ClientProfile[]> {
    const activeClinicianId = clinicianId || auth.currentUser?.uid;
    if (this.isDemoWorkspace()) return !clinicianId || clinicianId === DEMO_CLINICIAN_ID ? [...this.demoClients] : [];
    if (!activeClinicianId) {
      return [];
    }

    const owned = new Map<string, ClientProfile>();
    const canonical = await getDocs(
      query(collection(db, 'clients'), where('clinicianId', '==', activeClinicianId))
    );
    canonical.docs.forEach((entry) => {
      const profile = readClientProfile(entry.data(), entry.id);
      if (getPatientClinicianId(profile) === activeClinicianId) owned.set(profile.id, profile);
    });

    // Firestore rules are not post-query filters. The explicit null constraint
    // makes this legacy query provably exclude split-brain documents. Documents
    // where clinicianId is missing remain directly readable by legacy ownership,
    // but require a trusted migration to set canonical clinicianId (preferred) or
    // explicit null before they can be enumerated in a roster query.
    try {
      const legacy = await getDocs(query(
        collection(db, 'clients'),
        where('linkedClinicianCode', '==', activeClinicianId),
        where('clinicianId', '==', null)
      ));
      legacy.docs.forEach((entry) => {
        const profile = readClientProfile(entry.data(), entry.id);
        if (getPatientClinicianId(profile) === activeClinicianId) owned.set(profile.id, profile);
      });
    } catch (error) {
      // The canonical query is complete for current records. Some deployments
      // intentionally deny the temporary legacy compatibility query; preserve
      // canonical results in that case, but surface operational failures.
      if ((error as { code?: string })?.code !== 'permission-denied') throw error;
    }
    return [...owned.values()];
  }

  public async createPatientInvitation(input: PatientInvitationInput): Promise<PatientInvitation> {
    if (this.isDemoWorkspace()) throw new Error('Invitations are unavailable in the sample clinician workspace');
    const clinician = auth.currentUser;
    if (!clinician) {
      throw new Error('A real clinician account is required to invite a patient');
    }

    const patientEmail = normalizeEmail(input.patientEmail);
    if (!patientEmail) throw new Error('Patient email is required');
    if (patientEmail.includes('/')) throw new Error('Patient email contains unsupported characters');
    if (patientEmail === normalizeEmail(clinician.email || '')) {
      throw new Error('You cannot invite your own clinician account as a patient');
    }
    if (!input.patientName.trim()) throw new Error('Patient name is required');
    const clinicId = input.clinicId.trim();
    if (!clinicId || clinicId.includes('/')) {
      throw new Error('Complete clinic setup before inviting a patient');
    }
    if (!Number.isInteger(input.prescribedSessionsPerWeek) || input.prescribedSessionsPerWeek < 1) {
      throw new Error('Weekly sessions must be a positive whole number');
    }

    const now = Date.now();
    const uniquenessClaimId = patientEmail;

    const invitation: PatientInvitation = {
      id: createInvitationCode(),
      clinicianId: clinician.uid,
      clinicId,
      clinicianName: input.clinicianName.trim() || clinician.email || 'Clinician',
      patientEmail,
      patientName: input.patientName.trim(),
      condition: input.condition,
      assignedProtocol: input.assignedProtocol,
      prescribedSessionsPerWeek: input.prescribedSessionsPerWeek,
      notes: input.notes?.trim() || undefined,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + INVITATION_LIFETIME_MS,
      uniquenessClaimId,
      schemaVersion: 1,
    };

    const invitationRef = doc(db, 'patientInvitations', invitation.id);
    const claimRef = getInvitationClaimRef(clinician.uid, uniquenessClaimId);
    await runTransaction(db, async (transaction) => {
      const claimSnapshot = await transaction.get(claimRef);
      if (claimSnapshot.exists()) {
        const claim = claimSnapshot.data() as { invitationId?: string; expiresAt?: unknown };
        if ((timestampToMillis(claim.expiresAt as PatientInvitation['expiresAt']) ?? Number.POSITIVE_INFINITY) > now) {
          throw new Error(`A pending invitation already exists for this email${claim.invitationId ? ` (${claim.invitationId})` : ''}`);
        }
      }

      const expiresAt = new Date(now + INVITATION_LIFETIME_MS);
      transaction.set(invitationRef, removeUndefined({
        ...invitation,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt,
      }));
      transaction.set(claimRef, {
        clinicianId: clinician.uid,
        clinicId,
        patientEmail,
        invitationId: invitation.id,
        status: 'pending',
        expiresAt,
        createdAt: serverTimestamp(),
      });
    });
    return invitation;
  }

  public async getPatientInvitationsForClinician(): Promise<PatientInvitation[]> {
    if (this.isDemoWorkspace()) return [];
    const clinicianId = auth.currentUser?.uid;
    if (!clinicianId) return [];
    const snapshot = await getDocs(
      query(collection(db, 'patientInvitations'), where('clinicianId', '==', clinicianId))
    );
    return snapshot.docs
      .map((entry) => readPatientInvitation(entry.data(), entry.id))
      .sort((a, b) => (timestampToMillis(b.createdAt) ?? 0) - (timestampToMillis(a.createdAt) ?? 0));
  }

  public async cancelPatientInvitation(invitationId: string): Promise<void> {
    if (this.isDemoWorkspace()) throw new Error('Invitations are unavailable in the sample clinician workspace');
    const clinicianId = auth.currentUser?.uid;
    if (!clinicianId) throw new Error('Sign in to cancel an invitation');
    const invitationRef = doc(db, 'patientInvitations', invitationId);
    await runTransaction(db, async (transaction) => {
      const invitationSnapshot = await transaction.get(invitationRef);
      if (!invitationSnapshot.exists()) throw new Error('Invitation not found');
      const invitation = readPatientInvitation(invitationSnapshot.data(), invitationSnapshot.id);
      if (invitation.clinicianId !== clinicianId) throw new Error('You cannot cancel another clinician’s invitation');
      if (invitation.status === 'cancelled') return;
      if (invitation.status === 'accepted') throw new Error('An accepted invitation cannot be cancelled');

      transaction.set(invitationRef, { status: 'cancelled', updatedAt: serverTimestamp() }, { merge: true });
      if (invitation.uniquenessClaimId) {
        transaction.delete(getInvitationClaimRef(invitation.clinicianId, invitation.uniquenessClaimId));
      }
    });
  }

  public async unlinkPatient(patientId: string): Promise<void> {
    if (this.isDemoWorkspace()) throw new Error('Patient relationships are unavailable in the sample clinician workspace');
    const clinicianId = auth.currentUser?.uid;
    if (!clinicianId) throw new Error('Sign in to remove a patient from your roster');
    const patientRef = doc(db, 'clients', patientId);
    const snapshot = await getDoc(patientRef);
    if (!snapshot.exists()) return;
    const patient = readClientProfile(snapshot.data(), snapshot.id);
    if (getPatientClinicianId(patient) !== clinicianId) {
      throw new Error('You are not linked to this patient');
    }
    await setDoc(
      patientRef,
      { clinicianId: null, linkedClinicianCode: null, clinicId: null, acceptedInvitationId: null, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  public async acceptPatientInvitation(invitationCode: string, fallbackClient: ClientProfile): Promise<ClientProfile> {
    if (this.isDemoWorkspace()) throw new Error('Invitations are unavailable in the sample clinician workspace');
    const patient = auth.currentUser;
    if (!patient?.email) throw new Error('Sign in with the invited email address');
    const patientEmail = patient.email;

    const code = invitationCode.trim().toUpperCase();
    if (!INVITATION_CODE_PATTERN.test(code)) {
      throw new Error('Enter the 12-character invitation code in XXXX-XXXX-XXXX format');
    }
    const invitationRef = doc(db, 'patientInvitations', code);
    const clientRef = doc(db, 'clients', patient.uid);

    try {
      return await runTransaction(db, async (transaction) => {
        const invitationSnapshot = await transaction.get(invitationRef);
        if (!invitationSnapshot.exists()) throw new Error('Invitation code not found. Check the code and try again');

        const invitation = readPatientInvitation(invitationSnapshot.data(), invitationSnapshot.id);
        if (invitation.clinicianId === patient.uid) {
          throw new Error('A clinician cannot accept their own patient invitation');
        }
        if (normalizeEmail(invitation.patientEmail) !== normalizeEmail(patientEmail)) {
          throw new Error('This invitation was sent to a different email address');
        }
        if (invitation.clinicId && invitation.clinicId.includes('/')) {
          throw new Error('This invitation contains an invalid clinic assignment');
        }
        const clientSnapshot = await transaction.get(clientRef);
        const current = clientSnapshot.exists()
          ? readClientProfile(clientSnapshot.data(), clientSnapshot.id)
          : { ...fallbackClient, id: patient.uid, patientId: patient.uid, email: patientEmail };
        const currentClinicianId = getPatientClinicianId(current);

        if (invitation.status === 'accepted') {
          if (
            invitation.patientId === patient.uid &&
            currentClinicianId === invitation.clinicianId &&
            (!invitation.clinicId || current.clinicId === invitation.clinicId) &&
            current.acceptedInvitationId === invitation.id
          ) {
            return current;
          }
          throw new Error('This invitation has already been used');
        }
        if (invitation.status === 'cancelled') throw new Error('This invitation was cancelled by the clinician');
        if (invitation.status === 'expired' || isPatientInvitationExpired(invitation)) {
          throw new Error('This invitation has expired. Ask your clinician for a new code');
        }
        if (invitation.status !== 'pending') throw new Error('This invitation is no longer available');
        if (currentClinicianId === invitation.clinicianId) {
          throw new Error('You are already connected to this clinician. This invitation is not needed');
        }
        if (currentClinicianId && currentClinicianId !== invitation.clinicianId) {
          throw new Error('Disconnect from your current clinician before accepting another invitation');
        }
        const linkedClient: ClientProfile = {
          ...current,
          id: patient.uid,
          patientId: patient.uid,
          email: patientEmail,
          name: current.name || invitation.patientName,
          clinicianId: invitation.clinicianId,
          clinicId: invitation.clinicId ?? current.clinicId,
          acceptedInvitationId: invitation.id,
          condition: invitation.condition,
          assignedProtocol: invitation.assignedProtocol,
          prescribedSessionsPerWeek: invitation.prescribedSessionsPerWeek,
          notes: invitation.notes ?? current.notes,
        };
        const timestamp = serverTimestamp();

        transaction.set(clientRef, removeUndefined({ ...linkedClient, updatedAt: timestamp }), { merge: true });
        transaction.set(
          invitationRef,
          {
            status: 'accepted',
            patientId: patient.uid,
            acceptedAt: timestamp,
            updatedAt: timestamp,
          },
          { merge: true }
        );
        if (invitation.uniquenessClaimId) {
          transaction.delete(getInvitationClaimRef(invitation.clinicianId, invitation.uniquenessClaimId));
        }
        return linkedClient;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'permission-denied') {
        throw new Error('Invitation not found for this signed-in email. Check the code and account, then try again');
      }
      throw error;
    }
  }

  public async saveClient(client: ClientProfile): Promise<void> {
    if (this.isDemoWorkspace()) {
      const idx = this.demoClients.findIndex((c) => c.id === client.id);
      if (idx >= 0) {
        this.demoClients[idx] = client;
      } else {
        this.demoClients.unshift(client);
      }
      return;
    }

    if (!auth.currentUser) throw new Error('Sign in to save a patient record');

    const payload = removeUndefined(client) as unknown as Record<string, unknown>;
    for (const field of ['condition', 'assignedProtocol', 'prescribedSessionsPerWeek', 'customProtocolConfig'] as const) {
      if (client[field] === undefined) payload[field] = deleteField();
    }
    await setDoc(doc(db, 'clients', client.id), payload, { merge: true });
  }

  public async getBrainMaps(patientId: string): Promise<QEEGBrainMap[]> {
    const demoClient = this.demoClients.find((client) => client.id === patientId);
    if (this.isDemoWorkspace()) {
      return [...(demoClient?.brainMaps ?? [])];
    }
    if (!auth.currentUser) throw new Error('Sign in to load QEEG records');

    const snapshot = await getDocs(collection(db, 'clients', patientId, 'brainMaps'));
    return snapshot.docs
      .map((entry) => readCanonicalBrainMap(entry.data(), entry.id))
      .sort((a, b) => {
        const bUpload = Date.parse(b.uploadDate);
        const aUpload = Date.parse(a.uploadDate);
        const bTime = timestampToMillis(b.createdAt) ?? (Number.isFinite(bUpload) ? bUpload : 0);
        const aTime = timestampToMillis(a.createdAt) ?? (Number.isFinite(aUpload) ? aUpload : 0);
        return bTime - aTime || a.id.localeCompare(b.id);
      });
  }

  public async appendBrainMap(patientId: string, input: QEEGBrainMap): Promise<QEEGBrainMap> {
    const currentUser = auth.currentUser;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id)) throw new Error('QEEG record identifier is invalid');

    const normalized = normalizeQeegInput(input);

    const canonicalBase: QEEGBrainMap = {
      ...normalized,
      createdBy: currentUser?.uid ?? DEMO_CLINICIAN_ID,
      schemaVersion: 1,
    };

    if (this.isDemoWorkspace()) {
      const demoIndex = this.demoClients.findIndex((client) => client.id === patientId);
      if (demoIndex < 0) throw new Error('Demo patient was not found');
      const collision = (this.demoClients[demoIndex].brainMaps ?? []).find((entry) => entry.id === input.id);
      if (collision) {
        if (collision.createdBy === canonicalBase.createdBy && qeegPayloadMatches(collision, normalized)) return collision;
        throw new Error('QEEG record identifier is already in use');
      }
      const canonical = { ...canonicalBase, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const existing = this.demoClients[demoIndex].brainMaps ?? [];
      this.demoClients[demoIndex] = {
        ...this.demoClients[demoIndex],
        brainMaps: [canonical, ...existing],
      };
      return canonical;
    }

    if (!currentUser) throw new Error('Sign in as the managing clinician to save QEEG records');

    const clientRef = doc(db, 'clients', patientId);
    const mapRef = doc(db, 'clients', patientId, 'brainMaps', input.id);
    const existing = await runTransaction(db, async (transaction) => {
      const [clientSnapshot, mapSnapshot] = await Promise.all([
        transaction.get(clientRef),
        transaction.get(mapRef),
      ]);
      if (!clientSnapshot.exists()) throw new Error('Patient profile was not found');
      const patient = readClientProfile(clientSnapshot.data(), clientSnapshot.id);
      if (getPatientClinicianId(patient) !== currentUser.uid) {
        throw new Error('Only the linked clinician can add QEEG records');
      }
      if (mapSnapshot.exists()) {
        const saved = readCanonicalBrainMap(mapSnapshot.data(), mapSnapshot.id);
        if (saved.createdBy !== currentUser.uid || !qeegPayloadMatches(saved, normalized)) {
          throw new Error('QEEG record identifier is already in use');
        }
        return saved;
      }
      transaction.set(mapRef, {
        ...removeUndefined(canonicalBase),
        uploadDate: serverTimestamp(),
        recordingDate: Timestamp.fromDate(new Date(`${normalized.recordingDate}T00:00:00.000Z`)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return null;
    });
    if (existing) return existing;

    const persisted = await getDoc(mapRef);
    if (!persisted.exists()) throw new Error('QEEG record was not available after saving');
    return readCanonicalBrainMap(persisted.data(), persisted.id);
  }

  public async saveClients(clients: ClientProfile[]): Promise<void> {
    if (this.isDemoWorkspace()) {
      this.demoClients = clients;
      return;
    }
    for (const c of clients) {
      await this.saveClient(c);
    }
  }

  public async deleteClient(id: string): Promise<void> {
    if (this.isDemoWorkspace()) {
      this.demoClients = this.demoClients.filter((c) => c.id !== id);
      return;
    }
    if (!auth.currentUser) throw new Error('Sign in to remove a patient');

    await deleteDoc(doc(db, 'clients', id));
  }

  public async getCurrentClient(user?: { uid: string; email?: string | null; displayName?: string | null } | null): Promise<ClientProfile | null> {
    if (this.isDemoWorkspace()) return this.demoClients[0] ?? null;
    if (user?.uid) {
      const clientRef = doc(db, 'clients', user.uid);
      const snap = await getDoc(clientRef);
      if (snap.exists()) {
        const existing = readClientProfile(snap.data(), snap.id);
        if (!existing.name && user.displayName) {
          const name = user.displayName
            .trim()
            .replace(/[._]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
          await setDoc(clientRef, { name }, { merge: true });
          existing.name = name;
        }
        return existing;
      }

      // A blank profile is safe only after Firestore authoritatively confirms
      // that no profile exists. Read or write failures must remain visible.
      const fresh = createBlankProfile(user.uid, user.email || 'user@waveable.app', user.displayName);
      fresh.patientId = user.uid;
      await setDoc(clientRef, fresh);
      return fresh;
    }

    return null;
  }

  public setCurrentClientId(id: string) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CLIENT_ID, id);
  }

  public async getSessionsFor(scope: SessionQueryScope): Promise<SessionRecord[]> {
    const demoPatientId = 'patientId' in scope ? scope.patientId : undefined;

    if (this.isDemoWorkspace()) {
      const sessions = demoPatientId
        ? this.demoSessions.filter((session) => session.patientId === demoPatientId)
        : this.demoSessions;
      return [...sessions].sort((a, b) => b.timestamp - a.timestamp);
    }
    if (!auth.currentUser) return [];

    const currentUserId = auth.currentUser.uid;
    if (scope.role === 'patient' && scope.patientId !== currentUserId) return [];
    if (scope.role === 'clinician' && scope.clinicianId !== currentUserId) return [];
    if (scope.role === 'clinic' && scope.clinicId !== currentUserId) {
      const clinic = await this.getClinic(scope.clinicId);
      if (!clinic?.practitionerIds.includes(currentUserId)) return [];
    }

    try {
      const snapshots = [];
      if (scope.role === 'patient') {
        snapshots.push(await getDocs(query(collection(db, 'sessions'), where('patientId', '==', scope.patientId))));
      } else if (scope.role === 'clinician' && scope.patientId) {
        const patient = await getDoc(doc(db, 'clients', scope.patientId));
        if (!patient.exists()) return [];
        const profile = readClientProfile(patient.data(), patient.id);
        if (getPatientClinicianId(profile) !== scope.clinicianId) {
          return [];
        }
        snapshots.push(await getDocs(query(collection(db, 'sessions'), where('patientId', '==', scope.patientId))));
      } else if (scope.role === 'clinician') {
        // Rules authorize session access through the patient's *current*
        // relationship. Querying by the session's historical clinicianId can
        // include a relinked patient's row and make Firestore reject the whole
        // query because rules are not filters. Resolve the current canonical +
        // explicit-null legacy roster first, then query each authorized patient.
        const roster = await this.getClients(scope.clinicianId);
        snapshots.push(...await Promise.all(
          roster.map((client) =>
            getDocs(query(collection(db, 'sessions'), where('patientId', '==', client.id)))
          )
        ));
      } else if (scope.patientId) {
        const patient = await getDoc(doc(db, 'clients', scope.patientId));
        if (!patient.exists() || readClientProfile(patient.data(), patient.id).clinicId !== scope.clinicId) return [];
        snapshots.push(await getDocs(query(
          collection(db, 'sessions'),
          where('patientId', '==', scope.patientId),
          where('clinicId', '==', scope.clinicId),
        )));
      } else {
        // As above, clinic authorization follows current patient tenancy rather
        // than a historical session field.
        const roster = await getDocs(
          query(collection(db, 'clients'), where('clinicId', '==', scope.clinicId))
        );
        snapshots.push(...await Promise.all(
          roster.docs.map((client) =>
            getDocs(query(
              collection(db, 'sessions'),
              where('patientId', '==', client.id),
              where('clinicId', '==', scope.clinicId),
            ))
          )
        ));
      }

      const unique = new Map<string, SessionRecord>();
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) {
          const session = readSessionRecord(entry.data(), entry.id);
          unique.set(entry.id, session);
        }
      }
      return [...unique.values()]
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      console.warn('Failed to fetch sessions from Firestore:', err);
      throw err;
    }
  }

  /**
   * Backward-compatible query surface. Supplying a client ID is patient-scoped;
   * omitting it is clinician-scoped, which fixes cohort reports for real users.
   */
  public async getSessions(clientId?: string): Promise<SessionRecord[]> {
    if (this.isDemoWorkspace()) {
      return this.getSessionsFor({ role: 'clinician', clinicianId: DEMO_CLINICIAN_ID, patientId: clientId });
    }
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId) return [];
    if (clientId === currentUserId) {
      return this.getSessionsFor({ role: 'patient', patientId: clientId });
    }
    if (clientId) {
      return this.getSessionsFor({ role: 'clinician', clinicianId: currentUserId, patientId: clientId });
    }
    return this.getSessionsFor({ role: 'clinician', clinicianId: currentUserId });
  }

  public async createSession(session: SessionRecord): Promise<SessionCreateResult> {
    const normalizedSession = readSessionRecord(
      { ...session, schemaVersion: session.schemaVersion ?? 2 },
      session.id
    );
    const useMemory =
      this.isDemoWorkspace();

    if (useMemory) {
      const existing = this.demoSessions.find((entry) => entry.id === session.id);
      if (existing) return { created: false, session: existing };

      this.demoSessions.unshift(normalizedSession);
      const clientIndex = this.demoClients.findIndex((client) => client.id === session.patientId);
      if (clientIndex >= 0) {
        this.demoClients[clientIndex] = applySessionCompletionToClient(
          this.demoClients[clientIndex],
          normalizedSession
        );
      }
      return { created: true, session: normalizedSession };
    }

    if (!auth.currentUser) throw new Error('Sign in to save a training session');

    const currentUserId = auth.currentUser?.uid;
    let authorized = currentUserId === session.patientId || (await this.canManagePatient(session.patientId));
    if (!authorized && session.clinicId) {
      const [clinic, patient] = await Promise.all([
        this.getClinic(session.clinicId),
        getDoc(doc(db, 'clients', session.patientId)),
      ]);
      authorized = Boolean(
        currentUserId &&
        clinic?.practitionerIds.includes(currentUserId) &&
        patient.exists() &&
        readClientProfile(patient.data(), patient.id).clinicId === session.clinicId
      );
    }
    if (!authorized) throw new Error('Not authorized to create a session for this patient');

    const sessionRef = doc(db, 'sessions', session.id);
    const clientRef = doc(db, 'clients', session.patientId);
    return runTransaction(db, async (transaction) => {
      const currentClient = await transaction.get(clientRef);
      const timestamp = serverTimestamp();

      // A brand-new session cannot be read under the patient-scoped Firestore
      // rules because it has no patientId to authorize yet. Keep a bounded
      // ledger on the already-authorized client profile instead, so retries do
      // not apply its aggregate effects twice.
      if (
        currentClient.exists() &&
        readClientProfile(currentClient.data(), currentClient.id)
          .recentCompletedSessionIds?.includes(normalizedSession.id)
      ) {
        return { created: false, session: normalizedSession };
      }

      transaction.set(
        sessionRef,
        removeUndefined({
          ...normalizedSession,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: normalizedSession.completedAt ?? timestamp,
        })
      );

      if (currentClient.exists()) {
        const nextClient = applySessionCompletionToClient(
          readClientProfile(currentClient.data(), currentClient.id),
          normalizedSession
        );
        transaction.set(
          clientRef,
          removeUndefined({ ...nextClient, updatedAt: timestamp }),
          { merge: true }
        );
      }

      return { created: true, session: normalizedSession };
    });
  }

  public async patchSessionNotes(sessionId: string, patch: SessionNotesPatch): Promise<void> {
    const notePatch = removeUndefined({
      patientNotes: patch.patientNotes,
      clinicianNotes: patch.clinicianNotes,
      moodRating: patch.moodRating,
    });
    const demoIndex = this.demoSessions.findIndex((session) => session.id === sessionId);
    const useMemory =
      demoIndex >= 0 &&
      this.isDemoWorkspace();

    if (useMemory) {
      const updated = { ...this.demoSessions[demoIndex] };
      if (patch.patientNotes === null) delete updated.patientNotes;
      else if (patch.patientNotes !== undefined) updated.patientNotes = patch.patientNotes;
      if (patch.clinicianNotes === null) delete updated.clinicianNotes;
      else if (patch.clinicianNotes !== undefined) updated.clinicianNotes = patch.clinicianNotes;
      if (patch.moodRating === null) delete updated.moodRating;
      else if (patch.moodRating !== undefined) updated.moodRating = patch.moodRating;
      this.demoSessions[demoIndex] = updated;
      return;
    }
    if (this.isDemoWorkspace()) throw new Error(`Sample session ${sessionId} does not exist`);
    if (!auth.currentUser) return;

    const sessionRef = doc(db, 'sessions', sessionId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(sessionRef);
      if (!snapshot.exists()) throw new Error(`Session ${sessionId} does not exist`);

      const session = readSessionRecord(snapshot.data(), snapshot.id);
      const currentUserId = auth.currentUser?.uid;
      const isPatient = session.patientId === currentUserId;
      let isProvider = false;
      if (!isPatient && currentUserId) {
        const patient = await transaction.get(doc(db, 'clients', session.patientId));
        if (patient.exists()) {
          const profile = readClientProfile(patient.data(), patient.id);
          isProvider = getPatientClinicianId(profile) === currentUserId;
          if (!isProvider && session.clinicId && profile.clinicId === session.clinicId) {
            const clinic = await transaction.get(doc(db, 'clinics', session.clinicId));
            const practitionerIds = clinic.exists()
              ? (clinic.data() as Partial<ClinicProfile>).practitionerIds
              : undefined;
            isProvider = Array.isArray(practitionerIds) && practitionerIds.includes(currentUserId);
          }
        }
      }
      if (!isPatient && !isProvider) throw new Error('Not authorized to update this session');

      const authorizedPatch = isPatient
        ? removeUndefined({ patientNotes: notePatch.patientNotes, moodRating: notePatch.moodRating })
        : removeUndefined({ clinicianNotes: notePatch.clinicianNotes });
      transaction.set(
        sessionRef,
        { ...authorizedPatch, updatedAt: serverTimestamp() },
        { merge: true }
      );
    });
  }

  /**
   * Compatibility wrapper for current UI callers. A first call creates the
   * immutable measurement and aggregates it once; repeats patch only notes.
   */
  public async saveSession(session: SessionRecord): Promise<void> {
    const result = await this.createSession(session);
    if (!result.created) {
      await this.patchSessionNotes(session.id, {
        patientNotes: session.patientNotes,
        clinicianNotes: session.clinicianNotes,
        moodRating: session.moodRating,
      });
    }
  }

  public async getMessages(): Promise<MessageThread[]> {
    if (this.isDemoWorkspace()) {
      return [...this.demoMessages];
    }
    if (!auth.currentUser) {
      return [];
    }
    try {
      const q = query(
        collection(db, 'messages'),
        where('clinicianId', '==', auth.currentUser.uid)
      );
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => d.data() as MessageThread);
      if (docs.length > 0) return docs;
    } catch (err) {
      console.warn('Failed to fetch messages for clinician from Firestore:', err);
    }

    try {
      const qPatient = query(
        collection(db, 'messages'),
        where('clientId', '==', auth.currentUser.uid)
      );
      const snapPatient = await getDocs(qPatient);
      const docsPatient = snapPatient.docs.map((d) => d.data() as MessageThread);
      if (docsPatient.length > 0) return docsPatient;
    } catch (err) {
      console.warn('Failed to fetch messages for patient from Firestore:', err);
    }

    return [];
  }

  public async saveMessageThread(thread: MessageThread): Promise<void> {
    if (this.isDemoWorkspace()) {
      const idx = this.demoMessages.findIndex((t) => t.clientId === thread.clientId);
      if (idx >= 0) {
        this.demoMessages[idx] = thread;
      } else {
        this.demoMessages.unshift(thread);
      }
      return;
    }

    if (!auth.currentUser) throw new Error('Sign in to send a message');

    try {
      await setDoc(doc(db, 'messages', thread.clientId), thread, { merge: true });
    } catch (err) {
      console.error('Failed to save message thread to Firestore:', err);
    }
  }

  public async saveMessages(threads: MessageThread[]): Promise<void> {
    if (this.isDemoWorkspace()) {
      this.demoMessages = threads;
      return;
    }
    for (const t of threads) {
      await this.saveMessageThread(t);
    }
  }

  public subscribeToMessages(callback: (threads: MessageThread[]) => void, role?: 'clinician' | 'patient' | null): () => void {
    if (this.isDemoWorkspace()) {
      callback([...this.demoMessages]);
      return () => {};
    }
    if (!auth.currentUser) {
      callback([]);
      return () => {};
    }

    const uid = auth.currentUser.uid;
    const isPatient = role === 'patient';
    const primaryQuery = isPatient
      ? query(collection(db, 'messages'), where('clientId', '==', uid))
      : query(collection(db, 'messages'), where('clinicianId', '==', uid));

    const unsubscribe = onSnapshot(
      primaryQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => d.data() as MessageThread);
        callback(docs);
      },
      () => {
        callback([]);
      }
    );

    return unsubscribe;
  }

  public async getAppointments(clinicianOrPatientId?: string): Promise<CalendarAppointment[]> {
    if (this.isDemoWorkspace()) {
      return [...this.demoAppointments];
    }
    if (!auth.currentUser) {
      return [];
    }
    const uid = clinicianOrPatientId || auth.currentUser.uid;

    try {
      const q = query(
        collection(db, 'appointments'),
        where('clinicianId', '==', uid)
      );
      const snap = await getDocs(q);
      const docs = snap.docs.map((d) => d.data() as CalendarAppointment);
      if (docs.length > 0) return docs;
    } catch (err) {
      console.warn('Failed to fetch appointments for clinician from Firestore:', err);
    }

    try {
      const qPatient = query(
        collection(db, 'appointments'),
        where('clientId', '==', uid)
      );
      const snapPatient = await getDocs(qPatient);
      const docsPatient = snapPatient.docs.map((d) => d.data() as CalendarAppointment);
      if (docsPatient.length > 0) return docsPatient;
    } catch (err) {
      console.warn('Failed to fetch appointments for patient from Firestore:', err);
    }

    return [];
  }

  public async saveAppointment(appt: CalendarAppointment): Promise<void> {
    if (this.isDemoWorkspace()) {
      const idx = this.demoAppointments.findIndex((a) => a.id === appt.id);
      if (idx >= 0) {
        this.demoAppointments[idx] = appt;
      } else {
        this.demoAppointments.unshift(appt);
      }
      return;
    }

    if (!auth.currentUser) throw new Error('Sign in to save an appointment');

    try {
      await setDoc(doc(db, 'appointments', appt.id), appt, { merge: true });
    } catch (err) {
      console.error('Failed to save appointment to Firestore:', err);
    }
  }

  public async saveAppointments(appts: CalendarAppointment[]): Promise<void> {
    if (this.isDemoWorkspace()) {
      this.demoAppointments = appts;
      return;
    }
    for (const a of appts) {
      await this.saveAppointment(a);
    }
  }

  public async deleteAppointment(id: string): Promise<void> {
    if (this.isDemoWorkspace()) {
      this.demoAppointments = this.demoAppointments.filter((a) => a.id !== id);
      return;
    }

    if (!auth.currentUser) throw new Error('Sign in to delete an appointment');

    try {
      await deleteDoc(doc(db, 'appointments', id));
    } catch (err) {
      console.error('Failed to delete appointment from Firestore:', err);
    }
  }

  public clearDemoData() {
    this.requireDemoWorkspace('Clearing sample data');
    this.demoClients = [];
    this.demoSessions = [];
    this.demoMessages = [];
    this.demoAppointments = [];
    this.demoBrand = BRAND_PRESETS[0];
  }

  public resetToDefaultSeed() {
    this.requireDemoWorkspace('Resetting sample data');
    this.demoClients = [...INITIAL_DEMO_CLIENTS];
    this.demoSessions = [...INITIAL_DEMO_SESSIONS];
    this.demoMessages = [...INITIAL_DEMO_MESSAGES];
    this.demoAppointments = [...INITIAL_DEMO_APPOINTMENTS];
    this.demoBrand = BRAND_PRESETS[0];
  }
}

export const storageEngine = new StorageEngine();
