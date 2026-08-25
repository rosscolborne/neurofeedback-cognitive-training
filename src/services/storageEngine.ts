import {
  ClientProfile,
  ClinicBrandConfig,
  MessageThread,
  MilestoneBadge,
  SessionRecord,
  CalendarAppointment,
} from '../types';
import { BRAND_PRESETS } from './brandEngine';

const STORAGE_KEYS = {
  BRAND: 'brainswell_brand_config',
  CLIENTS: 'brainswell_clients',
  SESSIONS: 'brainswell_sessions',
  MESSAGES: 'brainswell_messages',
  APPOINTMENTS: 'brainswell_appointments',
  CURRENT_CLIENT_ID: 'brainswell_current_client_id',
};

export const INITIAL_BADGES: MilestoneBadge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    description: 'Completed your very first neurofeedback training session.',
    category: 'consistency',
    iconName: 'Sparkles',
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

export const createBlankProfile = (uid: string, email: string): ClientProfile => {
  const username = (email.split('@')[0] || 'User')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: uid,
    name: username,
    email: email,
    avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
    condition: 'Peak Performance',
    status: 'active',
    assignedProtocol: 'theta-beta-ratio',
    allowedExperiences: [
      'skyline-drift',
      'tidal-garden',
      'breath-weave',
      'signal-sort',
      'rhythm-lock',
      'media-mode',
      'soundscape-mode',
      'mandala',
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
    allowedExperiences: ['skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock'],
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
    allowedExperiences: ['tidal-garden', 'breath-weave', 'soundscape-mode', 'mandala'],
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
    allowedExperiences: ['breath-weave', 'soundscape-mode', 'mandala'],
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
    allowedExperiences: ['signal-sort', 'rhythm-lock', 'skyline-drift'],
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
  public getBrandConfig(): ClinicBrandConfig {
    const raw = localStorage.getItem(STORAGE_KEYS.BRAND) || localStorage.getItem('brainwell_brand_config');
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

  public getClients(): ClientProfile[] {
    const raw = localStorage.getItem(STORAGE_KEYS.CLIENTS) || localStorage.getItem('brainwell_clients');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    // Return initial clinical seed data
    return INITIAL_DEMO_CLIENTS;
  }

  public saveClients(clients: ClientProfile[]) {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }

  public getCurrentClient(user?: { uid: string; email?: string | null } | null): ClientProfile {
    const clients = this.getClients();
    if (user?.uid) {
      const existing = clients.find((c) => c.id === user.uid || (user.email && c.email === user.email));
      if (existing) {
        if (existing.isDemo) {
          existing.isDemo = false;
          this.saveClients(clients);
        }
        return existing;
      }

      // Create new clean profile for this user
      const fresh = createBlankProfile(user.uid, user.email || 'user@brainswell.app');
      this.saveClients([fresh, ...clients]);
      return fresh;
    }

    const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_CLIENT_ID) || localStorage.getItem('brainwell_current_client_id');
    if (currentId) {
      const match = clients.find((c) => c.id === currentId);
      if (match) return match;
    }

    if (clients.length > 0) return clients[0];

    return createBlankProfile('default-patient', 'patient@brainswell.app');
  }

  public setCurrentClientId(id: string) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CLIENT_ID, id);
  }

  public getSessions(clientId?: string): SessionRecord[] {
    let all: SessionRecord[] = [];
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) all = parsed;
      } catch (e) {}
    } else {
      all = [...INITIAL_DEMO_SESSIONS];
    }

    if (clientId) {
      if (clientId.startsWith('demo-')) {
        // Return demo client sessions
        const match = all.filter(s => s.patientId === clientId);
        if (match.length > 0) return match;
        return INITIAL_DEMO_SESSIONS.filter(s => s.patientId === clientId);
      } else {
        // For real registered users, strictly return only their own recorded non-demo sessions
        return all.filter(s => s.patientId === clientId && !s.isDemo);
      }
    }

    return all.length > 0 ? all : INITIAL_DEMO_SESSIONS;
  }

  public saveSession(session: SessionRecord) {
    const sessions = this.getSessions();
    sessions.unshift(session);
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

    const clients = this.getClients();
    const client = clients.find((c) => c.id === session.patientId);
    if (client) {
      client.completedSessionsCount += 1;
      client.lastSessionDate = 'Just now';
      client.currentStreak += 1;
      const consistency = Math.min(100, (client.currentStreak / client.prescribedSessionsPerWeek) * 100);
      const newScore = Math.round(
        session.timeInZonePercent * 0.4 +
          consistency * 0.3 +
          session.peakFocusScore * 0.2 +
          session.averageCoherence * 0.1
      );
      client.brainCapacityScore = Math.max(30, Math.min(99, newScore));

      if (session.experience === 'tidal-garden' || session.protocol === 'alpha-enhancement') {
        client.tidalGardenState.growthPoints += Math.round(session.timeInZonePercent * 1.5);
        if (client.tidalGardenState.growthPoints > 300 && client.tidalGardenState.stage < 2)
          client.tidalGardenState.stage = 2;
        if (client.tidalGardenState.growthPoints > 500 && client.tidalGardenState.stage < 3)
          client.tidalGardenState.stage = 3;
        if (client.tidalGardenState.growthPoints > 800 && client.tidalGardenState.stage < 4)
          client.tidalGardenState.stage = 4;
      }
      this.saveClients(clients);
    }
  }

  public getMessages(): MessageThread[] {
    const raw = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return INITIAL_DEMO_MESSAGES;
  }

  public saveMessages(threads: MessageThread[]) {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(threads));
  }

  public getAppointments(): CalendarAppointment[] {
    const raw = localStorage.getItem(STORAGE_KEYS.APPOINTMENTS);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return INITIAL_DEMO_APPOINTMENTS;
  }

  public saveAppointments(appts: CalendarAppointment[]) {
    localStorage.setItem(STORAGE_KEYS.APPOINTMENTS, JSON.stringify(appts));
  }

  public saveAppointment(appt: CalendarAppointment) {
    const list = this.getAppointments();
    const idx = list.findIndex((a) => a.id === appt.id);
    if (idx >= 0) {
      list[idx] = appt;
    } else {
      list.unshift(appt);
    }
    this.saveAppointments(list);
  }

  public deleteAppointment(id: string) {
    const list = this.getAppointments().filter((a) => a.id !== id);
    this.saveAppointments(list);
  }

  public clearDemoData() {
    const clients = this.getClients().filter((c) => !c.isDemo);
    const sessions = this.getSessions().filter((s) => !s.isDemo);
    const messages = this.getMessages().filter((m) => !m.isDemo);
    const appointments = this.getAppointments().filter((a) => !a.isDemo);

    this.saveClients(clients);
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
    this.saveMessages(messages);
    this.saveAppointments(appointments);
  }

  public resetToDefaultSeed() {
    this.saveClients(INITIAL_DEMO_CLIENTS);
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(INITIAL_DEMO_SESSIONS));
    this.saveMessages(INITIAL_DEMO_MESSAGES);
    this.saveAppointments(INITIAL_DEMO_APPOINTMENTS);
  }
}

export const storageEngine = new StorageEngine();
