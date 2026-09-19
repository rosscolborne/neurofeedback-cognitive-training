import React, { useEffect } from 'react';
import { Activity, Brain, Clock3, Radio, Shield, Target, X } from 'lucide-react';
import type { ClientProfile, ExperienceType, ProtocolTemplate } from '../../types';
import {
  CLINICAL_PROTOCOL_TEMPLATES,
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';
import { getProtocolTypeForTemplate } from '../../services/protocols';

interface ProtocolDetailsModalProps {
  client: ClientProfile;
  onClose: () => void;
}

const formatIdentifier = (value: string) =>
  value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatExperience = (experience: ExperienceType) => formatIdentifier(experience);

function getDisplayedProtocol(client: ClientProfile): ProtocolTemplate | null {
  const saved = client.customProtocolConfig;
  if (saved && getProtocolTypeForTemplate(saved, client.assignedProtocol) === client.assignedProtocol) {
    return saved;
  }
  return CLINICAL_PROTOCOL_TEMPLATES.find(
    (template) => getProtocolTypeForTemplate(template) === client.assignedProtocol
  ) ?? null;
}

const Detail: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div
    style={{
      padding: '12px 14px',
      borderRadius: '16px',
      background: 'var(--surface-patient-recessed)',
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.45 }}>{value}</div>
  </div>
);

const InhibitBand: React.FC<{ band: NonNullable<ProtocolTemplate['inhibitBand1']> }> = ({ band }) => (
  <div style={{ padding: '11px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>{band.name}</div>
    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
      {band.freqMin}–{band.freqMax} Hz · threshold {band.targetThreshold}
    </div>
  </div>
);

export const ProtocolDetailsModal: React.FC<ProtocolDetailsModalProps> = ({ client, onClose }) => {
  const protocol = getDisplayedProtocol(client);
  const evidenceProtocol = getClinicalProtocolTemplate(client.assignedProtocol);
  const assignmentAlias = protocol
    ? getProtocolAssignmentAlias(protocol, client.assignedProtocol)
    : undefined;
  const evidenceProtocolName = evidenceProtocol?.name ?? protocol?.name;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'rgba(58, 49, 43, 0.58)',
        backdropFilter: 'blur(7px)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="protocol-details-title"
        style={{
          width: 'min(680px, 100%)',
          maxHeight: 'min(840px, calc(100dvh - 32px))',
          overflowY: 'auto',
          borderRadius: '28px',
          background: 'var(--surface-patient-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 24px 70px rgba(58, 49, 43, 0.2)',
        }}
      >
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '16px',
            padding: '20px 20px 16px',
            background: 'var(--surface-patient-card)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--brand-primary)', fontSize: '12px', fontWeight: 700 }}>
              <Brain size={16} /> Your assigned protocol
            </div>
            <h2 id="protocol-details-title" className="font-display" style={{ margin: '5px 0 0', fontSize: '25px', lineHeight: 1.15 }}>
              {assignmentAlias ?? evidenceProtocolName ?? formatIdentifier(client.assignedProtocol)}
            </h2>
            {assignmentAlias && evidenceProtocolName && (
              <p style={{ margin: '6px 0 0', color: 'var(--text-primary)', fontSize: '13px', lineHeight: 1.45 }}>
                <strong>Evidence-based protocol:</strong> {evidenceProtocolName}
              </p>
            )}
            {(evidenceProtocol?.clinicalName ?? protocol?.clinicalName) && (
              <p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.45 }}>
                {evidenceProtocol?.clinicalName ?? protocol?.clinicalName}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Close protocol details" style={{ padding: '7px', flexShrink: 0 }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {!protocol ? (
            <div style={{ padding: '18px', borderRadius: '18px', background: 'var(--surface-patient-recessed)', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Detailed parameters have not been added for this protocol. Your assigned training mode is {formatIdentifier(client.assignedProtocol)}.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
                <Detail label="Clinical indication" value={protocol.indication} />
                <Detail label="Protocol source" value={protocol.leadInvestigator} />
                <Detail label="Montage site" value={protocol.montageSite} />
                <Detail label="Muse channel mapping" value={protocol.museChannelMapping || 'Not specified'} />
                <Detail label="Session duration" value={`${protocol.sessionDurationMinutes} minutes`} />
                <Detail label="Adaptive sensitivity" value={`${formatIdentifier(protocol.sensitivity)} · step ${protocol.adaptiveStep}`} />
              </div>

              <div
                style={{
                  padding: '16px',
                  borderRadius: '20px',
                  background: 'var(--brand-primary-subtle)',
                  border: '1px solid color-mix(in srgb, var(--brand-primary) 24%, transparent)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--brand-primary)', fontSize: '12px', fontWeight: 700 }}>
                  <Target size={17} /> Training target
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '14px', alignItems: 'end', marginTop: '10px' }}>
                  <div>
                    <div style={{ fontSize: '16px', color: 'var(--text-primary)', fontWeight: 700 }}>{protocol.rewardBand.name}</div>
                    <div style={{ marginTop: '3px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                      Reward range {protocol.rewardBand.freqMin}–{protocol.rewardBand.freqMax} Hz
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="font-mono" style={{ fontSize: '20px', color: 'var(--brand-primary)', fontWeight: 700 }}>{protocol.rewardBand.targetThreshold}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>target {protocol.rewardBand.targetCondition}</div>
                  </div>
                </div>
              </div>

              {(protocol.inhibitBand1 || protocol.inhibitBand2) && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '9px', fontSize: '13px', fontWeight: 700 }}>
                    <Shield size={16} color="var(--brand-primary)" /> Inhibit bands
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '9px' }}>
                    {protocol.inhibitBand1 && <InhibitBand band={protocol.inhibitBand1} />}
                    {protocol.inhibitBand2 && <InhibitBand band={protocol.inhibitBand2} />}
                  </div>
                </div>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '9px', fontSize: '13px', fontWeight: 700 }}>
                  <Activity size={16} color="var(--brand-primary)" /> Recommended training experiences
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                  {protocol.recommendedExperiences.map((experience) => (
                    <span key={experience} style={{ padding: '6px 9px', borderRadius: '999px', background: 'var(--surface-patient-recessed)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {formatExperience(experience)}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ padding: '15px 16px', borderRadius: '18px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 700 }}>
                  <Clock3 size={16} color="var(--brand-primary)" /> Clinical notes
                </div>
                <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.55 }}>{protocol.clinicalNotes}</p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', color: 'var(--text-tertiary)', fontSize: '11px', lineHeight: 1.45 }}>
                <Radio size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
                These settings describe your assigned training protocol. Your clinician can update them from your clinical profile.
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
