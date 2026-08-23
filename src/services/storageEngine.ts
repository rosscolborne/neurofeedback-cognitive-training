import { ClientProfile, ClinicBrandConfig, MessageThread, MilestoneBadge, SessionRecord } from '../types';
import { BRAND_PRESETS } from './brandEngine';

const STORAGE_KEYS = {
  BRAND: 'neura_brand_config',
  CLIENTS: 'neura_clients',
  SESSIONS: 'neura_sessions',
  MESSAGES: 'neura_messages',
  CURRENT_CLIENT_ID: 'neura_current_client_id',
};

export const INITIAL_BADGES: MilestoneBadge[] = [
  {
    id: 'first-light',
    title: 'First Light',
    description: 'Completed your very first neurofeedback training session.',
    category: 'consistency',
    iconName: 'Sparkles',
    unlockedAt: '2026-08-18T14:30:00Z',
  },
  {
    id: 'steady-state',
    title: 'Steady State',
    description: 'Maintained a 7-day training consistency streak.',
    category: 'consistency',
    iconName: 'Waves',
    unlockedAt: '2026-08-21T09:15:00Z',
  },
  {
    id: 'deep-focus',
    title: 'Deep Focus Master',
    description: 'Achieved 80%+ time-in-zone in a Theta/Beta session.',
    category: 'focus',
    iconName: 'Target',
    unlockedAt: '2026-08-20T16:45:00Z',
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
    unlockedAt: '2026-08-19T11:00:00Z',
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

export const INITIAL_CLIENTS: ClientProfile[] = [
  {
    id: 'client-sarah-mitchell',
    name: 'Sarah Mitchell',
    email: 'sarah.m@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    condition: 'ADHD (Inattentive)',
    status: 'active',
    assignedProtocol: 'theta-beta-ratio',
    allowedExperiences: ['skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'mandala'],
    prescribedSessionsPerWeek: 4,
    completedSessionsCount: 14,
    currentStreak: 6,
    streakFreezeRemaining: 1,
    brainCapacityScore: 78,
    lastSessionDate: 'Today, 9:30 AM',
    nextSessionDate: 'Tomorrow, 9:00 AM',
    customThresholdBounds: { min: 1.2, max: 2.2 },
    brainMaps: [
      {
        id: 'qeeg-sarah-01',
        uploadDate: 'Aug 10, 2026',
        fileName: 'Sarah_Mitchell_19Ch_QEEG_Baseline.edf',
        recordingDate: 'Aug 10, 2026',
        deviceSource: 'Deymed 19-Ch QEEG TruScan',
        technicianNotes: 'Elevated frontal theta excess (4-8Hz) in Fz and Cz (Z = +2.4). Individual Alpha Peak at 9.8 Hz.',
        zScores: {
          frontalTheta: 2.4,
          centralBeta: 0.3,
          occipitalAlpha: -0.8,
          temporalDelta: 0.5,
          sensorimotorSMR: 0.9,
        },
        dominantAlphaPeakHz: 9.8,
      },
    ],
    tidalGardenState: {
      stage: 3,
      plantsUnlocked: ['amber-coral', 'luminous-kelp', 'biolum-anemone'],
      growthPoints: 420,
      lastWatered: '2026-08-22',
    },
    skylineBiomesUnlocked: ['Alpine Meadows', 'Coastline Cliffs', 'Whispering Forest'],
    badges: ['first-light', 'steady-state', 'deep-focus', 'garden-keeper'],
  },
  {
    id: 'client-david-miller',
    name: 'David Miller',
    email: 'david.m@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    condition: 'Generalized Anxiety',
    status: 'active',
    assignedProtocol: 'alpha-enhancement',
    allowedExperiences: ['tidal-garden', 'breath-weave', 'soundscape-mode', 'mandala'],
    prescribedSessionsPerWeek: 3,
    completedSessionsCount: 9,
    currentStreak: 4,
    streakFreezeRemaining: 1,
    brainCapacityScore: 72,
    lastSessionDate: 'Yesterday, 4:15 PM',
    nextSessionDate: 'Aug 24, 4:00 PM',
    customThresholdBounds: { min: 8.0, max: 16.0 },
    brainMaps: [
      {
        id: 'qeeg-david-01',
        uploadDate: 'Aug 05, 2026',
        fileName: 'David_Miller_QEEG_Discovery.edf',
        recordingDate: 'Aug 05, 2026',
        deviceSource: 'BrainMaster Discovery 24E',
        technicianNotes: 'Deficit in posterior occipital alpha rhythm (Z = -2.1). High-beta somatic tension noted in C3/C4.',
        zScores: {
          frontalTheta: 0.6,
          centralBeta: 1.8,
          occipitalAlpha: -2.1,
          temporalDelta: 0.2,
          sensorimotorSMR: -0.4,
        },
        dominantAlphaPeakHz: 10.4,
      },
    ],
    tidalGardenState: {
      stage: 2,
      plantsUnlocked: ['amber-coral', 'luminous-kelp'],
      growthPoints: 260,
      lastWatered: '2026-08-21',
    },
    skylineBiomesUnlocked: ['Alpine Meadows'],
    badges: ['first-light', 'steady-state'],
  },
  {
    id: 'client-elena-rostova',
    name: 'Elena Rostova',
    email: 'elena.r@example.com',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    condition: 'Peak Performance',
    status: 'active',
    assignedProtocol: 'smr-enhancement',
    allowedExperiences: ['signal-sort', 'rhythm-lock', 'skyline-drift', 'media-mode'],
    prescribedSessionsPerWeek: 5,
    completedSessionsCount: 22,
    currentStreak: 12,
    streakFreezeRemaining: 0,
    brainCapacityScore: 88,
    lastSessionDate: 'Aug 21, 8:00 AM',
    nextSessionDate: 'Today, 6:00 PM',
    customThresholdBounds: { min: 5.0, max: 12.0 },
    brainMaps: [],
    tidalGardenState: {
      stage: 4,
      plantsUnlocked: ['amber-coral', 'luminous-kelp', 'biolum-anemone', 'deep-drift-reed'],
      growthPoints: 680,
      lastWatered: '2026-08-21',
    },
    skylineBiomesUnlocked: ['Alpine Meadows', 'Coastline Cliffs', 'Whispering Forest', 'Sunset Dunes'],
    badges: ['first-light', 'steady-state', 'deep-focus'],
  },
  {
    id: 'client-marcus-chen',
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
];

export const INITIAL_MESSAGES: MessageThread[] = [
  {
    clientId: 'client-sarah-mitchell',
    clientName: 'Sarah Mitchell',
    clientAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    lastMessageTime: 'Today 9:45 AM',
    unreadCount: 1,
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
        text: "That is positive neuroplastic adaptation in action. I have adjusted your adaptive threshold slightly to challenge your sustained focus duration.",
        timestamp: 'Aug 22, 9:10 AM',
        isRead: true,
      },
      {
        id: 'm4',
        sender: 'patient',
        text: 'Just completed my session today: 82% time in zone.',
        timestamp: 'Today 9:45 AM',
        isRead: false,
      },
    ],
  },
  {
    clientId: 'client-david-miller',
    clientName: 'David Miller',
    clientAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    lastMessageTime: 'Aug 20, 2:15 PM',
    unreadCount: 0,
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
        text: 'It is very relaxing. Seeing the corals glow when my mind quiets down provides clear feedback.',
        timestamp: 'Aug 20, 2:15 PM',
        isRead: true,
      },
    ],
  },
];

export const INITIAL_SESSIONS: SessionRecord[] = [
  {
    id: 'sess-001',
    patientId: 'client-sarah-mitchell',
    patientName: 'Sarah Mitchell',
    clinicId: 'evolve-brain-training',
    date: 'Aug 22, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 2,
    protocol: 'theta-beta-ratio',
    experience: 'skyline-drift',
    durationSeconds: 1500, // 25 min
    timeInZonePercent: 82,
    averageCoherence: 78,
    peakFocusScore: 88,
    averageBands: { delta: 12.1, theta: 7.4, alpha: 11.2, smr: 6.8, beta: 9.6, gamma: 4.2 },
    timeSeries: Array.from({ length: 25 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: Math.max(1.1, 2.1 - i * 0.03 + (Math.random() - 0.5) * 0.2),
      alpha: 10.0 + Math.sin(i) * 2.0,
      smr: 6.0 + i * 0.05,
      beta: 8.5 + i * 0.08,
      inZone: i > 3 && Math.random() > 0.15,
    })),
    adaptiveAdjustmentsCount: 1,
    finalThreshold: 1.77,
    moodRating: 5,
    patientNotes: 'Smooth focus trajectory. Alpine biome lighting was clear.',
    clinicianNotes: 'Notable reduction in theta bursts during mid-flight.',
  },
  {
    id: 'sess-002',
    patientId: 'client-sarah-mitchell',
    patientName: 'Sarah Mitchell',
    clinicId: 'evolve-brain-training',
    date: 'Aug 21, 2026',
    timestamp: Date.now() - 1000 * 60 * 60 * 26,
    protocol: 'theta-beta-ratio',
    experience: 'media-mode',
    durationSeconds: 1500,
    timeInZonePercent: 76,
    averageCoherence: 74,
    peakFocusScore: 81,
    averageBands: { delta: 13.0, theta: 8.1, alpha: 10.5, smr: 6.2, beta: 8.8, gamma: 3.9 },
    timeSeries: Array.from({ length: 25 }, (_, i) => ({
      t: i * 60,
      thetaBetaRatio: 1.9 - i * 0.02,
      alpha: 9.5,
      smr: 5.8,
      beta: 8.1,
      inZone: Math.random() > 0.25,
    })),
    adaptiveAdjustmentsCount: 0,
    finalThreshold: 1.85,
    moodRating: 4,
    patientNotes: 'Trained while watching an educational nature documentary.',
  },
];

class StorageEngine {
  public getBrandConfig(): ClinicBrandConfig {
    const raw = localStorage.getItem(STORAGE_KEYS.BRAND);
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
    const raw = localStorage.getItem(STORAGE_KEYS.CLIENTS);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return INITIAL_CLIENTS;
  }

  public saveClients(clients: ClientProfile[]) {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }

  public getCurrentClient(): ClientProfile {
    const clients = this.getClients();
    const id = localStorage.getItem(STORAGE_KEYS.CURRENT_CLIENT_ID) || clients[0]?.id;
    return clients.find(c => c.id === id) || clients[0];
  }

  public setCurrentClientId(id: string) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_CLIENT_ID, id);
  }

  public getSessions(): SessionRecord[] {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return INITIAL_SESSIONS;
  }

  public saveSession(session: SessionRecord) {
    const sessions = this.getSessions();
    sessions.unshift(session);
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

    const clients = this.getClients();
    const client = clients.find(c => c.id === session.patientId);
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
        if (client.tidalGardenState.growthPoints > 300 && client.tidalGardenState.stage < 2) client.tidalGardenState.stage = 2;
        if (client.tidalGardenState.growthPoints > 500 && client.tidalGardenState.stage < 3) client.tidalGardenState.stage = 3;
        if (client.tidalGardenState.growthPoints > 800 && client.tidalGardenState.stage < 4) client.tidalGardenState.stage = 4;
      }
      this.saveClients(clients);
    }
  }

  public getMessages(): MessageThread[] {
    const raw = localStorage.getItem(STORAGE_KEYS.MESSAGES);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return INITIAL_MESSAGES;
  }

  public saveMessages(threads: MessageThread[]) {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(threads));
  }
}

export const storageEngine = new StorageEngine();
