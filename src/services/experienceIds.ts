import type { ExperienceType } from '../types';

// The complete legacy catalogue. Only profiles without an allowedExperiences
// field receive this fallback; a stored empty array is an explicit assignment.
export const EXPERIENCE_IDS: ExperienceType[] = [
  'neuro-gambit', 'immersive-3d', 'generative-music', 'narrative-story',
  'skyline-drift', 'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock',
  'media-mode', 'soundscape-mode', 'mandala', 'eeg-mandala',
];

// Full-catalogue fallback for field-missing legacy records and merge saves.
// New patient profiles use the canonical default protocol's experience list.
export const DEFAULT_ALLOWED_EXPERIENCES: ExperienceType[] = [
  'immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift',
  'tidal-garden', 'breath-weave', 'signal-sort', 'rhythm-lock', 'media-mode',
  'soundscape-mode', 'mandala', 'eeg-mandala', 'neuro-gambit',
];
