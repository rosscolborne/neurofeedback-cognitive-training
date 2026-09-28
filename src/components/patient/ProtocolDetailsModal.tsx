import React, { useEffect } from 'react';
import { Brain, X } from 'lucide-react';
import { FactGrid } from '../ui/FactGrid';
import { describeProtocolRule } from '../protocolRuleFacts';
import type { ClientProfile, ProtocolTemplate } from '../../types';
import {
  CLINICAL_PROTOCOL_TEMPLATES,
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';
import { getProtocolTypeForTemplate, resolvePatientProtocol } from '../../services/protocols';
import { resolveProtocolRuntime } from '../../services/adaptiveEngine';
import { resolveTrainingAuthority } from '../../services/patientTrainingAuthority';

interface ProtocolDetailsModalProps {
  client: ClientProfile;
  onClose: () => void;
}

const formatIdentifier = (value?: string) =>
  value ?
  value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') : 'Unavailable';

function getDisplayedProtocol(client: ClientProfile): ProtocolTemplate | null {
  const resolvedProtocol = resolvePatientProtocol(client);
  const saved = client.customProtocolConfig;
  if (saved && getProtocolTypeForTemplate(saved, resolvedProtocol) === resolvedProtocol) {
    return saved;
  }
  return CLINICAL_PROTOCOL_TEMPLATES.find(
    (template) => getProtocolTypeForTemplate(template) === resolvedProtocol
  ) ?? null;
}

/**
 * Only notes a clinician saved with this assignment are theirs. Template rationale (also used to
 * prefill the builder) is reference text, not a note from the patient's clinician.
 */
function getClinicianAuthoredNotes(client: ClientProfile, protocol: ProtocolTemplate | null): string | null {
  const saved = client.customProtocolConfig;
  const notes = saved && protocol === saved ? saved.clinicalNotes?.trim() : undefined;
  if (!notes) return null;
  const templateNotes = getClinicalProtocolTemplate(resolvePatientProtocol(client))?.clinicalNotes?.trim();
  return notes === templateNotes ? null : notes;
}

export const ProtocolDetailsModal: React.FC<ProtocolDetailsModalProps> = ({ client, onClose }) => {
  const protocol = getDisplayedProtocol(client);
  const resolvedProtocol = resolvePatientProtocol(client);
  const evidenceProtocol = getClinicalProtocolTemplate(resolvedProtocol);
  const assignmentAlias = protocol
    ? getProtocolAssignmentAlias(protocol, resolvedProtocol)
    : undefined;
  const evidenceProtocolName = evidenceProtocol?.name ?? protocol?.name ?? formatIdentifier(resolvedProtocol);
  const runtime = resolveProtocolRuntime(client);
  const isSelfDirected = resolveTrainingAuthority(client) === 'self-directed';
  // Without a clinician there are no clinician notes to show.
  const clinicianNotes = isSelfDirected ? null : getClinicianAuthoredNotes(client, protocol);

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
          width: 'min(560px, 100%)',
          maxHeight: 'min(840px, calc(100dvh - 32px))',
          overflowY: 'auto',
          borderRadius: '24px',
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
              <Brain size={16} /> {isSelfDirected ? 'Your self-directed protocol' : 'Your assigned protocol'}
            </div>
            <h2 id="protocol-details-title" className="font-display" style={{ margin: '5px 0 0', fontSize: '25px', lineHeight: 1.15 }}>
              Protocol details
            </h2>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Close protocol details" style={{ padding: '7px', flexShrink: 0 }}>
            <X size={19} />
          </button>
        </div>

        <div style={{ padding: '20px 20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Protocol</div>
            <div style={{ marginTop: '2px', fontSize: '18px', fontWeight: 600, lineHeight: 1.3, color: 'var(--text-primary)' }}>{evidenceProtocolName}</div>
            {assignmentAlias && (
              <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Assigned as <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{assignmentAlias}</strong>
              </div>
            )}
          </div>

          {runtime.ok ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '18px', borderTop: '1px solid var(--border-subtle)' }}>
              <FactGrid
                minColumnWidth={120}
                facts={describeProtocolRule(runtime.config)}
              />
              <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                The target adjusts during training: a little harder when you are often in the zone, a little easier when you rarely are.
              </p>
            </div>
          ) : (
            <div role="alert" style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', fontSize: '13px', lineHeight: 1.5 }}>
              <strong>Training unavailable.</strong> This protocol can’t run as configured. {isSelfDirected ? 'Choose a protocol again in your training setup.' : 'Please contact your clinician.'}
            </div>
          )}

          {clinicianNotes && (
            <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'var(--surface-patient-recessed)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Note from your clinician</div>
              <p style={{ margin: '6px 0 0', color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.55, maxWidth: '60ch', whiteSpace: 'pre-line' }}>
                {clinicianNotes}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
