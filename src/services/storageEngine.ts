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
} from '../types';
import { BRAND_PRESETS } from './brandEngine';
import { auth, db } from './firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
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
} from './dataMappers';

const STORAGE_KEYS = {
  BRAND: 'waveable_brand_config',
  CLIENTS: 'waveable_clients',
  SESSIONS: 'waveable_sessions',
  MESSAGES: 'waveable_messages',
  APPOINTMENTS: 'waveable_appointments',
  CURRENT_CLIENT_ID: 'waveable_current_client_id',
};

// Invitation addresses are stored and compared case-normalized. Firestore rules
// still require the Firebase Auth token's canonical email to match exactly.
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
    avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
    condition: 'Peak Performance',
    status: 'active',
    assignedProtocol: 'theta-beta-ratio',
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
    prescribedSessionsPerWeek: 4,
    completedSessionsCount: 0,
    currentStreak: 0,
    streakFreezeRemaining: 1,
    brainCapacityScore: 50,
    lastSessionDate: 'No sessions yet',
    nextSessionDate: 'Ready to train',
    brainMaps: [],
    tidalGardenState: {
      stage: 1,
      plantsUnlocked: ['amber-coral'],
      growthPoints: 0,
      lastWatered: new Date().toISOString().split('T')[0],
    },
    skylineBiomesUnlocked: ['Alpine Meadows'],
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
    id: 'sess-001',
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
    id: 'sess-002',
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
    id: 'sess-003',
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
    id: 'sess-004',
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
    id: 'appt-001',
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
    id: 'appt-002',
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
    id: 'appt-003',
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
    id: 'appt-004',
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

  public getBrandConfig(): ClinicBrandConfig {
    const raw = localStorage.getItem(STORAGE_KEYS.BRAND) || localStorage.getItem('brainswell_brand_config') || localStorage.getItem('brainwell_brand_config');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return BRAND_PRESETS[0];
  }

  public saveBrandConfig(brand: ClinicBrandConfig) {
    localStorage.setItem(STORAGE_KEYS.BRAND, JSON.stringify(brand));
  }

  public async getClinicBrandConfig(clinicId: string): Promise<ClinicBrandConfig> {
    const clinic = await this.getClinic(clinicId);
    return clinic?.branding ?? this.getBrandConfig();
  }

  public async saveClinicBrandConfig(brand: ClinicBrandConfig): Promise<void> {
    this.saveBrandConfig(brand);
    if (!auth.currentUser || auth.currentUser.uid === 'demo-clinician') return;
    await setDoc(
      doc(db, 'clinics', brand.clinicId),
      { branding: removeUndefined({ ...brand, updatedAt: serverTimestamp() }), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  public async getClinic(clinicId: string): Promise<ClinicProfile | null> {
    if (!auth.currentUser || auth.currentUser.uid === 'demo-clinician') return null;
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
    if (!auth.currentUser || auth.currentUser.uid === 'demo-clinician') return;
    await setDoc(
      doc(db, 'clinics', clinic.id),
      removeUndefined({ ...clinic, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  }

  public async getPractitioner(practitionerId: string): Promise<PractitionerProfile | null> {
    if (!auth.currentUser || auth.currentUser.uid === 'demo-clinician') return null;
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
    if (!auth.currentUser || auth.currentUser.uid === 'demo-clinician') return;
    await setDoc(
      doc(db, 'practitioners', practitioner.id),
      removeUndefined({ ...practitioner, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  }

  private async canManagePatient(patientId: string): Promise<boolean> {
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
    if (patientId.startsWith('demo-') || !(await this.canManagePatient(patientId))) return null;
    const snapshot = await getDoc(doc(db, 'deviceAssignments', patientId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<DeviceAssignment>;
    if (!data.deviceId || !data.model) return null;
    return { ...data, patientId, deviceId: data.deviceId, model: data.model };
  }

  public async saveDeviceAssignment(assignment: DeviceAssignment): Promise<void> {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId || assignment.patientId.startsWith('demo-')) return;
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
    if (id.startsWith('demo-') || !auth.currentUser) {
      return this.demoClients.find((c) => c.id === id) || null;
    }
    try {
      const snap = await getDoc(doc(db, 'clients', id));
      if (snap.exists()) {
        return readClientProfile(snap.data(), snap.id);
      }
    } catch (err) {
      console.warn('Failed to fetch client from Firestore:', err);
    }
    return null;
  }

  public async getClients(clinicianId?: string): Promise<ClientProfile[]> {
    const activeClinicianId = clinicianId || auth.currentUser?.uid;
    if (activeClinicianId === 'demo-clinician') {
      return [...this.demoClients];
    }
    if (!activeClinicianId) {
      return [];
    }

    const owned = new Map<string, ClientProfile>();
    try {
      const canonical = await getDocs(
        query(collection(db, 'clients'), where('clinicianId', '==', activeClinicianId))
      );
      canonical.docs.forEach((entry) => {
        const profile = readClientProfile(entry.data(), entry.id);
        if (getPatientClinicianId(profile) === activeClinicianId) owned.set(profile.id, profile);
      });
    } catch (err) {
      console.warn('Failed to fetch canonical clients from Firestore:', err);
    }

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
    } catch (err) {
      console.warn('Failed to fetch legacy clients from Firestore:', err);
    }
    return [...owned.values()];
  }

  public async createPatientInvitation(input: PatientInvitationInput): Promise<PatientInvitation> {
    const clinician = auth.currentUser;
    if (!clinician || clinician.uid === 'demo-clinician') {
      throw new Error('A real clinician account is required to invite a patient');
    }

    const patientEmail = normalizeEmail(input.patientEmail);
    if (!patientEmail) throw new Error('Patient email is required');
    if (patientEmail.includes('/')) throw new Error('Patient email contains unsupported characters');
    if (patientEmail === normalizeEmail(clinician.email || '')) {
      throw new Error('You cannot invite your own clinician account as a patient');
    }
    if (!input.patientName.trim()) throw new Error('Patient name is required');
    if (!Number.isInteger(input.prescribedSessionsPerWeek) || input.prescribedSessionsPerWeek < 1) {
      throw new Error('Weekly sessions must be a positive whole number');
    }

    const now = Date.now();
    const uniquenessClaimId = patientEmail;

    const invitation: PatientInvitation = {
      id: createInvitationCode(),
      clinicianId: clinician.uid,
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
    const clinicianId = auth.currentUser?.uid;
    if (!clinicianId || clinicianId === 'demo-clinician') return [];
    const snapshot = await getDocs(
      query(collection(db, 'patientInvitations'), where('clinicianId', '==', clinicianId))
    );
    return snapshot.docs
      .map((entry) => readPatientInvitation(entry.data(), entry.id))
      .sort((a, b) => (timestampToMillis(b.createdAt) ?? 0) - (timestampToMillis(a.createdAt) ?? 0));
  }

  public async cancelPatientInvitation(invitationId: string): Promise<void> {
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
      { clinicianId: null, linkedClinicianCode: null, acceptedInvitationId: null, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  public async acceptPatientInvitation(invitationCode: string, fallbackClient: ClientProfile): Promise<ClientProfile> {
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
        const clientSnapshot = await transaction.get(clientRef);
        const current = clientSnapshot.exists()
          ? readClientProfile(clientSnapshot.data(), clientSnapshot.id)
          : { ...fallbackClient, id: patient.uid, patientId: patient.uid, email: patientEmail };
        const currentClinicianId = getPatientClinicianId(current);

        if (invitation.status === 'accepted') {
          if (
            invitation.patientId === patient.uid &&
            currentClinicianId === invitation.clinicianId &&
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
    if (client.isDemo || client.id.startsWith('demo-') || auth.currentUser?.uid === 'demo-clinician' || !auth.currentUser) {
      const idx = this.demoClients.findIndex((c) => c.id === client.id);
      if (idx >= 0) {
        this.demoClients[idx] = client;
      } else {
        this.demoClients.unshift(client);
      }
      return;
    }

    try {
      await setDoc(doc(db, 'clients', client.id), client, { merge: true });
    } catch (err) {
      console.error('Failed to save client to Firestore:', err);
    }
  }

  public async saveClients(clients: ClientProfile[]): Promise<void> {
    const demo = clients.filter((c) => c.isDemo || c.id.startsWith('demo-'));
    this.demoClients = demo.length > 0 ? demo : clients;

    const realClients = clients.filter((c) => !c.isDemo && !c.id.startsWith('demo-'));
    for (const c of realClients) {
      await this.saveClient(c);
    }
  }

  public async deleteClient(id: string): Promise<void> {
    if (id.startsWith('demo-') || auth.currentUser?.uid === 'demo-clinician' || !auth.currentUser) {
      this.demoClients = this.demoClients.filter((c) => c.id !== id);
      return;
    }

    try {
      await deleteDoc(doc(db, 'clients', id));
    } catch (err) {
      console.error('Failed to delete client from Firestore:', err);
    }
  }

  public async getCurrentClient(user?: { uid: string; email?: string | null; displayName?: string | null } | null): Promise<ClientProfile | null> {
    if (user?.uid) {
      if (user.uid === 'demo-clinician') {
        return this.demoClients[0] || null;
      }

      try {
        const snap = await getDoc(doc(db, 'clients', user.uid));
        if (snap && snap.exists()) {
          const existing = readClientProfile(snap.data(), snap.id);
          if (!existing.name && user.displayName) {
            existing.name = user.displayName
              .trim()
              .replace(/[._]/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());
            setDoc(doc(db, 'clients', user.uid), existing, { merge: true }).catch(() => {});
          }
          return existing;
        }
      } catch (err) {
        console.warn('Failed to fetch client record from Firestore:', err);
      }

      // Initialize new Firestore client profile
      const fresh = createBlankProfile(user.uid, user.email || 'user@waveable.app', user.displayName);
      fresh.patientId = user.uid;
      try {
        await setDoc(doc(db, 'clients', user.uid), fresh);
      } catch (err) {
        console.warn('Failed to initialize client profile in Firestore:', err);
      }
      return fresh;
    }

    return null;
  }

  public setCurrentClientId(id: string) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CLIENT_ID, id);
  }

  public async getSessionsFor(scope: SessionQueryScope): Promise<SessionRecord[]> {
    const demoPatientId = 'patientId' in scope ? scope.patientId : undefined;
    const isDemoScope =
      auth.currentUser?.uid === 'demo-clinician' ||
      demoPatientId?.startsWith('demo-') ||
      ('clinicianId' in scope && scope.clinicianId === 'demo-clinician');

    if (isDemoScope) {
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
        snapshots.push(
          await getDocs(query(collection(db, 'sessions'), where('clinicianId', '==', scope.clinicianId)))
        );
        const roster = await getDocs(
          query(collection(db, 'clients'), where('clinicianId', '==', scope.clinicianId))
        );
        const legacySnapshots = await Promise.all(
          roster.docs.map((client) =>
            getDocs(query(collection(db, 'sessions'), where('patientId', '==', client.id)))
          )
        );
        snapshots.push(...legacySnapshots);
      } else if (scope.patientId) {
        const patient = await getDoc(doc(db, 'clients', scope.patientId));
        if (!patient.exists() || readClientProfile(patient.data(), patient.id).clinicId !== scope.clinicId) return [];
        snapshots.push(await getDocs(query(collection(db, 'sessions'), where('patientId', '==', scope.patientId))));
      } else {
        snapshots.push(await getDocs(query(collection(db, 'sessions'), where('clinicId', '==', scope.clinicId))));
      }

      const unique = new Map<string, SessionRecord>();
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) {
          unique.set(entry.id, readSessionRecord(entry.data(), entry.id));
        }
      }
      return [...unique.values()]
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      console.warn('Failed to fetch sessions from Firestore:', err);
      return [];
    }
  }

  /**
   * Backward-compatible query surface. Supplying a client ID is patient-scoped;
   * omitting it is clinician-scoped, which fixes cohort reports for real users.
   */
  public async getSessions(clientId?: string): Promise<SessionRecord[]> {
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
      session.patientId.startsWith('demo-') ||
      auth.currentUser?.uid === 'demo-clinician' ||
      !auth.currentUser;

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
      (this.demoSessions[demoIndex].isDemo ||
        this.demoSessions[demoIndex].patientId.startsWith('demo-') ||
        auth.currentUser?.uid === 'demo-clinician' ||
        !auth.currentUser);

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
    if (auth.currentUser?.uid === 'demo-clinician') {
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
    if (thread.isDemo || thread.clientId.startsWith('demo-') || auth.currentUser?.uid === 'demo-clinician' || !auth.currentUser) {
      const idx = this.demoMessages.findIndex((t) => t.clientId === thread.clientId);
      if (idx >= 0) {
        this.demoMessages[idx] = thread;
      } else {
        this.demoMessages.unshift(thread);
      }
      return;
    }

    try {
      await setDoc(doc(db, 'messages', thread.clientId), thread, { merge: true });
    } catch (err) {
      console.error('Failed to save message thread to Firestore:', err);
    }
  }

  public async saveMessages(threads: MessageThread[]): Promise<void> {
    const demo = threads.filter((t) => t.isDemo || t.clientId.startsWith('demo-'));
    this.demoMessages = demo.length > 0 ? demo : threads;

    const realThreads = threads.filter((t) => !t.isDemo && !t.clientId.startsWith('demo-'));
    for (const t of realThreads) {
      await this.saveMessageThread(t);
    }
  }

  public subscribeToMessages(callback: (threads: MessageThread[]) => void, role?: 'clinician' | 'patient' | null): () => void {
    if (auth.currentUser?.uid === 'demo-clinician') {
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
      (err) => {
        callback([]);
      }
    );

    return unsubscribe;
  }

  public async getAppointments(clinicianOrPatientId?: string): Promise<CalendarAppointment[]> {
    if (auth.currentUser?.uid === 'demo-clinician') {
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
    if (appt.isDemo || appt.clientId.startsWith('demo-') || !auth.currentUser) {
      const idx = this.demoAppointments.findIndex((a) => a.id === appt.id);
      if (idx >= 0) {
        this.demoAppointments[idx] = appt;
      } else {
        this.demoAppointments.unshift(appt);
      }
      return;
    }

    try {
      await setDoc(doc(db, 'appointments', appt.id), appt, { merge: true });
    } catch (err) {
      console.error('Failed to save appointment to Firestore:', err);
    }
  }

  public async saveAppointments(appts: CalendarAppointment[]): Promise<void> {
    const demo = appts.filter((a) => a.isDemo || a.clientId.startsWith('demo-'));
    this.demoAppointments = demo.length > 0 ? demo : appts;

    const realAppts = appts.filter((a) => !a.isDemo && !a.clientId.startsWith('demo-'));
    for (const a of realAppts) {
      await this.saveAppointment(a);
    }
  }

  public async deleteAppointment(id: string): Promise<void> {
    if (id.startsWith('demo-') || !auth.currentUser) {
      this.demoAppointments = this.demoAppointments.filter((a) => a.id !== id);
      return;
    }

    try {
      await deleteDoc(doc(db, 'appointments', id));
    } catch (err) {
      console.error('Failed to delete appointment from Firestore:', err);
    }
  }

  public clearDemoData() {
    this.demoClients = [];
    this.demoSessions = [];
    this.demoMessages = [];
    this.demoAppointments = [];
  }

  public resetToDefaultSeed() {
    this.demoClients = [...INITIAL_DEMO_CLIENTS];
    this.demoSessions = [...INITIAL_DEMO_SESSIONS];
    this.demoMessages = [...INITIAL_DEMO_MESSAGES];
    this.demoAppointments = [...INITIAL_DEMO_APPOINTMENTS];
  }
}

export const storageEngine = new StorageEngine();
