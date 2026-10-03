import { describe, expect, it } from 'vitest';
import rules from '../../../firestore.rules?raw';

const block = (start: string, end: string) => {
  const from = rules.indexOf(start);
  const to = rules.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return rules.slice(from, to);
};

// Behavior is covered by the emulator tests in tests/firestore-rules/; this
// pins the shape that keeps the retired clinician product and the retired
// neurofeedback session records out of the rules.
describe('Firestore authorization rule contract', () => {
  it('has no clinician roles, helpers or collections, and no legacy session records', () => {
    for (const retired of [
      'isClinician()', 'isClinicMember', 'isPatientClinician', 'isSessionProvider', 'isCanonicalPatientClinician',
      'match /patientInvitations', 'match /patientInvitationNotices', 'match /patientInvitationClaims',
      'match /messageThreads', 'match /messages', 'match /appointments', 'match /clinics', 'match /practitioners',
      'match /brainMaps', 'match /sessions/',
    ]) {
      expect(rules).not.toContain(retired);
    }
  });

  it('gives only the owner access to a patient profile and freezes its legacy relationship fields', () => {
    const clients = block('match /clients/{clientId}', '// Everything not matched above is denied');
    expect(clients).toContain('allow read: if isAuthenticated() && request.auth.uid == clientId;');
    expect(clients).toContain('function relationshipUnchanged()');
    expect(clients).toContain("request.resource.data.get('clinicId', null) == resource.data.get('clinicId', null) &&\n          relationshipUnchanged()");
    // A new profile cannot name a clinician, clinic or invitation.
    expect(clients).toContain("request.resource.data.get('clinicianId', null) == null &&");
    expect(clients).toContain("request.resource.data.get('acceptedInvitationId', null) == null;");
    // Only the owner deletes, and only a profile that is not being deleted.
    expect(clients).toContain('allow delete: if isAuthenticated() && (\n        request.auth.uid == clientId');
  });
});
