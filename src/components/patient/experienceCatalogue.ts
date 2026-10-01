import type React from 'react';
import { BookOpen, Box, CircleDot, Crown, Flower2, Headphones, Mountain, Music, Target, Tv, Waves, Wind } from 'lucide-react';
import type { ExperienceType } from '../../types';
import { EXPERIENCE_IDS } from '../../services/experienceIds';

export { EXPERIENCE_IDS } from '../../services/experienceIds';

export interface ExperienceCatalogueEntry {
  id: ExperienceType;
  name: string;
  description: string;
  icon: React.FC<{ size?: number }>;
  tag: string;
  badge: string;
  gradient: string;
}

export const EXPERIENCE_CATALOGUE: Record<ExperienceType, ExperienceCatalogueEntry> = {
  'skyline-drift': { id: 'skyline-drift', name: 'Skyline Drift', icon: Mountain, description: 'Sustained focus glider flight over procedural alpine biomes', tag: 'Focus', badge: 'Focus', gradient: 'linear-gradient(135deg, #E8967A22, #E4B87C22)' },
  'tidal-garden': { id: 'tidal-garden', name: 'Tidal Garden', icon: Waves, description: 'Zero-failure persistent marine garden powered by Alpha calm', tag: 'Calm', badge: 'Calm', gradient: 'linear-gradient(135deg, #7B68AE22, #4A90D922)' },
  'breath-weave': { id: 'breath-weave', name: 'Breath Weave', icon: Wind, description: 'Harmonic loom tapestry synchronized with box/4-7-8 breathing', tag: 'Breathing', badge: 'Breathing', gradient: 'linear-gradient(135deg, #5C8C4622, #C4A35A22)' },
  'signal-sort': { id: 'signal-sort', name: 'Signal Sort', icon: Target, description: 'SMR stillness gate & cognitive interference filter task', tag: 'Stillness', badge: 'SMR', gradient: 'linear-gradient(135deg, #C4A35A22, #E8967A22)' },
  'rhythm-lock': { id: 'rhythm-lock', name: 'Rhythm Lock', icon: Music, description: 'Generative polyrhythmic music visualizer with layered synth feedback', tag: 'Focus', badge: 'Attention', gradient: 'linear-gradient(135deg, #4A90D922, #7B68AE22)' },
  'media-mode': { id: 'media-mode', name: 'Media Mode', icon: Tv, description: 'Watch streaming video with real-time neuro-luminosity modulation', tag: 'Universal', badge: 'Streaming', gradient: 'linear-gradient(135deg, #E4B87C22, #C4A35A22)' },
  'soundscape-mode': { id: 'soundscape-mode', name: 'Soundscape Mode', icon: Headphones, description: 'Audio-only binaural & nature soundscapes for eyes-closed training', tag: 'Audio', badge: 'Audio', gradient: 'linear-gradient(135deg, #5C8C4622, #7B68AE22)' },
  'mandala': { id: 'mandala', name: 'Mandala Breathing', icon: CircleDot, description: 'Calm concentric breathing mandala with live µV telemetry', tag: 'Calm', badge: 'Classic', gradient: 'linear-gradient(135deg, #E8967A22, #7B68AE22)' },
  'eeg-mandala': { id: 'eeg-mandala', name: 'Generative Mandala', icon: Flower2, description: 'An ornamental mandala that records neurofeedback quality as it grows', tag: 'Visual', badge: 'Visual', gradient: 'linear-gradient(135deg, #8B9D8333, #C66B3D33)' },
  'immersive-3d': { id: 'immersive-3d', name: 'Generative XR', icon: Box, description: 'Subtle atmospheric WebXR experience', tag: 'VR', badge: 'VR', gradient: 'linear-gradient(135deg, #7B68AE22, #E8967A22)' },
  'generative-music': { id: 'generative-music', name: 'Generative Music', icon: Music, description: 'Brain-state-driven melody, synthesis & rhythm — your EEG creates the music', tag: 'Music', badge: 'Music', gradient: 'linear-gradient(135deg, #4A90D922, #5C8C4622)' },
  'narrative-story': { id: 'narrative-story', name: 'Contemplative Reading', icon: BookOpen, description: 'Calm mindfulness reflections guided by neurofeedback therapy', tag: 'Reading', badge: 'Narrative', gradient: 'linear-gradient(135deg, #E8967A22, #C4A35A22)' },
  'neuro-gambit': { id: 'neuro-gambit', name: 'NeuroGambit', icon: Crown, description: 'Tactical chess calculation, impulse gating & post-blunder tilt reset', tag: 'Chess', badge: 'NEW • Chess', gradient: 'linear-gradient(135deg, rgba(232, 150, 122, 0.25), rgba(92, 140, 70, 0.25))' },
};

export function getAssignedExperienceIds(allowedExperiences: ExperienceType[]): ExperienceType[] {
  const allowed = new Set(allowedExperiences);
  return EXPERIENCE_IDS.filter((id) => allowed.has(id));
}

export function canStartAssignedExperience(allowedExperiences: ExperienceType[], experience: ExperienceType): boolean {
  return getAssignedExperienceIds(allowedExperiences).includes(experience);
}
