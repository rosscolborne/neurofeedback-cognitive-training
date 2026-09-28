import React, { useEffect, useState } from 'react';
import { Compass, RotateCcw, X } from 'lucide-react';
import type { ClientProfile, ExperienceType, ProtocolType } from '../../types';
import { resolvePatientProtocol } from '../../services/protocols';
import {
  ClinicianManagedTrainingError,
  getSelfDirectedProtocolChoice,
  normalizeExperienceSelection,
  SELF_DIRECTED_PROTOCOL_CHOICES,
  usesProtocolDefaultExperiences,
  type SelfDirectedTrainingSetup,
} from '../../services/patientTrainingAuthority';
import { EXPERIENCE_CATALOGUE, EXPERIENCE_IDS } from './experienceCatalogue';

interface SelfDirectedSetupModalProps {
  client: ClientProfile;
  onSave: (setup: SelfDirectedTrainingSetup) => Promise<void>;
  onClose: () => void;
}

export const SelfDirectedSetupModal: React.FC<SelfDirectedSetupModalProps> = ({ client, onSave, onClose }) => {
  const currentProtocol = resolvePatientProtocol(client);
  const [protocol, setProtocol] = useState<ProtocolType | null>(
    getSelfDirectedProtocolChoice(currentProtocol) ? currentProtocol : null,
  );
  const [experiences, setExperiences] = useState<ExperienceType[]>(() => normalizeExperienceSelection(client.allowedExperiences));
  const [showExperiences, setShowExperiences] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set once a save finds a clinician now manages this plan; further saves would be refused too.
  const [clinicianManaged, setClinicianManaged] = useState(false);
  const choice = getSelfDirectedProtocolChoice(protocol ?? undefined);
  const usesDefaults = protocol ? usesProtocolDefaultExperiences(protocol, experiences) : false;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSaving, onClose]);

  const chooseProtocol = (next: ProtocolType) => {
    const nextChoice = getSelfDirectedProtocolChoice(next);
    if (!nextChoice || next === protocol) return;
    setProtocol(next);
    setExperiences([...nextChoice.defaultExperiences]);
    setSaveError(null);
  };

  const toggleExperience = (id: ExperienceType) => {
    setExperiences((current) => normalizeExperienceSelection(
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    ));
    setSaveError(null);
  };

  const save = async () => {
    if (!protocol || experiences.length === 0 || isSaving || clinicianManaged) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({ assignedProtocol: protocol, allowedExperiences: experiences });
    } catch (error) {
      if (error instanceof ClinicianManagedTrainingError) setClinicianManaged(true);
      setSaveError(error instanceof Error ? error.message : 'Your training setup could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', background: 'rgba(58, 49, 43, 0.58)', backdropFilter: 'blur(7px)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="training-setup-title"
        aria-describedby="training-setup-intro"
        style={{
          width: 'min(560px, 100%)', maxHeight: 'min(840px, calc(100dvh - 32px))', overflowY: 'auto',
          borderRadius: '28px', background: 'var(--surface-patient-card)', border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 70px rgba(58, 49, 43, 0.2)',
        }}
      >
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: '16px', padding: '20px 20px 16px', background: 'var(--surface-patient-card)', borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--brand-primary)', fontSize: '12px', fontWeight: 700 }}>
              <Compass size={16} aria-hidden="true" /> Self-directed
            </div>
            <h2 id="training-setup-title" className="font-display" style={{ margin: '5px 0 0', fontSize: '25px', lineHeight: 1.15 }}>
              Training setup
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="btn btn-ghost" aria-label="Close training setup" style={{ padding: '7px', flexShrink: 0 }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: '18px 20px 22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <p id="training-setup-intro" style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
            Choose the protocol you want to train with. Its default experiences are switched on for you, and you can adjust them below.
          </p>

          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <legend style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Protocol</legend>
            {SELF_DIRECTED_PROTOCOL_CHOICES.map((option) => {
              const selected = option.protocol === protocol;
              return (
                <label
                  key={option.protocol}
                  style={{
                    display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px', cursor: 'pointer',
                    borderRadius: '16px', border: selected ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    background: selected ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-card)',
                  }}
                >
                  <input
                    type="radio"
                    name="self-directed-protocol"
                    value={option.protocol}
                    checked={selected}
                    onChange={() => chooseProtocol(option.protocol)}
                    disabled={isSaving}
                    style={{ marginTop: '3px', accentColor: 'var(--brand-primary)' }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                    <span style={{ fontSize: '14px', fontWeight: 650, color: 'var(--text-primary)' }}>{option.name}</span>
                    <span style={{ fontSize: '12px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>{option.description}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {option.focus} · {option.defaultExperiences.length} default experiences
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {choice && (
            <div style={{ borderRadius: '16px', border: '1px solid var(--border-subtle)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 650 }}>Experiences</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {usesDefaults
                      ? `Using the ${experiences.length} defaults for this protocol`
                      : `Customized: ${experiences.length} of ${EXPERIENCE_IDS.length} experiences`}
                  </div>
                </div>
                {!usesDefaults && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={isSaving}
                    onClick={() => { setExperiences([...choice.defaultExperiences]); setSaveError(null); }}
                    style={{ padding: '8px 12px', fontSize: '13px' }}
                  >
                    <RotateCcw size={14} aria-hidden="true" /> Use protocol defaults
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-expanded={showExperiences}
                  aria-controls="training-setup-experiences"
                  onClick={() => setShowExperiences((open) => !open)}
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                >
                  {showExperiences ? 'Hide experiences' : 'Customize experiences'}
                </button>
              </div>
              {showExperiences && (
                <div id="training-setup-experiences" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <fieldset aria-label="Available experiences" style={{ border: 0, margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '6px 12px' }}>
                    {EXPERIENCE_IDS.map((id) => (
                      <label key={id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', padding: '6px 0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={experiences.includes(id)}
                          onChange={() => toggleExperience(id)}
                          disabled={isSaving}
                          style={{ accentColor: 'var(--brand-primary)' }}
                        />
                        {EXPERIENCE_CATALOGUE[id].name}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
              {experiences.length === 0 && (
                <div role="alert" style={{ fontSize: '12px', color: 'var(--status-alert)' }}>Choose at least one training experience.</div>
              )}
            </div>
          )}

          <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
            Self-directed training is for general practice. It is not a diagnosis or a treatment plan. If you connect with a clinician, their training plan replaces this setup.
          </p>

          {saveError && <div role="alert" style={{ fontSize: '13px', color: 'var(--status-alert)' }}>{saveError}</div>}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isSaving}>{clinicianManaged ? 'Close' : 'Cancel'}</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={!protocol || experiences.length === 0 || isSaving || clinicianManaged}
            >
              {isSaving ? 'Saving…' : 'Save setup'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
