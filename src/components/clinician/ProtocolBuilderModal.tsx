import React, { useState } from 'react';
import { ProtocolTemplate, ProtocolType } from '../../types';
import { X, Info } from 'lucide-react';

interface ProtocolBuilderModalProps {
  initialProtocol?: ProtocolTemplate;
  onSave: (template: ProtocolTemplate) => void;
  onClose: () => void;
}

export const CLINICAL_PROTOCOL_TEMPLATES: ProtocolTemplate[] = [
  {
    id: 'proto-lubar-tbr',
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

export const ProtocolBuilderModal: React.FC<ProtocolBuilderModalProps> = ({
  initialProtocol,
  onSave,
  onClose,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<ProtocolTemplate>(
    initialProtocol || CLINICAL_PROTOCOL_TEMPLATES[0]
  );
  const [name, setName] = useState(initialProtocol?.name || CLINICAL_PROTOCOL_TEMPLATES[0].name);
  const [montageSite, setMontageSite] = useState(initialProtocol?.montageSite || CLINICAL_PROTOCOL_TEMPLATES[0].montageSite);
  const [museMapping, setMuseMapping] = useState(
    initialProtocol?.museChannelMapping || CLINICAL_PROTOCOL_TEMPLATES[0].museChannelMapping || 'AF7 / AF8 Frontal'
  );
  const [rewardMin, setRewardMin] = useState(initialProtocol?.rewardBand.freqMin || CLINICAL_PROTOCOL_TEMPLATES[0].rewardBand.freqMin);
  const [rewardMax, setRewardMax] = useState(initialProtocol?.rewardBand.freqMax || CLINICAL_PROTOCOL_TEMPLATES[0].rewardBand.freqMax);
  const [rewardThreshold, setRewardThreshold] = useState(initialProtocol?.rewardBand.targetThreshold || CLINICAL_PROTOCOL_TEMPLATES[0].rewardBand.targetThreshold);
  const [durationMins, setDurationMins] = useState(initialProtocol?.sessionDurationMinutes || CLINICAL_PROTOCOL_TEMPLATES[0].sessionDurationMinutes);
  const [clinicalNotes, setClinicalNotes] = useState(initialProtocol?.clinicalNotes || CLINICAL_PROTOCOL_TEMPLATES[0].clinicalNotes);

  const handleSelectTemplate = (tmpl: ProtocolTemplate) => {
    setSelectedTemplate(tmpl);
    setName(tmpl.name);
    setMontageSite(tmpl.montageSite);
    setMuseMapping(tmpl.museChannelMapping || 'AF7 / AF8 Frontal');
    setRewardMin(tmpl.rewardBand.freqMin);
    setRewardMax(tmpl.rewardBand.freqMax);
    setRewardThreshold(tmpl.rewardBand.targetThreshold);
    setDurationMins(tmpl.sessionDurationMinutes);
    setClinicalNotes(tmpl.clinicalNotes);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: ProtocolTemplate = {
      ...selectedTemplate,
      id: 'custom-' + Date.now(),
      name,
      montageSite,
      museChannelMapping: museMapping,
      rewardBand: {
        ...selectedTemplate.rewardBand,
        freqMin: Number(rewardMin),
        freqMax: Number(rewardMax),
        targetThreshold: Number(rewardThreshold),
      },
      sessionDurationMinutes: Number(durationMins),
      clinicalNotes,
    };
    onSave(updated);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 250,
        backgroundColor: 'rgba(26, 26, 26, 0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="card-clinician"
        style={{
          width: '100%',
          maxWidth: '740px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-md)',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Clinical Protocol Architect (Muse S Athena Compatible)
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Evidence-based neurofeedback templates mapped to standard 10-20 sites and 4-channel Muse S Athena biosensors.
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }}>
            <X size={18} />
          </button>
        </div>

        {/* 1. Clinical Preset Templates Selection */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
            Clinical Evidence-Based Protocols
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
            {CLINICAL_PROTOCOL_TEMPLATES.map((tmpl) => (
              <div
                key={tmpl.id}
                onClick={() => handleSelectTemplate(tmpl)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: selectedTemplate.id === tmpl.id ? '2px solid var(--brand-primary)' : '1px solid var(--border-default)',
                  backgroundColor: selectedTemplate.id === tmpl.id ? 'var(--brand-primary-subtle)' : 'var(--surface-clinician-base)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{tmpl.name}</div>
                  <span className="status-tag status-tag-active" style={{ fontSize: '9px', padding: '1px 5px' }}>
                    {tmpl.montageSite.split(' ')[0]}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {tmpl.indication}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Editable Parameter Form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid var(--border-default)', paddingTop: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Protocol Assignment Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                10-20 Standard Site
              </label>
              <input
                type="text"
                value={montageSite}
                onChange={(e) => setMontageSite(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Muse S Athena Channel Mapping
              </label>
              <input
                type="text"
                value={museMapping}
                onChange={(e) => setMuseMapping(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Reward & Inhibit Frequency Bounds */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward Min (Hz)
              </label>
              <input
                type="number"
                step="0.5"
                value={rewardMin}
                onChange={(e) => setRewardMin(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward Max (Hz)
              </label>
              <input
                type="number"
                step="0.5"
                value={rewardMax}
                onChange={(e) => setRewardMax(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Threshold (µV)
              </label>
              <input
                type="number"
                step="0.1"
                value={rewardThreshold}
                onChange={(e) => setRewardThreshold(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Duration (Min)
              </label>
              <input
                type="number"
                value={durationMins}
                onChange={(e) => setDurationMins(parseInt(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Physician Clinical Notes & Rationale
            </label>
            <textarea
              value={clinicalNotes}
              onChange={(e) => setClinicalNotes(e.target.value)}
              style={{
                width: '100%',
                height: '56px',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '12px',
                resize: 'none',
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
            <button type="submit" className="btn btn-dense" style={{ flex: 1, padding: '10px 14px', fontSize: '13px', minWidth: '160px' }}>
              Assign Protocol Configuration
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost" style={{ flex: 1, padding: '10px 14px', fontSize: '13px', minWidth: '100px' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
