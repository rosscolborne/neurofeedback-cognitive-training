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

  it('keeps canonical QEEG records patient-readable and clinician-owned append-only', () => {
    expect(rules).toContain('match /brainMaps/{brainMapId}');
    expect(rules).toContain('request.auth.uid == clientId || isPatientClinician(clientId)');
    expect(rules).toContain('request.resource.data.id == brainMapId');
    expect(rules).toContain('request.resource.data.createdBy == request.auth.uid');
    expect(rules).toContain('request.resource.data.createdAt == request.time');
    expect(rules).toContain("request.resource.data.keys().hasOnly([");
    expect(rules).toContain('request.resource.data.zScores.keys().hasOnly([');
    expect(rules).toContain('request.resource.data.recordingDate is timestamp');
    expect(rules).toContain("request.resource.data.deviceSource.matches('.*\\\\S.*')");
    expect(rules).toContain('request.resource.data.dominantAlphaPeakHz <= 30');
    const brainMapBlock = rules.slice(rules.indexOf('match /brainMaps/{brainMapId}'), rules.indexOf('// Neurofeedback Session Records'));
    expect(brainMapBlock).toContain('allow update, delete: if false;');
  });

  it('keeps practitioner identity, clinic membership, and clinic membership lists immutable', () => {
    expect(rules).toContain('practitionerId == request.auth.uid');
    expect(rules).toContain('request.resource.data.userId == resource.data.userId');
    expect(rules).toContain('request.resource.data.practitionerIds == resource.data.practitionerIds');
  });

  it('supports role-gated atomic onboarding through post-write clinic membership', () => {
    expect(rules).toContain('function isClinicMemberAfter(clinicId)');
    expect(rules).toContain('existsAfter(/databases/$(database)/documents/clinics/$(clinicId))');
    expect(rules).toContain('getAfter(/databases/$(database)/documents/clinics/$(clinicId))');
    const clinics = rules.slice(rules.indexOf('match /clinics/{clinicId}'), rules.indexOf('match /protocolCatalog/{protocolId}'));
    expect(clinics).toContain('allow get: if (isClinician()');
    expect(clinics).toContain('clinicId == request.auth.uid');
    expect(clinics).toContain('allow create: if isClinician()');
    expect(clinics).toContain('isClinicMemberAfter(request.resource.data.clinicId)');
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
    expect(rules).toContain('resource.data.patientEmail == request.auth.token.email.lower()');
    expect(rules).toContain('request.resource.data.patientEmail == request.resource.data.patientEmail.lower()');
    expect(rules).toContain("request.resource.data.status == 'accepted'");
    expect(rules).toContain(".data.get('acceptedInvitationId', null) == invitationId");
    expect(rules).toContain('getAfter(/databases/$(database)/documents/clients/$(request.auth.uid))');
    expect(rules).toContain("resource.data.get('expiresAt', request.time + duration.value(1, 's')) > request.time");
    expect(rules).toContain("request.resource.data.expiresAt <= request.time + duration.value(30, 'd')");
  });

  it('binds new invitations and uniqueness claims to the clinicians authenticated clinic membership', () => {
    expect(rules).toContain('function isAuthenticatedPractitionerForClinic(clinicId)');
    expect(rules).toContain('exists(/databases/$(database)/documents/practitioners/$(request.auth.uid))');
    expect(rules).toContain(".data.get('clinicId', null) == clinicId");
    expect(rules).toContain('isClinicMember(clinicId)');

    const invitationsBlock = rules.slice(
      rules.indexOf('match /patientInvitations/{invitationId}'),
      rules.indexOf('match /patientInvitationClaims/{clinicianId}/emails/{emailKey}'),
    );
    expect(invitationsBlock).toContain('request.resource.data.clinicId is string');
    expect(invitationsBlock).toContain('isAuthenticatedPractitionerForClinic(request.resource.data.clinicId)');

    const claimsBlock = rules.slice(
      rules.indexOf('match /patientInvitationClaims/{clinicianId}/emails/{emailKey}'),
      rules.indexOf('match /clients/{clientId}'),
    );
    expect(claimsBlock).toContain("invitation.get('clinicId', null) == request.resource.data.get('clinicId', null)");
    expect(claimsBlock).toContain("resource.data.get('clinicId', null) == request.resource.data.get('clinicId', null)");
    expect(claimsBlock).toContain('isAuthenticatedPractitionerForClinic(request.resource.data.clinicId)');
  });

  it('copies exactly the invitation clinic on acceptance while preserving ordinary clinic immutability', () => {
    const invitationsBlock = rules.slice(
      rules.indexOf('match /patientInvitations/{invitationId}'),
      rules.indexOf('match /patientInvitationClaims/{clinicianId}/emails/{emailKey}'),
    );
    expect(invitationsBlock).toContain(".data.get('clinicId', null) == resource.data.get('clinicId', null)");

    const clientsBlock = rules.slice(rules.indexOf('match /clients/{clientId}'), rules.indexOf('// Neurofeedback Session Records'));
    expect(clientsBlock).toContain("resource.data.get('clinicId', null) == null");
    expect(clientsBlock).toContain(".data.get('clinicId', null) == request.resource.data.get('clinicId', null)");
    expect(clientsBlock).toContain("request.resource.data.get('clinicId', null) == resource.data.get('clinicId', null) &&\n              relationshipUnchanged()");
    expect(clientsBlock).toContain("request.resource.data.get('clinicId', null) == null &&\n            request.resource.data.get('clinicianId', null) == null");
  });

  it('uses canonical clinician ownership before the legacy fallback', () => {
    expect(rules).toContain('function isCanonicalPatientClinician(patient)');
    expect(rules).toContain("patient.get('clinicianId', null) == null");
    const clientsBlock = rules.slice(rules.indexOf('match /clients/{clientId}'), rules.indexOf('// Neurofeedback Session Records'));
    expect(clientsBlock).toContain('isCanonicalPatientClinician(resource.data)');
    expect(clientsBlock).not.toContain("resource.data.get('linkedClinicianCode', null) == request.auth.uid ||");
  });

  it('makes legacy list queries provable only for explicit-null canonical ownership', () => {
    expect(rules).toContain("patient.get('clinicianId', null) == null");
    expect(rules).toContain("patient.get('linkedClinicianCode', null) == request.auth.uid");
    expect(rules).not.toContain("patient.get('linkedClinicianCode', null) == request.auth.uid ||");
  });

  it('prevents self-links and freezes clinic tenancy', () => {
    expect(rules).toContain('resource.data.clinicianId != request.auth.uid');
    expect(rules).toContain("request.resource.data.get('clinicianId', null) != request.auth.uid");
    expect(rules).toContain("request.resource.data.get('clinicId', null) == null");
    expect(rules).toContain("request.resource.data.get('clinicId', null) == resource.data.get('clinicId', null)");
  });

  it('uses an atomic normalized-email uniqueness claim and releases it on terminal transitions', () => {
    expect(rules).toContain('match /patientInvitationClaims/{clinicianId}/emails/{emailKey}');
    expect(rules).toContain('function matchesPendingInvitation()');
    expect(rules).toContain("invitation.get('uniquenessClaimId', null) == emailKey");
    expect(rules).toContain('clinicianId == request.auth.uid');
    expect(rules).toContain('emailKey == request.resource.data.patientEmail');
    expect(rules).toContain('function uniquenessReleased()');
    expect(rules).toContain('resource.data.expiresAt <= request.time');
  });

  it('freezes relationship fields except for a valid acceptance or owner unlink', () => {
    expect(rules).toContain('function relationshipUnchanged()');
    expect(rules).toContain('function acceptsValidInvitation()');
    expect(rules).toContain('function createsWithValidInvitation()');
    expect(rules).toContain('function unlinksOwningClinician()');
    expect(rules).toContain(') || acceptsValidInvitation()');
    expect(rules).toContain(') || unlinksOwningClinician()');
    expect(rules).toContain("request.resource.data.get('acceptedInvitationId', null) == resource.data.get('acceptedInvitationId', null)");
  });

  it('does not expose the user directory or let clinicians create and delete patient profiles', () => {
    const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('// A clinician creates an invitation'));
    expect(usersBlock).toContain('allow read: if isOwner(userId);');
    const clientsBlock = rules.slice(rules.indexOf('match /clients/{clientId}'), rules.indexOf('// Neurofeedback Session Records'));
    expect(clientsBlock).not.toContain("request.resource.data.get('clinicianId', null) == request.auth.uid");
    expect(clientsBlock).toContain('allow delete: if isAuthenticated() && (\n        request.auth.uid == clientId');
    expect(clientsBlock).toContain("resource.data.get('acceptedInvitationId', null) == null");
  });
});
