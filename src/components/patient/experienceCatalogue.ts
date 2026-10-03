import type React from 'react';
import { Crown } from 'lucide-react';
import type { ExperienceType } from '../../types';
import { EXPERIENCE_IDS } from '../../services/experienceIds';

export { EXPERIENCE_IDS } from '../../services/experienceIds';

export interface ExperienceCatalogueEntry {
  id: ExperienceType;
  name: string;
  description: string;
  icon: React.FC<{ size?: number }>;
  tag: string;
}

export const EXPERIENCE_CATALOGUE: Record<ExperienceType, ExperienceCatalogueEntry> = {
  'neuro-gambit': { id: 'neuro-gambit', name: 'NeuroGambit', icon: Crown, description: 'Tactical chess calculation, impulse gating & post-blunder tilt reset', tag: 'Chess' },
};

export function getAssignedExperienceIds(allowedExperiences: ExperienceType[]): ExperienceType[] {
  const allowed = new Set(allowedExperiences);
  return EXPERIENCE_IDS.filter((id) => allowed.has(id));
}

export function canStartAssignedExperience(allowedExperiences: ExperienceType[], experience: ExperienceType): boolean {
  return getAssignedExperienceIds(allowedExperiences).includes(experience);
}
