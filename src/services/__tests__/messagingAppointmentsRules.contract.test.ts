import { describe, expect, it } from 'vitest';
import rules from '../../../firestore.rules?raw';

const between = (start: string, end: string) => {
  const startIndex = rules.indexOf(start);
  const endIndex = rules.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return rules.slice(startIndex, endIndex);
};

describe('messaging Firestore rule contract', () => {
  const canonical = () => between(
    'match /messageThreads/{patientId}/relationships/{clinicianId}',
    '// Temporary whole-array message history',
  );
  const legacy = () => between(
    'match /messages/{patientId}',
    '// Canonical appointments use patientId',
  );

  it('binds canonical reads and writes to the path and current R1 relationship', () => {
    const block = canonical();
    expect(rules).toContain('function isCurrentPatientClinician(patientId, clinicianId)');
    expect(rules).toContain('isCanonicalPatientClinicianId(');
    expect(block).toContain('request.auth.uid == patientId ||');
    expect(block).toContain('request.auth.uid == clinicianId && isPatientClinician(patientId)');
    expect(block).toContain('isCurrentPatientClinician(patientId, clinicianId)');
    expect(block).toContain('(request.auth.uid == patientId || request.auth.uid == clinicianId)');
    expect(block).toContain('request.resource.data.patientId == patientId');
    expect(block).toContain('request.resource.data.clinicianId == clinicianId');
  });

  it('requires an exact, immutable summary schema and a matching post-write message', () => {
    const block = canonical();
    expect(block).toContain("'patientId', 'clinicianId', 'participantIds', 'lastMessageId'");
    expect(block).toContain("'updatedAt', 'schemaVersion'");
    expect(block).toContain('request.resource.data.participantIds == [patientId, clinicianId]');
    expect(block).toContain('request.resource.data.lastSenderId == request.auth.uid');
    expect(block).toContain('request.resource.data.lastMessageAt == request.time');
    expect(block).toContain('request.resource.data.createdAt is timestamp');
    expect(block).toContain('request.resource.data.updatedAt == request.time');
    expect(block).toContain('request.resource.data.createdAt == request.time');
    expect(block).toContain('request.resource.data.createdAt == resource.data.createdAt');
    expect(block).toContain('getAfter(/databases/$(database)/documents/messageThreads/$(patientId)/relationships/$(clinicianId)/messages/$(messageId))');
    expect(block).toContain('message.text == request.resource.data.lastMessageText');
    expect(block).toContain('message.senderId == request.auth.uid');
    expect(block).toContain("message.senderRole == 'patient'");
    expect(block).toContain("message.senderRole == 'clinician'");
    expect(block).toContain('message.createdAt == request.time');
    expect(block).toContain('allow delete: if false;');
  });

  it('accepts only trimmed bounded text and immutable exact-shape nested messages', () => {
    const block = canonical();
    expect(block).toContain('text.size() <= 4000');
    expect(block).toContain("text.matches('^\\\\S([\\\\s\\\\S]*\\\\S)?$')");
    expect(block).toContain("'id', 'patientId', 'clinicianId', 'senderId', 'senderRole'");
    expect(block).toContain('request.resource.data.id == messageId');
    expect(block).toContain('request.resource.data.senderId == request.auth.uid');
    expect(block).toContain("request.resource.data.senderRole == 'patient'");
    expect(block).toContain("request.resource.data.senderRole == 'clinician'");
    expect(block).toContain('request.resource.data.createdAt == request.time');
    expect(block).toContain('allow update, delete: if false;');
  });

  it('requires every nested message create to update its exact parent summary atomically', () => {
    const block = canonical();
    expect(block).toContain('function validPostWriteSummary()');
    expect(block).toContain('existsAfter(summaryPath)');
    expect(block).toContain('let summary = getAfter(summaryPath).data');
    expect(block).toContain('summary.patientId == patientId');
    expect(block).toContain('summary.clinicianId == clinicianId');
    expect(block).toContain('summary.participantIds == [patientId, clinicianId]');
    expect(block).toContain('summary.lastMessageId == messageId');
    expect(block).toContain('summary.lastMessageText == request.resource.data.text');
    expect(block).toContain('summary.lastSenderId == request.auth.uid');
    expect(block).toContain('summary.lastMessageAt == request.time');
    expect(block).toContain('summary.updatedAt == request.time');
    expect(block).toContain('request.resource.data.schemaVersion == 1 &&\n          validPostWriteSummary();');
  });

  it('keeps legacy whole-array history read-only and denies a former clinician', () => {
    const block = legacy();
    expect(block).toContain('request.auth.uid == patientId');
    expect(block).toContain("resource.data.get('patientId', resource.data.get('clientId', null)) == patientId");
    expect(block).toContain("resource.data.get('clinicianId', null) == request.auth.uid");
    expect(block).toContain('isPatientClinician(patientId)');
    expect(block).toContain('allow write: if false;');
    expect(block).not.toContain('isDemo');
    expect(block).not.toContain("startsWith('demo-')");
  });
});

describe('appointment Firestore rule contract', () => {
  const block = () => between(
    'match /appointments/{appointmentId}',
    '// Clinic Brand Configurations',
  );

  it('separates canonical and explicit-null legacy reads with current relationship checks', () => {
    const appointmentRules = block();
    expect(appointmentRules).toContain("resource.data.get('patientId', null) is string");
    expect(appointmentRules).toContain("resource.data.keys().hasAll(['patientId', 'clientId'])");
    expect(appointmentRules).toContain('resource.data.patientId == null');
    expect(appointmentRules).toContain('resource.data.patientId == request.auth.uid');
    expect(appointmentRules).toContain('resource.data.clinicianId == request.auth.uid');
    expect(appointmentRules).toContain('isPatientClinician(resource.data.patientId)');
    expect(appointmentRules).toContain('resource.data.clientId == request.auth.uid');
    expect(appointmentRules).toContain("resource.data.get('clinicianId', null) == request.auth.uid");
    expect(appointmentRules).toContain('isPatientClinician(resource.data.clientId)');
  });

  it('permits only the owning current clinician to create exact canonical records', () => {
    const appointmentRules = block();
    expect(appointmentRules).toContain('allow create: if isClinician()');
    expect(appointmentRules).toContain("appointmentId.matches('^[A-Za-z0-9_-]{20,100}$')");
    expect(appointmentRules).toContain('request.resource.data.clinicianId == request.auth.uid');
    expect(appointmentRules).toContain('request.resource.data.createdBy == request.auth.uid');
    expect(appointmentRules).toContain('isPatientClinician(request.resource.data.patientId)');
    expect(appointmentRules).toContain('.data.name');
    expect(appointmentRules).toContain("request.resource.data.status == 'scheduled'");
    expect(appointmentRules).toContain('request.resource.data.durationMinutes >= 15');
    expect(appointmentRules).toContain('request.resource.data.durationMinutes <= 240');
    expect(appointmentRules).toContain('(allowEmpty && value.size() == 0)');
    expect(appointmentRules).toContain("value.matches('^\\\\S([\\\\s\\\\S]*\\\\S)?$')");
    expect(appointmentRules).toContain('request.resource.data.startsAt is timestamp');
    expect(appointmentRules).toContain('request.resource.data.createdAt == request.time');
    expect(appointmentRules).toContain('request.resource.data.updatedAt == request.time');
    expect(appointmentRules).toContain('request.resource.data.revision == 1');
    expect(appointmentRules).toContain('request.resource.data.schemaVersion == 1');
    expect(appointmentRules).toContain("'remote-training', 'in-clinic-evaluation', 'qeeg-mapping'");
  });

  it('freezes identity and creation fields while enforcing optimistic scheduled edits', () => {
    const appointmentRules = block();
    expect(appointmentRules).toContain('resource.data.clinicianId == request.auth.uid');
    expect(appointmentRules).toContain('isPatientClinician(resource.data.patientId)');
    expect(appointmentRules).toContain("resource.data.status == 'scheduled'");
    expect(appointmentRules).toContain('request.resource.data.patientId == resource.data.patientId');
    expect(appointmentRules).toContain('request.resource.data.patientDisplayName == resource.data.patientDisplayName');
    expect(appointmentRules).toContain("request.resource.data.get('clinicianDisplayName', null) == resource.data.get('clinicianDisplayName', null)");
    expect(appointmentRules).toContain('request.resource.data.createdAt == resource.data.createdAt');
    expect(appointmentRules).toContain('request.resource.data.createdBy == resource.data.createdBy');
    expect(appointmentRules).toContain('request.resource.data.schemaVersion == resource.data.schemaVersion');
    expect(appointmentRules).toContain('request.resource.data.revision == resource.data.revision + 1');
    expect(appointmentRules).toContain("'startsAt', 'timezone', 'durationMinutes', 'type', 'notes'");
  });

  it('allows only an exact audited scheduled-to-cancelled transition and forbids deletes', () => {
    const appointmentRules = block();
    expect(appointmentRules).toContain("request.resource.data.status == 'cancelled'");
    expect(appointmentRules).toContain('request.resource.data.cancelledAt == request.time');
    expect(appointmentRules).toContain('request.resource.data.cancelledBy == request.auth.uid');
    expect(appointmentRules).toContain("request.resource.data.cancellationRequestId.matches('^cancel_[A-Za-z0-9_-]{20,100}$')");
    expect(appointmentRules).toContain("'status', 'cancelledAt', 'cancelledBy', 'cancellationRequestId'");
    expect(appointmentRules).toContain('.affectedKeys().hasAll([');
    expect(appointmentRules).toContain('allow delete: if false;');
  });

  it('contains no legacy write path or participant-only authorization fallback', () => {
    const appointmentRules = block();
    expect(appointmentRules).not.toContain('request.resource.data.clientId == request.auth.uid');
    expect(appointmentRules).not.toContain('resource.data.clientId == request.auth.uid ||\n        resource.data.clinicianId');
    expect(appointmentRules).not.toContain('allow write: if isAuthenticated()');
  });
});
