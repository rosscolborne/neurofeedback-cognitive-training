import React, { useState } from 'react';
import { ProtocolTemplate, ProtocolType } from '../../types';
import { CheckCircle2, X } from 'lucide-react';
import {
  CLINICAL_PROTOCOL_TEMPLATES,
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
  hasCanonicalRewardDefinition,
} from '../../services/clinicalProtocolTemplates';
import { DEFAULT_BETA_BAND_HZ, getDefaultProtocolThreshold, getProtocolTypeForTemplate } from '../../services/protocols';
import { validateCustomRewardBand } from '../../services/adaptiveEngine';

interface ProtocolBuilderModalProps {
  assignedProtocol?: ProtocolType;
  initialProtocol?: ProtocolTemplate;
  onSave: (template: ProtocolTemplate) => Promise<void>;
  onClose: () => void;
}

export const ProtocolBuilderModal: React.FC<ProtocolBuilderModalProps> = ({
  assignedProtocol,
  initialProtocol,
  onSave,
  onClose,
}) => {
  const initialProtocolType = assignedProtocol
    ?? (initialProtocol ? getProtocolTypeForTemplate(initialProtocol) : CLINICAL_PROTOCOL_TEMPLATES[0].protocolType!);
  const initialEvidenceTemplate = getClinicalProtocolTemplate(initialProtocolType) ?? CLINICAL_PROTOCOL_TEMPLATES[0];
  const [selectedTemplate, setSelectedTemplate] = useState<ProtocolTemplate>(
    initialEvidenceTemplate
  );
  const [alias, setAlias] = useState(
    initialProtocol ? getProtocolAssignmentAlias(initialProtocol, initialProtocolType) ?? '' : ''
  );
  const [montageSite, setMontageSite] = useState(initialProtocol?.montageSite || initialEvidenceTemplate.montageSite);
  const [museMapping, setMuseMapping] = useState(
    initialProtocol?.museChannelMapping || initialEvidenceTemplate.museChannelMapping || 'AF7 / AF8 Frontal'
  );
  const [rewardMin, setRewardMin] = useState(initialProtocol?.rewardBand?.freqMin ?? initialEvidenceTemplate.rewardBand.freqMin);
  const [rewardMax, setRewardMax] = useState(initialProtocol?.rewardBand?.freqMax ?? initialEvidenceTemplate.rewardBand.freqMax);
  const [rewardCondition, setRewardCondition] = useState(initialProtocol?.rewardBand?.targetCondition ?? initialEvidenceTemplate.rewardBand.targetCondition);
  const [rewardThreshold, setRewardThreshold] = useState(initialProtocol?.rewardBand?.targetThreshold ?? initialEvidenceTemplate.rewardBand.targetThreshold);
  const [durationMins, setDurationMins] = useState(initialProtocol?.sessionDurationMinutes || initialEvidenceTemplate.sessionDurationMinutes);
  const [clinicalNotes, setClinicalNotes] = useState(initialProtocol?.clinicalNotes || initialEvidenceTemplate.clinicalNotes);
  const [customRewardEnabled, setCustomRewardEnabled] = useState(Boolean(
    initialProtocol && (initialProtocol.customRewardEnabled
      || !hasCanonicalRewardDefinition(initialProtocol.rewardBand, initialEvidenceTemplate.rewardBand))
  ));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSelectTemplate = (tmpl: ProtocolTemplate) => {
    setSelectedTemplate(tmpl);
    setMontageSite(tmpl.montageSite);
    setMuseMapping(tmpl.museChannelMapping || 'AF7 / AF8 Frontal');
    setRewardMin(tmpl.rewardBand.freqMin);
    setRewardMax(tmpl.rewardBand.freqMax);
    setRewardCondition(tmpl.rewardBand.targetCondition);
    setRewardThreshold(tmpl.rewardBand.targetThreshold);
    setCustomRewardEnabled(false);
    setSaveError(null);
    setDurationMins(tmpl.sessionDurationMinutes);
    setClinicalNotes(tmpl.clinicalNotes);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: ProtocolTemplate = {
      ...selectedTemplate,
      id: 'custom-' + Date.now(),
      alias: alias.trim() || undefined,
      montageSite,
      museChannelMapping: museMapping,
      customRewardEnabled,
      rewardBand: customRewardEnabled ? {
        ...selectedTemplate.rewardBand,
        freqMin: Number(rewardMin),
        freqMax: Number(rewardMax),
        targetCondition: rewardCondition,
        targetThreshold: Number(rewardThreshold),
      } : { ...selectedTemplate.rewardBand },
      sessionDurationMinutes: Number(durationMins),
      clinicalNotes,
    };
    if (customRewardEnabled) {
      const error = validateCustomRewardBand(updated.rewardBand);
      if (error) { setSaveError(error); return; }
    }
    setSaveError(null);
    setIsSaving(true);
    try {
      await onSave(updated);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The protocol assignment could not be saved.');
    } finally {
      setIsSaving(false);
    }
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
            {CLINICAL_PROTOCOL_TEMPLATES.map((tmpl) => {
              const isSelected = selectedTemplate.id === tmpl.id;
              return (
                <button
                  type="button"
                  key={tmpl.id}
                  onClick={() => handleSelectTemplate(tmpl)}
                  aria-pressed={isSelected}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: isSelected ? '2px solid #2563EB' : '1px solid var(--border-default)',
                    outline: isSelected ? '2px solid rgba(37, 99, 235, 0.18)' : 'none',
                    outlineOffset: '2px',
                    backgroundColor: isSelected ? '#EFF6FF' : 'var(--surface-clinician-base)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease, outline-color 0.15s ease, background-color 0.15s ease',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{tmpl.name}</div>
                    {isSelected ? (
                      <CheckCircle2 size={16} color="#2563EB" style={{ flexShrink: 0, marginLeft: '8px' }} />
                    ) : (
                      <span className="status-tag status-tag-active" style={{ fontSize: '9px', padding: '1px 5px' }}>
                        {tmpl.montageSite.split(' ')[0]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {tmpl.indication}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Editable Parameter Form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid var(--border-default)', paddingTop: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Custom Alias (Optional)
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g., Morning Focus Plan"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
              <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                The evidence-based protocol name remains {selectedTemplate.name}.
              </div>
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
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Site, channel mapping, and clinical notes document this assignment; they do not change training feedback.
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {selectedTemplate.protocolType === 'beta-downtraining'
              ? `Default beta training measures ${DEFAULT_BETA_BAND_HZ.min}–${DEFAULT_BETA_BAND_HZ.max} Hz peak amplitude and rewards at or below ${getDefaultProtocolThreshold('beta-downtraining')} µV.`
              : `Without a custom reward, ${selectedTemplate.protocolType?.replace(/-/g, ' ')} training rewards values ${selectedTemplate.protocolType === 'theta-beta-ratio' ? 'at or below' : 'at or above'} ${getDefaultProtocolThreshold(selectedTemplate.protocolType!)}.`}
            {' '}Select custom reward criteria to measure a chosen frequency range and reward its amplitude at or above/below a threshold.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 }}>
            <input
              type="checkbox"
              aria-label="Use clinician-defined reward criteria"
              checked={customRewardEnabled}
              onChange={(e) => {
                setCustomRewardEnabled(e.target.checked);
                setSaveError(null);
                if (e.target.checked && selectedTemplate.protocolType === 'beta-downtraining') {
                  setRewardMin(DEFAULT_BETA_BAND_HZ.min);
                  setRewardMax(DEFAULT_BETA_BAND_HZ.max);
                  setRewardCondition('below');
                  setRewardThreshold(getDefaultProtocolThreshold('beta-downtraining'));
                } else if (!e.target.checked) {
                  setRewardMin(selectedTemplate.rewardBand.freqMin);
                  setRewardMax(selectedTemplate.rewardBand.freqMax);
                  setRewardCondition(selectedTemplate.rewardBand.targetCondition);
                  setRewardThreshold(selectedTemplate.rewardBand.targetThreshold);
                }
              }}
            />
            Use clinician-defined reward criteria for training
          </label>

          {customRewardEnabled && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Min Frequency (Hz)
              </label>
              <input
                type="number"
                aria-label="Min Frequency"
                min="3"
                max="44.5"
                step="0.5"
                value={rewardMin}
                onChange={(e) => setRewardMin(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Max Frequency (Hz)
              </label>
              <input
                type="number"
                aria-label="Max Frequency"
                min="3.5"
                max="45"
                step="0.5"
                value={rewardMax}
                onChange={(e) => setRewardMax(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward condition
              </label>
              <select
                aria-label="Reward condition"
                value={rewardCondition}
                onChange={(e) => setRewardCondition(e.target.value as 'above' | 'below')}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              >
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Reward threshold (µV)
              </label>
              <input
                type="number"
                aria-label="Reward threshold"
                min="0"
                max="1000"
                step="0.1"
                value={rewardThreshold}
                onChange={(e) => setRewardThreshold(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' }}
              />
            </div>
          </div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
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

          {saveError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '12px' }}>{saveError}</div>}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
            <button type="submit" disabled={isSaving} className="btn btn-dense" style={{ flex: 1, padding: '10px 14px', fontSize: '13px', minWidth: '160px' }}>
              {isSaving ? 'Saving…' : 'Assign Protocol Configuration'}
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
