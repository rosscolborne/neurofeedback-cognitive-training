import { describe, expect, it } from 'vitest';
import rules from '../../../firestore.rules?raw';

describe('Firestore authorization rule contract', () => {
  it('derives device clinician access from client ownership instead of assignedByUserId', () => {
    expect(rules).toContain('patientId == request.auth.uid || isPatientClinician(patientId)');
    expect(rules).toContain('request.resource.data.patientId == patientId');
    expect(rules).toContain('request.resource.data.assignedByUserId == resource.data.assignedByUserId');
  });

  it('authorizes protocol writes through clinic membership and freezes clinicId', () => {
    expect(rules).toContain('isClinicMember(request.resource.data.clinicId)');
    expect(rules).toContain('request.resource.data.clinicId == resource.data.clinicId');
    expect(rules).toContain('isClinicMember(resource.data.clinicId)');
  });

  it('supports legacy clinician session access through the patient ownership helper', () => {
    expect(rules).toContain('function isSessionProvider(session)');
    expect(rules).toContain('isPatientClinician(session.patientId)');
    expect(rules).toContain('isSessionProvider(resource.data)');
  });

  it('allows note-only session updates and denies deletion', () => {
    expect(rules).toContain(".hasOnly(['patientNotes', 'moodRating', 'updatedAt'])");
    expect(rules).toContain(".hasOnly(['clinicianNotes', 'updatedAt'])");
    const sessionBlock = rules.slice(rules.indexOf('match /sessions/{sessionId}'), rules.indexOf('// A device assignment'));
    expect(sessionBlock).toContain('allow delete: if false;');
  });

  it('keeps practitioner identity, clinic membership, and clinic membership lists immutable', () => {
    expect(rules).toContain('practitionerId == request.auth.uid');
    expect(rules).toContain('request.resource.data.userId == resource.data.userId');
    expect(rules).toContain('request.resource.data.practitionerIds == resource.data.practitionerIds');
  });

  it('allows clinic members to read clients but freezes client ownership fields on that path', () => {
    expect(rules).toContain("isClinicMember(resource.data.get('clinicId', null))");
    expect(rules).toContain("request.resource.data.get('clinicId', null) == resource.data.get('clinicId', null)");
    expect(rules).toContain("request.resource.data.get('clinicianId', null) == resource.data.get('clinicianId', null)");
    expect(rules).toContain("request.resource.data.get('linkedClinicianCode', null) == resource.data.get('linkedClinicianCode', null)");
  });

  it('links patients through atomic, email-targeted invitations', () => {
    expect(rules).toContain('match /patientInvitations/{invitationId}');
    expect(rules).toContain("request.resource.data.status == 'pending'");
    expect(rules).toContain('resource.data.patientEmail == request.auth.token.email');
    expect(rules).toContain("request.resource.data.status == 'accepted'");
    expect(rules).toContain(".data.get('acceptedInvitationId', null) == invitationId");
    expect(rules).toContain('getAfter(/databases/$(database)/documents/clients/$(request.auth.uid))');
  });

  it('does not expose the user directory or let clinicians create and delete patient profiles', () => {
    const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('// A clinician creates an invitation'));
    expect(usersBlock).toContain('allow read: if isOwner(userId);');
    const clientsBlock = rules.slice(rules.indexOf('match /clients/{clientId}'), rules.indexOf('// Neurofeedback Session Records'));
    expect(clientsBlock).not.toContain("request.resource.data.get('clinicianId', null) == request.auth.uid");
    expect(clientsBlock).toContain('allow delete: if isAuthenticated() && (\n        request.auth.uid == clientId');
  });
});
