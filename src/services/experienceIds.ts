import type { ExperienceType } from '../types';

// Every experience the patient shell can run.
export const EXPERIENCE_IDS: ExperienceType[] = ['neuro-gambit'];

// Fallback for field-missing legacy records and merge saves; a stored empty
// array is an explicit assignment. New patient profiles use the canonical
// default protocol's experience list.
export const DEFAULT_ALLOWED_EXPERIENCES: ExperienceType[] = ['neuro-gambit'];
