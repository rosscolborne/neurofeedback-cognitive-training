import { ClientProfile, ClinicBrandConfig, MessageThread, MilestoneBadge, SessionRecord } from '../types';
import { BRAND_PRESETS } from './brandEngine';

const STORAGE_KEYS = {
  BRAND: 'brainwell_brand_config',
  CLIENTS: 'brainwell_clients',
  SESSIONS: 'brainwell_sessions',
  MESSAGES: 'brainwell_messages',
  CURRENT_CLIENT_ID: 'brainwell_current_client_id',
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
  };
};

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
    return [];
  }

  public saveClients(clients: ClientProfile[]) {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }

  public getCurrentClient(user?: { uid: string; email?: string | null } | null): ClientProfile {
    const clients = this.getClients();
    if (user?.uid) {
      const existing = clients.find((c) => c.id === user.uid || c.email === user.email);
      if (existing) return existing;

      // Create new clean profile for this user
      const fresh = createBlankProfile(user.uid, user.email || 'user@brainwell.app');
      this.saveClients([fresh, ...clients]);
      return fresh;
    }

    const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_CLIENT_ID);
    if (currentId) {
      const match = clients.find((c) => c.id === currentId);
      if (match) return match;
    }

    if (clients.length > 0) return clients[0];

    // Fallback default clean profile
    return createBlankProfile('default-patient', 'patient@brainwell.app');
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
    return [];
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
        return JSON.parse(raw);
      } catch (e) {}
    }
    return [];
  }

  public saveMessages(threads: MessageThread[]) {
    localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(threads));
  }
}

export const storageEngine = new StorageEngine();
