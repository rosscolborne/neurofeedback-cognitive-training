import React, { useState } from 'react';
import { X } from 'lucide-react';
import {
  beginManualBrainMapSubmission,
  EMPTY_MANUAL_BRAIN_MAP,
  finishManualBrainMapSubmission,
  INITIAL_MANUAL_BRAIN_MAP_SUBMISSION_STATE,
  runManualBrainMapSubmission,
  type ManualBrainMapInput,
  type ManualBrainMapSave,
} from './brainMapManualEntry';

interface BrainMapUploadModalProps {
  patientName: string;
  onSave: ManualBrainMapSave;
  onClose: () => void;
}

const Z_FIELDS: Array<{ key: keyof ManualBrainMapInput; label: string }> = [
  { key: 'frontalTheta', label: 'Frontal Theta (Z)' },
  { key: 'centralBeta', label: 'Central Beta (Z)' },
  { key: 'occipitalAlpha', label: 'Occipital Alpha (Z)' },
  { key: 'temporalDelta', label: 'Temporal Delta (Z)' },
  { key: 'sensorimotorSMR', label: 'Sensorimotor SMR (Z)' },
  { key: 'dominantAlphaPeakHz', label: 'Dominant Alpha (Hz)' },
];

export const BrainMapUploadModal: React.FC<BrainMapUploadModalProps> = ({ patientName, onSave, onClose }) => {
  const [input, setInput] = useState<ManualBrainMapInput>({ ...EMPTY_MANUAL_BRAIN_MAP });
  const [submission, setSubmission] = useState(INITIAL_MANUAL_BRAIN_MAP_SUBMISSION_STATE);
  const { errors, isSaving } = submission;

  const setField = (field: keyof ManualBrainMapInput, value: string) => {
    setInput((current) => ({ ...current, [field]: value }));
    setSubmission(INITIAL_MANUAL_BRAIN_MAP_SUBMISSION_STATE);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    setSubmission(beginManualBrainMapSubmission());
    const result = await runManualBrainMapSubmission(input, onSave, () => onClose());
    if (!result.ok) {
      setSubmission(finishManualBrainMapSubmission(result));
      return;
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, backgroundColor: 'rgba(26, 26, 26, 0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="card-clinician" role="dialog" aria-modal="true" aria-labelledby="manual-qeeg-title" style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: '#FFFFFF', borderRadius: 'var(--radius-md)', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '18px', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
          <div>
            <h2 id="manual-qeeg-title" style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Add Manual QEEG Record</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.5 }}>
              Enter values already produced by a validated clinical system for {patientName}. This form does not upload, parse, or calculate QEEG data.
            </p>
          </div>
          <button onClick={onClose} disabled={isSaving} className="btn btn-ghost" style={{ padding: '6px' }} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Recording date
              <input type="date" value={input.recordingDate} onChange={(event) => setField('recordingDate', event.target.value)} disabled={isSaving} style={{ width: '100%', marginTop: '4px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }} />
            </label>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Acquisition device/source
              <input type="text" value={input.deviceSource} onChange={(event) => setField('deviceSource', event.target.value)} placeholder="Enter source exactly as documented" disabled={isSaving} style={{ width: '100%', marginTop: '4px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            {Z_FIELDS.map(({ key, label }) => (
              <label key={key} style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {label}
                <input type="number" step="any" value={input[key]} onChange={(event) => setField(key, event.target.value)} placeholder="Required" disabled={isSaving} style={{ width: '100%', marginTop: '3px', padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }} />
              </label>
            ))}
          </div>

          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Technician notes (optional)
            <textarea value={input.technicianNotes} onChange={(event) => setField('technicianNotes', event.target.value)} placeholder="Enter only documented observations" disabled={isSaving} style={{ width: '100%', height: '64px', marginTop: '4px', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px', resize: 'vertical' }} />
          </label>

          {errors.length > 0 && (
            <div role="alert" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-clinician-base)', color: 'var(--status-alert)', fontSize: '11px' }}>
              <strong>Record not saved.</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
            <button type="submit" disabled={isSaving} className="btn btn-dense" style={{ flex: 1, padding: '10px 14px', fontSize: '13px', minWidth: '160px' }}>{isSaving ? 'Saving…' : 'Save Manual Record'}</button>
            <button type="button" onClick={onClose} disabled={isSaving} className="btn btn-ghost" style={{ flex: 1, padding: '10px 14px', fontSize: '13px', minWidth: '100px' }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};
