import { describe, expect, it } from 'vitest';
import rules from '../../../firestore.rules?raw';

describe('clinic settings Firestore rule contract', () => {
  it('limits clinic reads to members or patients and freezes membership on update', () => {
    const block = rules.slice(rules.indexOf('match /clinics/{clinicId}'), rules.indexOf('match /practitioners/{practitionerId}'));
    expect(block).toContain('allow get: if (isClinician()');
    expect(block).toContain('clinicId == request.auth.uid || isClinicMember(clinicId)');
    expect(block).toContain('allow list: if (isClinician() && isClinicMember(clinicId)) || isClinicPatient(clinicId);');
    expect(block).toContain('request.resource.data.practitionerIds == resource.data.practitionerIds');
    expect(block).toContain('allow delete: if false;');
  });

  it('binds practitioner creation to the authenticated user and tenant membership', () => {
    const block = rules.slice(rules.indexOf('match /practitioners/{practitionerId}'), rules.indexOf('match /protocolCatalog/{protocolId}'));
    expect(block).toContain('practitionerId == request.auth.uid');
    expect(block).toContain('request.resource.data.userId == request.auth.uid');
    expect(block).toContain('isClinicMemberAfter(request.resource.data.clinicId)');
    expect(block).toContain('request.resource.data.clinicId == resource.data.clinicId');
  });
});
