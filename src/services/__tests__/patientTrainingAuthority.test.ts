import { describe, expect, it } from 'vitest';
import type { ClientProfile } from '../../types';
import { CLINICAL_PROTOCOL_TEMPLATES, getClinicalProtocolTemplate } from '../clinicalProtocolTemplates';
import { readClientProfile } from '../dataMappers';
import { EXPERIENCE_IDS } from '../experienceIds';
import {
  buildSelfDirectedTrainingSetup,
  hasActiveClinicianRelationship,
  isPatientTabAvailable,
  normalizeExperienceSelection,
  resolveTrainingAuthority,
  SELF_DIRECTED_PROTOCOL_CHOICES,
  usesProtocolDefaultExperiences,
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
    for (const tab of ['home', 'sessions', 'education', 'progress', 'profile']) {
      expect(isPatientTabAvailable(tab, 'self-directed')).toBe(true);
      expect(isPatientTabAvailable(tab, 'clinician')).toBe(true);
    }
    for (const tab of ['messages', 'appointments']) {
      expect(isPatientTabAvailable(tab, 'self-directed')).toBe(false);
      expect(isPatientTabAvailable(tab, 'clinician')).toBe(true);
    }
  });

  it('offers exactly the supported protocol templates with non-clinical copy', () => {
    expect(SELF_DIRECTED_PROTOCOL_CHOICES.map((choice) => choice.protocol))
      .toEqual(CLINICAL_PROTOCOL_TEMPLATES.map((template) => template.protocolType));
    for (const choice of SELF_DIRECTED_PROTOCOL_CHOICES) {
      const template = getClinicalProtocolTemplate(choice.protocol)!;
      expect(choice.defaultExperiences).toEqual(template.recommendedExperiences);
      const copy = `${choice.focus} ${choice.description}`;
      expect(copy).not.toMatch(/adhd|anxiety|ptsd|trauma|insomnia|addiction|treat|diagnos|prescri|recommended|cure/i);
      expect(copy).not.toContain(template.indication);
    }
    // No canonical template exists for this runtime-only mode, so it cannot supply defaults.
    expect(SELF_DIRECTED_PROTOCOL_CHOICES.some((choice) => choice.protocol === 'individualized-upper-alpha')).toBe(false);
  });

  it('applies canonical defaults on a protocol change without injecting NeuroGambit', () => {
    const alpha = buildSelfDirectedTrainingSetup('alpha-enhancement');
    expect(alpha).toEqual({
      assignedProtocol: 'alpha-enhancement',
      allowedExperiences: getClinicalProtocolTemplate('alpha-enhancement')!.recommendedExperiences,
    });
    expect(alpha.allowedExperiences).not.toContain('neuro-gambit');
    expect(() => buildSelfDirectedTrainingSetup('individualized-upper-alpha')).toThrow('not available for self-directed training');
  });

  it('persists an exact customized list in catalogue order and refuses an empty or unknown one', () => {
    expect(buildSelfDirectedTrainingSetup('smr-enhancement', ['signal-sort', 'tidal-garden', 'signal-sort']))
      .toEqual({ assignedProtocol: 'smr-enhancement', allowedExperiences: ['tidal-garden', 'signal-sort'] });
    expect(() => buildSelfDirectedTrainingSetup('smr-enhancement', [])).toThrow('Choose at least one training experience.');
    expect(() => buildSelfDirectedTrainingSetup('smr-enhancement', ['spatial-audio' as never])).toThrow('not available');
    expect(normalizeExperienceSelection([...EXPERIENCE_IDS].reverse())).toEqual(EXPERIENCE_IDS);
    // An unchanged default set is stored in template order, like invitation acceptance and new profiles.
    const beta = getClinicalProtocolTemplate('beta-downtraining')!.recommendedExperiences;
    expect(buildSelfDirectedTrainingSetup('beta-downtraining', [...beta].reverse()).allowedExperiences).toEqual(beta);
  });

  it('recognises canonical defaults regardless of stored order, and customized or legacy lists as custom', () => {
    const tbr = getClinicalProtocolTemplate('theta-beta-ratio')!.recommendedExperiences;
    expect(usesProtocolDefaultExperiences('theta-beta-ratio', [...tbr].reverse())).toBe(true);
    expect(usesProtocolDefaultExperiences('theta-beta-ratio', tbr.slice(1))).toBe(false);
    expect(usesProtocolDefaultExperiences('theta-beta-ratio', [])).toBe(false);
    const legacy = { ...blank() } as Partial<ClientProfile>;
    delete legacy.allowedExperiences;
    expect(usesProtocolDefaultExperiences('theta-beta-ratio', readClientProfile(legacy).allowedExperiences)).toBe(false);
    expect(usesProtocolDefaultExperiences('individualized-upper-alpha', tbr)).toBe(false);
  });

  it('keeps the fresh unlinked default coherent: default protocol with its canonical list', () => {
    const fresh = blank();
    expect(resolveTrainingAuthority(fresh)).toBe('self-directed');
    expect(usesProtocolDefaultExperiences(fresh.assignedProtocol!, fresh.allowedExperiences)).toBe(true);
  });
});
