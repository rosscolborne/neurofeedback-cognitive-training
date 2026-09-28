import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientProfile } from '../../../types';
import { createBlankProfile } from '../../../services/storageEngine';
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

describe('protocol details authority wording', () => {
  it('does not present a self-directed protocol as assigned or show clinician notes without a clinician', async () => {
    const text = await details(createBlankProfile('patient-1', 'patient@example.com'));
    expect(text).toContain('Your self-directed protocol');
    expect(text).not.toContain('Your assigned protocol');
    expect(text).not.toContain('Clinician notes');
  });

  it('keeps the assigned-protocol wording and clinician notes for a linked patient', async () => {
    const text = await details({ ...createBlankProfile('patient-1', 'patient@example.com'), clinicianId: 'clinician-1' });
    expect(text).toContain('Your assigned protocol');
    expect(text).toContain('Clinician notes');
  });
});
