import type { ClientProfile } from '../types';
import { getPatientClinicianId } from './dataMappers';

/**
 * A patient profile stores exactly one active training assignment
 * (assignedProtocol + allowedExperiences, optionally customProtocolConfig).
 * Who may change it depends only on the live relationship fields:
 *
 * - clinician: an active clinician relationship exists. The clinician's
 *   assignment is authoritative and the patient cannot edit it.
 * - self-directed: no active relationship. The consumer app offers no way to
 *   change the stored assignment: it has no EEG protocols to choose from.
 *
 * Invitation acceptance overwrites the whole assignment with the clinician's
 * values in the same transaction that links the account. Unlinking clears only
 * the relationship fields, so the last clinician assignment remains stored.
 */
export type TrainingAuthority = 'clinician' | 'self-directed';

type RelationshipFields = Pick<ClientProfile, 'clinicianId' | 'linkedClinicianCode'>;

export function hasActiveClinicianRelationship(client: RelationshipFields): boolean {
  return Boolean(getPatientClinicianId(client));
}

export function resolveTrainingAuthority(client: RelationshipFields): TrainingAuthority {
  return hasActiveClinicianRelationship(client) ? 'clinician' : 'self-directed';
}

/** Patient destinations that cannot function without an active clinician relationship. */
const CLINICIAN_DEPENDENT_TABS: ReadonlySet<string> = new Set(['messages', 'appointments']);

export function isPatientTabAvailable(tab: string, authority: TrainingAuthority): boolean {
  return authority === 'clinician' || !CLINICIAN_DEPENDENT_TABS.has(tab);
}
