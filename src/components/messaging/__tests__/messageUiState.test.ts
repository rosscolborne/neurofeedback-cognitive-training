import { describe, expect, it } from 'vitest';
import { getMessageSendViewState } from '../messageUiState';

const attempt = { id: 'opaque-id', relationship: { patientId: 'patient-1', clinicianId: 'clinician-1', key: 'patient-1/clinician-1' }, text: 'Hello' };

describe('message send display contract', () => {
  it('does not enable blank or in-flight sends', () => {
    expect(getMessageSendViewState('  ', false, null, null).canSend).toBe(false);
    expect(getMessageSendViewState('Hello', true, null, null)).toMatchObject({ canSend: false, statusText: 'Sending…' });
  });

  it('shows an explicit failure and retries the same stable attempt', () => {
    expect(getMessageSendViewState('Hello', false, attempt, 'Connection lost')).toEqual({
      canSend: true,
      showRetry: true,
      statusText: 'Message not sent. Connection lost',
    });
  });

  it('does not retry a failed id after the authored text changes', () => {
    expect(getMessageSendViewState('Different', false, attempt, null).showRetry).toBe(false);
  });
});
