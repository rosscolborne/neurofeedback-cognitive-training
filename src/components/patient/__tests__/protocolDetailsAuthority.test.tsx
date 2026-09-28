import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { createBlankProfile } from '../../../services/storageEngine';
import { getClinicalProtocolTemplate } from '../../../services/clinicalProtocolTemplates';
import { ProtocolDetailsModal } from '../ProtocolDetailsModal';

async function details(client: ClientProfile) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ProtocolDetailsModal client={client} onClose={vi.fn()} />); });
  const text = JSON.stringify(renderer.toJSON());
  await act(async () => { renderer.unmount(); });
  return text;
}

afterEach(() => vi.unstubAllGlobals());

// A clinician-edited note, as kept on the profile after the clinician unlinks (existing unlink policy).
const withClinicianNote = (client: ClientProfile): ClientProfile => ({
  ...client, customProtocolConfig: { ...getClinicalProtocolTemplate('theta-beta-ratio')!, clinicalNotes: 'Keep sessions in the evening.' },
});
// A saved reward mode the training engine rejects.
const unrunnable = (client: ClientProfile): ClientProfile => ({
  ...client, customProtocolConfig: { ...getClinicalProtocolTemplate('theta-beta-ratio')!, customRewardEnabled: 'yes' as never },
});

describe('protocol details authority wording', () => {
  it('does not present a self-directed protocol as assigned or show clinician notes without a clinician', async () => {
    const text = await details(withClinicianNote(createBlankProfile('patient-1', 'patient@example.com')));
    expect(text).toContain('Your self-directed protocol');
    expect(text).not.toContain('Your assigned protocol');
    expect(text).not.toContain('Note from your clinician');
    expect(text).not.toContain('Keep sessions in the evening.');
    const unavailable = await details(unrunnable(createBlankProfile('patient-1', 'patient@example.com')));
    expect(unavailable).toContain('Training unavailable.');
    expect(unavailable).not.toContain('contact your clinician');
  });

  it('keeps the assigned-protocol wording and clinician notes for a linked patient', async () => {
    const linked = { ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-1' };
    const text = await details(withClinicianNote(linked));
    expect(text).toContain('Your assigned protocol');
    expect(text).toContain('Note from your clinician');
    expect(text).toContain('Keep sessions in the evening.');
    expect(await details(unrunnable(linked))).toContain('Please contact your clinician.');
  });
});
