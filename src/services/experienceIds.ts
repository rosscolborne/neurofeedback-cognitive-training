import type { ExperienceType } from '../types';

// The complete legacy catalogue. Only profiles without an allowedExperiences
// field receive this fallback; a stored empty array is an explicit assignment.
export const EXPERIENCE_IDS: ExperienceType[] = [
  'neuro-gambit', 'immersive-3d', 'generative-music', 'narrative-story',
  'skyline-drift', 'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock',
  'media-mode', 'soundscape-mode', 'mandala', 'eeg-mandala',
];

// Keep new patient profiles and field-missing legacy records on the same
// full-catalogue default. Presentation order is handled by EXPERIENCE_IDS.
export const DEFAULT_ALLOWED_EXPERIENCES: ExperienceType[] = [
  'immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift',
  'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock', 'media-mode',
  'soundscape-mode', 'mandala', 'eeg-mandala', 'neuro-gambit',
];
