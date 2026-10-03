import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../types';

vi.mock('../../services/storageEngine', () => ({ storageEngine: {
  getSessions: vi.fn().mockResolvedValue([]),
  getBrainMaps: vi.fn().mockResolvedValue([]),
} }));

import { HomeScreen } from '../patient/HomeScreen';
import { resolveProtocolRuntime } from '../../services/adaptiveEngine';
import { getClinicalProtocolTemplate } from '../../services/clinicalProtocolTemplates';

const base: ClientProfile = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com',
  condition: 'ADHD (Inattentive)', status: 'active',
  allowedExperiences: ['neuro-gambit'], brainMaps: [], badges: [],
  completedSessionsCount: 0, currentStreak: 0,
};

async function renderViews(client: ClientProfile) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let patient!: ReactTestRenderer;
  await act(async () => {
    patient = create(<HomeScreen client={client} onStartSession={vi.fn()} />);
  });
  const result = { patient: JSON.stringify(patient.toJSON()) };
  patient.unmount();
  return result;
}

describe('protocol resolution on the patient Home', () => {
  it('shows and trains the same deterministic default when no protocol was saved', async () => {
    const views = await renderViews(base);
    const runtime = resolveProtocolRuntime(base);
    expect(runtime).toMatchObject({ ok: true, config: { protocol: 'theta-beta-ratio' } });
    const defaultName = getClinicalProtocolTemplate('theta-beta-ratio')!.name;
    expect(views.patient).toContain(defaultName);
    expect(views.patient).toContain('Begin Session');
  });

  it('shows and trains the custom assigned protocol over the default', async () => {
    const client: ClientProfile = {
      ...base,
      condition: 'Generalized Anxiety',
      assignedProtocol: 'alpha-enhancement',
      customProtocolConfig: { ...getClinicalProtocolTemplate('alpha-enhancement')!, alias: 'Evening Alpha' },
    };
    const views = await renderViews(client);
    expect(resolveProtocolRuntime(client)).toMatchObject({ ok: true, config: { protocol: 'alpha-enhancement' } });
    const customName = getClinicalProtocolTemplate('alpha-enhancement')!.name;
    expect(views.patient).toContain(customName);
    expect(views.patient).toContain('Evening Alpha');
  });
});
