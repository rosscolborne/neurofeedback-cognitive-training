import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessagingView } from '../src/components/clinician/MessagingView';
import { PatientMessagingView } from '../src/components/patient/PatientMessagingView';
import type { MessageRepository } from '../src/services/messageRepository';
import '../src/styles/index.css';

// This browser-only fixture exercises the real views without using shared accounts or Firestore.
const repository: MessageRepository = {
  resolveActiveRelationship: async (patientId) => ({ patientId, clinicianId: 'clinician-1', key: `${patientId}/clinician-1` }),
  getRelationshipThread: async () => null,
  listMessages: async () => ({ messages: [], nextCursor: null }),
  listLegacyMessages: async () => [],
  subscribeToMessages: () => () => {},
  subscribeToUnread: () => () => {},
  markThreadRead: async () => {},
  prepareMessage: (relationship, text) => ({ id: 'test-message', relationship, text: text.trim() }),
  sendPreparedMessage: async () => {},
};

export function Harness() {
  const [view, setView] = useState<'menu' | 'clinician' | 'patient'>('menu');
  return <>
    <nav>
      <button onClick={() => setView('menu')}>Close Messages</button>
      <button onClick={() => setView('clinician')}>Open clinician Messages</button>
      <button onClick={() => setView('patient')}>Open patient Messages</button>
    </nav>
    {view === 'clinician' && <MessagingView participants={[{ patientId: 'patient-1', name: 'Linked patient' }]} repository={repository} />}
    {view === 'patient' && <PatientMessagingView patientId="patient-1" repository={repository} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
