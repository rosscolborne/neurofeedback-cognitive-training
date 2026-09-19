import type { ProtocolTemplate, ProtocolType } from '../types';

export const CLINICAL_PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    id: 'proto-lubar-tbr',
    protocolType: 'theta-beta-ratio',
    name: 'Lubar Theta/Beta Ratio Protocol',
    clinicalName: 'Frontal Theta Suppression with Beta Upregulation',
    leadInvestigator: 'Joel F. Lubar, Ph.D. (BCN Pioneer)',
    indication: 'ADHD (Inattentive & Combined), Executive Dysfunction',
    montageSite: 'Fz / Cz (10-20 System)',
    museChannelMapping: 'AF7 / AF8 Frontal (Virtual Fz Midline TBR)',
    rewardBand: {
      name: 'Beta Focus',
      freqMin: 15.0,
      freqMax: 18.0,
      targetCondition: 'above',
      targetThreshold: 8.5,
    },
    inhibitBand1: {
      name: 'Theta Inattention',
      freqMin: 4.0,
      freqMax: 8.0,
      targetThreshold: 7.2,
    },
    inhibitBand2: {
      name: 'High-Beta Muscle Noise',
      freqMin: 22.0,
      freqMax: 32.0,
      targetThreshold: 12.0,
    },
    adaptiveStep: 0.08,
    sensitivity: 'balanced',
    sessionDurationMinutes: 25,
    recommendedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock', 'eeg-mandala', 'neuro-gambit'],
    clinicalNotes: 'Target TBR < 1.85 at Fz midline. High efficacy for sustained concentration and reduced impulsivity on Muse S Athena.',
  },
  {
    id: 'proto-sterman-smr',
    protocolType: 'smr-enhancement',
    name: 'Sterman SMR Stillness Protocol',
    clinicalName: 'Sensorimotor Rhythm (12-15 Hz) Enhancement',
    leadInvestigator: 'M. Barry Sterman, Ph.D. (UCLA Brain Research)',
    indication: 'ADHD (Hyperactive), Physical Restlessness, Sleep Latency',
    montageSite: 'Cz (Central Sensorimotor Cortex)',
    museChannelMapping: 'TP9 / TP10 & Central Sensorimotor Synchrony',
    rewardBand: {
      name: 'SMR Rhythm',
      freqMin: 12.0,
      freqMax: 15.0,
      targetCondition: 'above',
      targetThreshold: 7.5,
    },
    inhibitBand1: {
      name: 'Theta Drift',
      freqMin: 4.0,
      freqMax: 7.0,
      targetThreshold: 6.5,
    },
    inhibitBand2: {
      name: 'EMG Jaw/Muscle Tension',
      freqMin: 23.0,
      freqMax: 35.0,
      targetThreshold: 11.0,
    },
    adaptiveStep: 0.5,
    sensitivity: 'high',
    sessionDurationMinutes: 25,
    recommendedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'signal-sort', 'rhythm-lock', 'skyline-drift', 'media-mode', 'eeg-mandala', 'neuro-gambit'],
    clinicalNotes: 'Reinforces motor inhibition pathways ("active mind, still body"). Reduces motor tic latency.',
  },
  {
    id: 'proto-hardt-alpha',
    protocolType: 'alpha-enhancement',
    name: 'Hardt Alpha Synchrony Protocol',
    clinicalName: 'Parieto-Occipital Alpha (8-12 Hz) Enhancement',
    leadInvestigator: 'James V. Hardt, Ph.D. (Biocybernaut Institute)',
    indication: 'Generalized Anxiety, Somatic Worry, Executive Burnout',
    montageSite: 'Pz / Oz (Parietal-Occipital)',
    museChannelMapping: 'TP9 / TP10 Temporoparietal Posterior Alpha',
    rewardBand: {
      name: 'Alpha Synchrony',
      freqMin: 8.0,
      freqMax: 12.0,
      targetCondition: 'above',
      targetThreshold: 11.5,
    },
    inhibitBand1: {
      name: 'High Beta Hyperarousal',
      freqMin: 19.0,
      freqMax: 28.0,
      targetThreshold: 8.0,
    },
    adaptiveStep: 0.6,
    sensitivity: 'balanced',
    sessionDurationMinutes: 25,
    recommendedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'tidal-garden', 'breath-weave', 'soundscape-mode', 'mandala', 'eeg-mandala'],
    clinicalNotes: 'Upregulates dominant posterior alpha rhythm to dissolve rumination and induce physiological equanimity.',
  },
  {
    id: 'proto-peniston-alphatheta',
    protocolType: 'alpha-theta-crossover',
    name: 'Peniston Alpha-Theta Protocol',
    clinicalName: 'Alpha-Theta Crossover Deep State Training',
    leadInvestigator: 'Eugene G. Peniston, Ed.D. (Addiction Protocol)',
    indication: 'Trauma Desensitization, PTSD, Emotional Regulation',
    montageSite: 'Pz (Midline Parietal)',
    museChannelMapping: 'TP9 / TP10 Posterior Hypnagogic Crossover',
    rewardBand: {
      name: 'Theta Hypnagogia',
      freqMin: 4.0,
      freqMax: 8.0,
      targetCondition: 'above',
      targetThreshold: 1.0,
    },
    inhibitBand1: {
      name: 'Beta Cognition',
      freqMin: 15.0,
      freqMax: 25.0,
      targetThreshold: 6.0,
    },
    adaptiveStep: 0.5,
    sensitivity: 'low',
    sessionDurationMinutes: 30,
    recommendedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'soundscape-mode', 'breath-weave', 'mandala', 'eeg-mandala'],
    clinicalNotes: 'Facilitates restorative crossover states where theta power temporarily surpasses posterior alpha.',
  },
  {
    id: 'proto-beta-down',
    protocolType: 'beta-downtraining',
    name: 'Beta De-arousal Downtraining',
    clinicalName: 'High-Beta (18-30 Hz) Power Suppression',
    leadInvestigator: 'Clinical Evidence-Based Guideline',
    indication: 'Insomnia, Cognitive Overdrive, Physical Muscle Guarding',
    montageSite: 'Cz / Pz',
    museChannelMapping: 'AF7 / AF8 & TP9 / TP10 Global Beta Suppression',
    rewardBand: {
      name: 'Alpha Equilibrium',
      freqMin: 9.0,
      freqMax: 12.0,
      targetCondition: 'above',
      targetThreshold: 10.0,
    },
    inhibitBand1: {
      name: 'High Beta Anxiety',
      freqMin: 18.0,
      freqMax: 30.0,
      targetThreshold: 6.0,
    },
    adaptiveStep: 0.5,
    sensitivity: 'balanced',
    sessionDurationMinutes: 20,
    recommendedExperiences: ['immersive-3d', 'generative-music', 'narrative-story', 'breath-weave', 'tidal-garden', 'mandala', 'eeg-mandala'],
    clinicalNotes: 'Direct inhibition of hyper-vigilant beta rhythms for rapid sympathetic nervous system down-regulation.',
  },
];

export function getClinicalProtocolTemplate(protocolType: ProtocolType): ProtocolTemplate | undefined {
  return CLINICAL_PROTOCOL_TEMPLATES.find((template) => template.protocolType === protocolType);
}

/** Read aliases saved before `alias` was introduced without changing Firestore data. */
export function getProtocolAssignmentAlias(
  protocol: ProtocolTemplate,
  protocolType: ProtocolType
): string | undefined {
  const explicitAlias = protocol.alias?.trim();
  if (explicitAlias) return explicitAlias;

  const canonical = getClinicalProtocolTemplate(protocolType);
  const legacyName = protocol.name?.trim();
  return canonical && legacyName && legacyName !== canonical.name ? legacyName : undefined;
}
