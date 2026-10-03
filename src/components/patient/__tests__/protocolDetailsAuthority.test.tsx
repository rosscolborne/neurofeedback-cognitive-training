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

// A note a clinician saved with an assignment under the retired clinician product.
const withClinicianNote = (client: ClientProfile): ClientProfile => ({
  ...client, customProtocolConfig: { ...getClinicalProtocolTemplate('theta-beta-ratio')!, clinicalNotes: 'Keep sessions in the evening.' },
});
// A saved reward mode the training engine rejects.
const unrunnable = (client: ClientProfile): ClientProfile => ({
  ...client, customProtocolConfig: { ...getClinicalProtocolTemplate('theta-beta-ratio')!, customRewardEnabled: 'yes' as never },
});
const unlinked = () => createBlankProfile('patient-1', 'patient@example.com');
const legacyLinked = () => ({ ...unlinked(), clinicianId: 'clinician-1' });

describe('protocol details wording', () => {
  it.each([
    ['an unlinked patient', unlinked],
    ['a profile linked under the retired clinician product', legacyLinked],
  ] as const)('presents the protocol as the patient\'s own, with no clinician note or clinician contact, for %s', async (_who, client) => {
    const text = await details(withClinicianNote(client()));
    expect(text).toContain('Your protocol');
    expect(text).not.toContain('Your assigned protocol');
    expect(text).not.toContain('Note from your clinician');
    expect(text).not.toContain('Keep sessions in the evening.');
    const unavailable = await details(unrunnable(client()));
    expect(unavailable).toContain('Training unavailable.');
    expect(unavailable).toContain('Choose a protocol again in your training setup.');
    expect(unavailable).not.toContain('clinician');
  });
});
