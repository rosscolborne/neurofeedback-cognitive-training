import { describe, expect, it } from 'vitest';
import type { ClientProfile, ProtocolCatalogEntry, ProtocolTemplate } from '../../types';
import { InMemoryProtocolCatalog, resolveAssignedProtocol } from '../protocolCatalog';

const protocol = (id: string, clinicId?: string): ProtocolTemplate => ({
  id,
  clinicId,
  name: id,
  clinicalName: id,
  leadInvestigator: '',
  indication: '',
  montageSite: 'Fz',
  rewardBand: { name: 'Beta', freqMin: 15, freqMax: 20, targetCondition: 'above', targetThreshold: 1 },
  adaptiveStep: 0.1,
  sensitivity: 'balanced',
  sessionDurationMinutes: 20,
  recommendedExperiences: [],
  clinicalNotes: '',
  version: clinicId ? 'clinic-v2' : 'system-v1',
  status: 'approved',
});

const client = (override?: ProtocolTemplate): ClientProfile => ({
  id: 'patient-1', name: '', email: '', avatarUrl: '', condition: 'Peak Performance', status: 'active',
  assignedProtocol: 'theta-beta-ratio', customProtocolConfig: override, clinicId: 'clinic-1', brainMaps: [],
  allowedExperiences: [], prescribedSessionsPerWeek: 0, completedSessionsCount: 0, currentStreak: 0,
  streakFreezeRemaining: 0, brainCapacityScore: 0, lastSessionDate: '', nextSessionDate: '',
  tidalGardenState: { stage: 1, plantsUnlocked: [], growthPoints: 0, lastWatered: '' },
  skylineBiomesUnlocked: [], badges: [],
});

describe('protocol catalog resolution', () => {
  const entries: ProtocolCatalogEntry[] = [
    { protocol: protocol('theta-beta-ratio'), source: 'system', revision: 'system-v1' },
    { protocol: protocol('theta-beta-ratio', 'clinic-1'), source: 'clinic', revision: 'clinic-v2' },
  ];

  it('prefers a matching clinic revision over the system revision', async () => {
    const resolved = await resolveAssignedProtocol(client(), new InMemoryProtocolCatalog(entries));
    expect(resolved?.source).toBe('clinic');
    expect(resolved?.revision).toBe('clinic-v2');
  });

  it('keeps a patient override authoritative without querying replacement data', async () => {
    const override = { ...protocol('custom'), version: 'patient-v3' };
    const resolved = await resolveAssignedProtocol(client(override), new InMemoryProtocolCatalog(entries));
    expect(resolved).toEqual({ protocol: override, source: 'patient-override', revision: 'patient-v3' });
  });
});
