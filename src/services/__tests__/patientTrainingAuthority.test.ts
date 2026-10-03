import { describe, expect, it } from 'vitest';
import type { ClientProfile } from '../../types';
import { readClientProfile } from '../dataMappers';
import {
  hasActiveClinicianRelationship,
  isPatientTabAvailable,
  resolveTrainingAuthority,
} from '../patientTrainingAuthority';
import { createBlankProfile } from '../storageEngine';

const blank = (): ClientProfile => createBlankProfile('patient-1', 'patient@example.com');

describe('patient training authority', () => {
  it('derives authority from the live relationship fields, including legacy links', () => {
    expect(resolveTrainingAuthority(blank())).toBe('self-directed');
    expect(resolveTrainingAuthority({ ...blank(), clinicianId: 'clinician-1' })).toBe('clinician');
    expect(resolveTrainingAuthority({ ...blank(), linkedClinicianCode: 'clinician-1' })).toBe('clinician');
    // Unlinking writes null to the relationship fields.
    expect(resolveTrainingAuthority(readClientProfile({ ...blank(), clinicianId: null, linkedClinicianCode: null }))).toBe('self-directed');
    expect(hasActiveClinicianRelationship({ clinicianId: '' })).toBe(false);
  });

  it('hides only clinician-dependent destinations while self-directed', () => {
    for (const tab of ['home', 'sessions', 'progress', 'profile']) {
      expect(isPatientTabAvailable(tab, 'self-directed')).toBe(true);
      expect(isPatientTabAvailable(tab, 'clinician')).toBe(true);
    }
    for (const tab of ['messages', 'appointments']) {
      expect(isPatientTabAvailable(tab, 'self-directed')).toBe(false);
      expect(isPatientTabAvailable(tab, 'clinician')).toBe(true);
    }
  });
});
