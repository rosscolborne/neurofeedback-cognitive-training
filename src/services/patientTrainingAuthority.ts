import type { ClientProfile, ExperienceType, ProtocolType } from '../types';
import { CLINICAL_PROTOCOL_TEMPLATES, getClinicalProtocolTemplate } from './clinicalProtocolTemplates';
import { getPatientClinicianId } from './dataMappers';
import { EXPERIENCE_IDS } from './experienceIds';

/**
 * A patient profile stores exactly one active training assignment
 * (assignedProtocol + allowedExperiences, optionally customProtocolConfig).
 * Who may change it depends only on the live relationship fields:
 *
 * - clinician: an active clinician relationship exists. The clinician's
 *   assignment is authoritative and the patient cannot edit it.
 * - self-directed: no active relationship. The stored assignment is the
 *   patient's own training setup and the patient may change it.
 *
 * Invitation acceptance overwrites the whole assignment with the clinician's
 * values in the same transaction that links the account, so no self-directed
 * choice survives linking. Unlinking clears only the relationship fields, so
 * the last clinician assignment remains as the self-directed starting point.
 */
export type TrainingAuthority = 'clinician' | 'self-directed';

type RelationshipFields = Pick<ClientProfile, 'clinicianId' | 'linkedClinicianCode'>;

export function hasActiveClinicianRelationship(client: RelationshipFields): boolean {
  return Boolean(getPatientClinicianId(client));
}

export function resolveTrainingAuthority(client: RelationshipFields): TrainingAuthority {
  return hasActiveClinicianRelationship(client) ? 'clinician' : 'self-directed';
}

export const TRAINING_AUTHORITY_LABEL: Record<TrainingAuthority, string> = {
  clinician: 'Clinician-managed',
  'self-directed': 'Self-directed',
};

/** Patient destinations that cannot function without an active clinician relationship. */
const CLINICIAN_DEPENDENT_TABS: ReadonlySet<string> = new Set(['messages', 'appointments']);

export function isPatientTabAvailable(tab: string, authority: TrainingAuthority): boolean {
  return authority === 'clinician' || !CLINICIAN_DEPENDENT_TABS.has(tab);
}

export interface SelfDirectedProtocolChoice {
  protocol: ProtocolType;
  name: string;
  focus: string;
  description: string;
  defaultExperiences: readonly ExperienceType[];
}

// Deliberately neutral: what the session practises and what the feedback
// follows. Template indications and clinical notes are not shown here because
// self-directed setup is not a diagnosis or treatment recommendation.
const SELF_DIRECTED_COPY: Partial<Record<ProtocolType, Pick<SelfDirectedProtocolChoice, 'focus' | 'description'>>> = {
  'theta-beta-ratio': {
    focus: 'Attention',
    description: 'Practise steady, alert attention. Feedback follows the balance between slower theta and faster beta activity.',
  },
  'smr-enhancement': {
    focus: 'Still focus',
    description: 'Practise keeping a calm body with an alert mind. Feedback follows sensorimotor rhythm (SMR) activity.',
  },
  'alpha-enhancement': {
    focus: 'Relaxation',
    description: 'Practise relaxed, settled awareness. Feedback follows alpha activity.',
  },
  'alpha-theta-crossover': {
    focus: 'Deep relaxation',
    description: 'Practise longer, eyes-closed relaxation. Feedback follows the balance between theta and alpha activity.',
  },
  'beta-downtraining': {
    focus: 'Winding down',
    description: 'Practise winding down. Feedback rewards quieter fast (beta) activity.',
  },
};

/** Supported existing protocol templates a self-directed patient may choose from. */
export const SELF_DIRECTED_PROTOCOL_CHOICES: readonly SelfDirectedProtocolChoice[] = CLINICAL_PROTOCOL_TEMPLATES.flatMap((template) => {
  const protocol = template.protocolType;
  const copy = protocol ? SELF_DIRECTED_COPY[protocol] : undefined;
  return protocol && copy
    ? [{ protocol, name: template.name, ...copy, defaultExperiences: [...template.recommendedExperiences] }]
    : [];
});

export function getSelfDirectedProtocolChoice(protocol: ProtocolType | undefined): SelfDirectedProtocolChoice | undefined {
  return SELF_DIRECTED_PROTOCOL_CHOICES.find((choice) => choice.protocol === protocol);
}

/** Canonical order, no duplicates, no unknown identifiers. */
export function normalizeExperienceSelection(experiences: readonly ExperienceType[]): ExperienceType[] {
  const selected = new Set(experiences);
  return EXPERIENCE_IDS.filter((id) => selected.has(id));
}

/** True when the stored list is exactly the protocol's canonical default set. */
export function usesProtocolDefaultExperiences(protocol: ProtocolType, allowedExperiences: readonly ExperienceType[]): boolean {
  const defaults = getClinicalProtocolTemplate(protocol)?.recommendedExperiences;
  if (!defaults) return false;
  const normalized = normalizeExperienceSelection(allowedExperiences);
  const canonical = normalizeExperienceSelection(defaults);
  return normalized.length === canonical.length && normalized.every((id, index) => id === canonical[index]);
}

export interface SelfDirectedTrainingSetup {
  assignedProtocol: ProtocolType;
  allowedExperiences: ExperienceType[];
}

/**
 * Build the assignment a self-directed patient saves. Without an explicit list
 * the protocol's canonical defaults apply. A customized list must name at least
 * one supported experience so a patient cannot configure themselves into an
 * empty Train screen by accident.
 */
export function buildSelfDirectedTrainingSetup(
  protocol: ProtocolType,
  experiences?: readonly ExperienceType[],
): SelfDirectedTrainingSetup {
  const choice = getSelfDirectedProtocolChoice(protocol);
  if (!choice) throw new Error('This protocol is not available for self-directed training.');
  if (experiences === undefined) {
    return { assignedProtocol: protocol, allowedExperiences: [...choice.defaultExperiences] };
  }
  if (experiences.some((id) => !EXPERIENCE_IDS.includes(id))) {
    throw new Error('One of the selected experiences is not available.');
  }
  const allowedExperiences = normalizeExperienceSelection(experiences);
  if (allowedExperiences.length === 0) throw new Error('Choose at least one training experience.');
  return { assignedProtocol: protocol, allowedExperiences };
}

/** Raised when a self-directed save finds the profile is now clinician-managed. */
export class ClinicianManagedTrainingError extends Error {
  constructor(readonly current: ClientProfile) {
    super('Your training plan is now managed by your clinician, so self-directed changes were not saved.');
    this.name = 'ClinicianManagedTrainingError';
  }
}
