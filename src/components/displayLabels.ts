import type { ExperienceType } from '../types';
import { EXPERIENCE_CATALOGUE } from './patient/experienceCatalogue';

export { protocolDisplayName } from '../services/protocols';

/** Catalogue name for an experience; unknown stored identifiers are title-cased rather than shown raw. */
export function experienceDisplayName(experience: ExperienceType | string): string {
  return EXPERIENCE_CATALOGUE[experience as ExperienceType]?.name
    ?? experience.split(/[-_\s]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}
