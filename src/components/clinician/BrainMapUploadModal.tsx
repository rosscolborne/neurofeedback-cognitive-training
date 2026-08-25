import React, { useState, useRef } from 'react';
import { QEEGBrainMap } from '../../types';
import { X, Brain } from 'lucide-react';

interface BrainMapUploadModalProps {
  patientName: string;
  onSave: (map: QEEGBrainMap) => void;
  onClose: () => void;
}

export const BrainMapUploadModal: React.FC<BrainMapUploadModalProps> = ({
  patientName,
  onSave,
  onClose,
}) => {
  const [fileName, setFileName] = useState('');
  const [deviceSource, setDeviceSource] = useState('Deymed 19-Ch QEEG TruScan');
  const [frontalThetaZ, setFrontalThetaZ] = useState(2.1);
  const [centralBetaZ, setCentralBetaZ] = useState(0.4);
  const [occipitalAlphaZ, setOccipitalAlphaZ] = useState(-1.2);
  const [dominantAlphaPeak, setDominantAlphaPeak] = useState(9.8);
  const [technicianNotes, setTechnicianNotes] = useState('Elevated frontal theta (4-8Hz) excess noted in F3, Fz, F4 relative to normative database (Z > +2.0).');
  const [isUploaded, setIsUploaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsUploaded(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const map: QEEGBrainMap = {
      id: 'qeeg-' + Date.now(),
      uploadDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      fileName: fileName || 'In_Clinic_QEEG_Scan.edf',
      recordingDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      deviceSource,
      technicianNotes,
      zScores: {
        frontalTheta: Number(frontalThetaZ),
        centralBeta: Number(centralBetaZ),
        occipitalAlpha: Number(occipitalAlphaZ),
        temporalDelta: 0.8,
        sensorimotorSMR: 1.1,
      },
      dominantAlphaPeakHz: Number(dominantAlphaPeak),
    };

    onSave(map);
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
          maxWidth: '640px',
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
              Import Clinical QEEG Brain Map
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Upload in-clinic 19-channel EEG recordings or quantitative normative Z-scores for {patientName}.
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Upload File Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: '18px',
            textAlign: 'center',
            backgroundColor: 'var(--surface-clinician-base)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".edf,.csv,.json,.png,.jpg,.pdf"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <Brain size={28} color="var(--brand-primary)" />
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {fileName ? fileName : 'Drag & drop QEEG export file, or tap to browse'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Supported formats: European Data Format (.EDF), CSV, JSON, or Topographic scan images
          </div>
          {isUploaded && (
            <span className="status-tag status-tag-active" style={{ marginTop: '4px', fontSize: '10px' }}>
              ✓ File Attached & Ready for Ingestion
            </span>
          )}
        </div>

        {/* Quantitative EEG Parameters Form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Acquisition Device & Montage System
            </label>
            <select
              value={deviceSource}
              onChange={e => setDeviceSource(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '12px',
                outline: 'none',
                background: '#FFFFFF',
              }}
            >
              <option value="Deymed 19-Ch QEEG TruScan">Deymed 19-Ch QEEG TruScan (10-20 Standard)</option>
              <option value="BrainMaster Discovery 24E">BrainMaster Discovery 24E (NeuroGuide DB)</option>
              <option value="NeuroField Q21 QEEG System">NeuroField Q21 QEEG System</option>
              <option value="Mitsar EEG-201 19-Channel">Mitsar EEG-201 19-Channel (WinEEG)</option>
            </select>
          </div>

          {/* Quantitative Z-Score Deviations from Normative Database */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                Frontal Theta (Z)
              </label>
              <input
                type="number"
                step="0.1"
                value={frontalThetaZ}
                onChange={e => setFrontalThetaZ(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                Central Beta (Z)
              </label>
              <input
                type="number"
                step="0.1"
                value={centralBetaZ}
                onChange={e => setCentralBetaZ(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                Occipital Alpha (Z)
              </label>
              <input
                type="number"
                step="0.1"
                value={occipitalAlphaZ}
                onChange={e => setOccipitalAlphaZ(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>
                Dominant Alpha (Hz)
              </label>
              <input
                type="number"
                step="0.1"
                value={dominantAlphaPeak}
                onChange={e => setDominantAlphaPeak(parseFloat(e.target.value))}
                style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '12px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              QEEG Interpretation & Neurotherapy Plan
            </label>
            <textarea
              value={technicianNotes}
              onChange={e => setTechnicianNotes(e.target.value)}
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
              Ingest & Link Brain Map
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
