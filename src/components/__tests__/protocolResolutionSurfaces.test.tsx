import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ClientProfile, ClinicBrandConfig } from '../../types';

vi.mock('../../services/storageEngine', () => ({ storageEngine: {
  getSessions: vi.fn().mockResolvedValue([]),
  getBrainMaps: vi.fn().mockResolvedValue([]),
} }));

import { ClientRosterView } from '../clinician/ClientRosterView';
import { ClientDetailView } from '../clinician/ClientDetailView';
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
  let roster!: ReactTestRenderer;
  let detail!: ReactTestRenderer;
  let patient!: ReactTestRenderer;
  await act(async () => {
    roster = create(<ClientRosterView clients={[client]} invitations={[]} onSelectClient={vi.fn()} onAddClient={vi.fn()} onCancelInvitation={vi.fn()} />);
    detail = create(<ClientDetailView client={client} brand={{ name: 'Clinic' } as ClinicBrandConfig} onBack={vi.fn()} onUpdateClient={vi.fn()} onSendMessage={vi.fn()} />);
    patient = create(<HomeScreen client={client} onStartSession={vi.fn()} />);
  });
  const result = {
    roster: JSON.stringify(roster.toJSON()),
    detail: JSON.stringify(detail.toJSON()),
    patient: JSON.stringify(patient.toJSON()),
  };
  roster.unmount();
  detail.unmount();
  patient.unmount();
  return result;
}

describe('shared protocol resolution on care surfaces', () => {
  it('shows and trains the same deterministic default when no protocol was saved', async () => {
    const views = await renderViews(base);
    const runtime = resolveProtocolRuntime(base);
    expect(runtime).toMatchObject({ ok: true, config: { protocol: 'theta-beta-ratio' } });
    const defaultName = getClinicalProtocolTemplate('theta-beta-ratio')!.name;
    expect(views.roster).toContain(defaultName);
    expect(views.detail).toContain(defaultName);
    expect(views.patient).toContain(defaultName);
    expect(views.patient).toContain('Begin Session');
    expect(views.roster).toContain('ADHD (Inattentive)');
    expect(views.detail).toContain('ADHD (Inattentive)');
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
    expect(views.roster).toContain(customName);
    expect(views.detail).toContain(customName);
    expect(views.patient).toContain(customName);
    expect(views.patient).toContain('Evening Alpha');
    expect(views.roster).toContain('Generalized Anxiety');
    expect(views.detail).toContain('Generalized Anxiety');
  });
});
