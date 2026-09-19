import React, { useEffect } from 'react';
import { Brain, Clock3, X } from 'lucide-react';
import type { ClientProfile, ProtocolTemplate } from '../../types';
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

export const ProtocolDetailsModal: React.FC<ProtocolDetailsModalProps> = ({ client, onClose }) => {
  const protocol = getDisplayedProtocol(client);
  const evidenceProtocol = getClinicalProtocolTemplate(client.assignedProtocol);
  const assignmentAlias = protocol
    ? getProtocolAssignmentAlias(protocol, client.assignedProtocol)
    : undefined;
  const evidenceProtocolName = evidenceProtocol?.name ?? protocol?.name ?? formatIdentifier(client.assignedProtocol);

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
              Protocol details
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Close protocol details" style={{ padding: '7px', flexShrink: 0 }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
            <Detail label="Protocol" value={evidenceProtocolName} />
            <Detail label="Name" value={assignmentAlias ?? 'No custom name'} />
          </div>

          {protocol && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
              <Detail label="Reward minimum" value={`${protocol.rewardBand.freqMin} Hz`} />
              <Detail label="Reward maximum" value={`${protocol.rewardBand.freqMax} Hz`} />
              <Detail label="Threshold" value={`${protocol.rewardBand.targetThreshold} µV`} />
              <Detail label="Duration" value={`${protocol.sessionDurationMinutes} minutes`} />
            </div>
          )}

          <div style={{ padding: '15px 16px', borderRadius: '18px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', fontWeight: 700 }}>
              <Clock3 size={16} color="var(--brand-primary)" /> Clinician notes
            </div>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.55 }}>
              {protocol?.clinicalNotes || 'No clinician notes provided.'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
