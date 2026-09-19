import { describe, expect, it } from 'vitest';
import appSource from '../../App.tsx?raw';
import rosterSource from '../../components/clinician/ClientRosterView.tsx?raw';
import patientSource from '../../components/patient/PatientShell.tsx?raw';

describe('relationship enrollment UI wiring', () => {
  it('preserves invitation deep links through authentication and routes them to patients', () => {
    expect(appSource).toContain('path="/connect/:invitationCode"');
    expect(appSource).toContain('waveable_pending_invitation');
    expect(appSource).toContain('initialInvitationCode={invitationCode}');
    expect(appSource).toContain('onInvitationAccepted=');
  });

  it('offers invitation acceptance on the patient home and profile surfaces', () => {
    expect(patientSource).toContain('Have an invitation from your clinician?');
    expect(patientSource).toContain('Accept Invitation');
    expect(patientSource).toContain('role="alert"');
    expect(patientSource).toContain('client.clinicianId || client.linkedClinicianCode');
  });

  it('gives clinicians an expiring shareable invitation link', () => {
    expect(rosterSource).toContain('/connect/${createdInvitation.id}');
    expect(rosterSource).toContain('The invitation expires after 14 days.');
    expect(rosterSource).toContain('Copy invitation link');
  });

  it('shows progress and errors for cancel and unlink operations', () => {
    expect(rosterSource).toContain('pendingActionId');
    expect(rosterSource).toContain('Cancelling…');
    expect(rosterSource).toContain('Removing…');
    expect(rosterSource).toContain('setActionError');
    expect(rosterSource).toContain('role="alert"');
  });
});
