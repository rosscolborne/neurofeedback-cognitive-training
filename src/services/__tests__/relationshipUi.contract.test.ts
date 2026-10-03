import { describe, expect, it } from 'vitest';
import appSource from '../../App.tsx?raw';
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
    // Offered only with a real invitation: a code-free pending notice or a carried invitation link.
    expect(patientSource).toContain('hasPendingInvitationNotice()');
    expect(patientSource).toContain("activeTab === 'home' && canConnectToClinician");
    expect(patientSource).toContain('Accept Invitation');
    expect(patientSource).toContain('role="alert"');
    expect(patientSource).toContain('client.clinicianId || client.linkedClinicianCode');
  });
});
