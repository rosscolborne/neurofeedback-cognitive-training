import React, { useState } from 'react';
import { ExperienceType, ProtocolTemplate, ProtocolType } from '../../types';
import { X, Check, Activity, Sliders, ShieldCheck, Sparkles, Plus } from 'lucide-react';

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
    recommendedExperiences: ['skyline-drift', 'signal-sort', 'media-mode', 'rhythm-lock'],
    clinicalNotes: 'Target TBR < 1.85 at Fz midline. High efficacy for sustained concentration and reduced impulsivity.',
  },
  {
    id: 'proto-sterman-smr',
    name: 'Sterman SMR Stillness Protocol',
    clinicalName: 'Sensorimotor Rhythm (12-15 Hz) Enhancement',
    leadInvestigator: 'M. Barry Sterman, Ph.D. (UCLA Brain Research)',
    indication: 'ADHD (Hyperactive), Physical Restlessness, Sleep Latency',
    montageSite: 'Cz (Central Sensorimotor Cortex)',
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
    recommendedExperiences: ['signal-sort', 'rhythm-lock', 'skyline-drift', 'media-mode'],
    clinicalNotes: 'Reinforces motor inhibition pathways ("active mind, still body"). Reduces motor tic latency.',
  },
  {
    id: 'proto-hardt-alpha',
    name: 'Hardt Alpha Synchrony Protocol',
    clinicalName: 'Parieto-Occipital Alpha (8-12 Hz) Enhancement',
    leadInvestigator: 'James V. Hardt, Ph.D. (Biocybernaut Institute)',
    indication: 'Generalized Anxiety, Somatic Worry, Executive Burnout',
    montageSite: 'Pz / Oz (Parietal-Occipital)',
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
    recommendedExperiences: ['tidal-garden', 'breath-weave', 'soundscape-mode', 'mandala'],
    clinicalNotes: 'Upregulates dominant posterior alpha rhythm to dissolve rumination and induce physiological equanimity.',
  },
  {
    id: 'proto-peniston-alpha-theta',
    name: 'Peniston Alpha-Theta Crossover',
    clinicalName: 'Hypnagogic Twilight State Crossover (Eyes-Closed)',
    leadInvestigator: 'Eugene G. Peniston, Ed.D. & Paul C. Kulkosky, Ph.D.',
    indication: 'PTSD, Deep Trauma Reprocessing, Severe Stress',
    montageSite: 'Pz (Parietal Midline)',
    rewardBand: {
      name: 'Theta / Alpha Ratio',
      freqMin: 5.0,
      freqMax: 8.0,
      targetCondition: 'above',
      targetThreshold: 1.0, // Crossover index
    },
    adaptiveStep: 0.05,
    sensitivity: 'low',
    sessionDurationMinutes: 30,
    recommendedExperiences: ['soundscape-mode', 'breath-weave'],
    clinicalNotes: 'Prescribed exclusively with clinician supervision. Fosters deep subconscious emotional integration.',
  },
  {
    id: 'proto-beta-inhibit',
    name: 'High-Beta Somatic Inhibit Protocol',
    clinicalName: 'Central High-Beta Downtraining (19-32 Hz)',
    leadInvestigator: 'Siegfried & Susan Othmer (EEG Spectrum)',
    indication: 'Panic Disorder, Insomnia, Fibromyalgia Somatic Tension',
    montageSite: 'C3 / C4 (Bilateral Sensorimotor)',
    rewardBand: {
      name: 'Low Beta / SMR',
      freqMin: 12.0,
      freqMax: 15.0,
      targetCondition: 'above',
      targetThreshold: 6.0,
    },
    inhibitBand1: {
      name: 'High-Beta Hyperarousal',
      freqMin: 19.0,
      freqMax: 32.0,
      targetThreshold: 9.0,
    },
    adaptiveStep: 0.8,
    sensitivity: 'high',
    sessionDurationMinutes: 20,
    recommendedExperiences: ['breath-weave', 'tidal-garden', 'soundscape-mode'],
    clinicalNotes: 'Reduces autonomic fight-or-flight sympathetic overdrive prior to evening rest.',
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

  // Editable Form State
  const [name, setName] = useState(selectedTemplate.name);
  const [montageSite, setMontageSite] = useState(selectedTemplate.montageSite);
  const [rewardMin, setRewardMin] = useState(selectedTemplate.rewardBand.freqMin);
  const [rewardMax, setRewardMax] = useState(selectedTemplate.rewardBand.freqMax);
  const [rewardThreshold, setRewardThreshold] = useState(selectedTemplate.rewardBand.targetThreshold);
  const [inhibit1Threshold, setInhibit1Threshold] = useState(selectedTemplate.inhibitBand1?.targetThreshold || 7.0);
  const [durationMins, setDurationMins] = useState(selectedTemplate.sessionDurationMinutes);
  const [clinicalNotes, setClinicalNotes] = useState(selectedTemplate.clinicalNotes);

  const handleSelectTemplate = (tmpl: ProtocolTemplate) => {
    setSelectedTemplate(tmpl);
    setName(tmpl.name);
    setMontageSite(tmpl.montageSite);
    setRewardMin(tmpl.rewardBand.freqMin);
    setRewardMax(tmpl.rewardBand.freqMax);
    setRewardThreshold(tmpl.rewardBand.targetThreshold);
    setInhibit1Threshold(tmpl.inhibitBand1?.targetThreshold || 7.0);
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
      rewardBand: {
        ...selectedTemplate.rewardBand,
        freqMin: Number(rewardMin),
        freqMax: Number(rewardMax),
        targetThreshold: Number(rewardThreshold),
      },
      inhibitBand1: selectedTemplate.inhibitBand1 ? {
        ...selectedTemplate.inhibitBand1,
        targetThreshold: Number(inhibit1Threshold),
      } : undefined,
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
        padding: '20px',
      }}
    >
      <div
        className="card-clinician"
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-md)',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '19px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Clinical Neurofeedback Protocol Architect
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Select an evidence-based clinical template or customize reward/inhibit parameters for this patient.
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }}>
            <X size={18} />
          </button>
        </div>

        {/* 1. Clinical Preset Templates Selection */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
            Evidence-Based Clinical Protocol Templates
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {CLINICAL_PROTOCOL_TEMPLATES.map(tmpl => (
              <div
                key={tmpl.id}
                onClick={() => handleSelectTemplate(tmpl)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: selectedTemplate.id === tmpl.id ? '2px solid var(--brand-primary)' : '1px solid var(--border-default)',
                  backgroundColor: selectedTemplate.id === tmpl.id ? 'var(--brand-primary-subtle)' : 'var(--surface-clinician-base)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{tmpl.name}</div>
                  <span className="status-tag status-tag-active" style={{ fontSize: '9px', padding: '2px 6px' }}>
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
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-default)', paddingTop: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Protocol Assignment Label
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                10-20 Electrode Site
              </label>
              <input
                type="text"
                value={montageSite}
                onChange={e => setMontageSite(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Reward & Inhibit Frequency Bounds */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward Freq Min (Hz)
              </label>
              <input
                type="number"
                step="0.5"
                value={rewardMin}
                onChange={e => setRewardMin(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward Freq Max (Hz)
              </label>
              <input
                type="number"
                step="0.5"
                value={rewardMax}
                onChange={e => setRewardMax(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward Threshold (µV)
              </label>
              <input
                type="number"
                step="0.1"
                value={rewardThreshold}
                onChange={e => setRewardThreshold(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Session Duration (Min)
              </label>
              <input
                type="number"
                value={durationMins}
                onChange={e => setDurationMins(parseInt(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Physician Clinical Notes & Rationale
            </label>
            <textarea
              value={clinicalNotes}
              onChange={e => setClinicalNotes(e.target.value)}
              style={{
                width: '100%',
                height: '60px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '12px',
                resize: 'none',
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button type="submit" className="btn btn-dense" style={{ flex: 1, padding: '12px' }}>
              Assign Protocol to Patient Profile
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
