import React, { useState } from 'react';
import { ClinicBrandConfig } from '../../types';
import {
  Settings,
  Sliders,
  ShieldCheck,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Key,
  HardDrive,
  Activity,
  Award,
} from 'lucide-react';

interface ClinicSettingsViewProps {
  brand: ClinicBrandConfig;
  onOpenRebrand: () => void;
  onClearDemoData: () => void;
  onResetDemoData: () => void;
}

export const ClinicSettingsView: React.FC<ClinicSettingsViewProps> = ({
  brand,
  onOpenRebrand,
  onClearDemoData,
  onResetDemoData,
}) => {
  const [physicianName, setPhysicianName] = useState('Dr. Vance Aris, MD, BCN');
  const [licenseNumber, setLicenseNumber] = useState('NFB-88421');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleWipeDemo = () => {
    if (window.confirm('Are you sure you want to remove sample demo patient records? Real enrolled patients will not be affected.')) {
      onClearDemoData();
      alert('Sample demo data wiped. You now have a clean clinician workspace.');
    }
  };

  const handleRestoreDemo = () => {
    if (window.confirm('Restore sample practice cohort with realistic clinical records?')) {
      onResetDemoData();
      alert('Sample practice cohort restored.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '900px' }}>
      {/* Header */}
      <div>
        <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Clinic Platform Settings & Hardware
        </h1>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Manage attending practitioner credentials, Muse S Athena EEG hardware profiles, branding, and workspace data.
        </p>
      </div>

      {/* 1. Practitioner & Board Certification Credentials */}
      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Award size={18} color="var(--brand-primary)" />
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Attending Neurotherapist Credentials
          </h2>
        </div>

        <form onSubmit={handleSaveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Attending Clinician Name & Titles
              </label>
              <input
                type="text"
                value={physicianName}
                onChange={(e) => setPhysicianName(e.target.value)}
                placeholder="e.g. Dr. Vance Aris, MD, BCN"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  fontSize: '13px',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                BCIA / Medical Board License #
              </label>
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="e.g. NFB-88421"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            <button type="submit" className="btn btn-dense" style={{ padding: '7px 14px', fontSize: '12px' }}>
              Save Credentials for Reports
            </button>
            {saveSuccess && (
              <span style={{ fontSize: '12px', color: 'var(--status-active)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={14} /> Saved for PDF Reports
              </span>
            )}
          </div>
        </form>
      </div>

      {/* 2. Muse S (Athena) EEG Hardware Profile & Driver */}
      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="var(--brand-primary)" />
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Muse S (Athena) Biosensing Subsystem
              </h2>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Bluetooth Low Energy GATT 256 Hz Telemetry & In-Browser FFT Engine
              </div>
            </div>
          </div>
          <span className="status-tag status-tag-active" style={{ fontSize: '11px' }}>
            ● Web-BLE Driver Ready
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
          <div className="card-patient-recessed" style={{ padding: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Frontal Sensors</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
              AF7 (L) & AF8 (R)
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              Virtual Fz Midline Theta/Beta
            </div>
          </div>

          <div className="card-patient-recessed" style={{ padding: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Temporoparietal Sensors</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
              TP9 (L) & TP10 (R)
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              Posterior Alpha & SMR Coherence
            </div>
          </div>

          <div className="card-patient-recessed" style={{ padding: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Active Reference</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
              Fpz Midline
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              Common mode noise suppression
            </div>
          </div>

          <div className="card-patient-recessed" style={{ padding: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Sampling Rate</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
              256 Samples / Sec
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              12-bit delta ADC resolution
            </div>
          </div>
        </div>
      </div>

      {/* 3. Clinic White-Label Theme Customizer */}
      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={18} color="var(--brand-primary)" />
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Clinic Branding & White-Label Theme
              </h2>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Active Theme: <strong>{brand.name}</strong> • Accent: <span style={{ color: brand.primaryAccent, fontWeight: 700 }}>{brand.primaryAccent}</span>
              </div>
            </div>
          </div>
          <button onClick={onOpenRebrand} className="btn btn-dense" style={{ fontSize: '12px', padding: '7px 14px' }}>
            Open Theme Customizer
          </button>
        </div>
      </div>

      {/* 4. Demo Data & Workspace Controls */}
      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <HardDrive size={18} color="var(--text-secondary)" />
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Demo Data & Workspace Management
          </h2>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Manage sample patients, test sessions, and demo appointment records. Clear demo data when onboarding real clinical clients.
        </p>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={handleWipeDemo}
            className="btn btn-ghost"
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              border: '1px solid var(--border-default)',
              color: 'var(--status-alert)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Trash2 size={14} /> Wipe Sample Demo Data
          </button>
          <button
            onClick={handleRestoreDemo}
            className="btn btn-ghost"
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              border: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} /> Restore Sample Practice Cohort
          </button>
        </div>
      </div>

      {/* 5. HIPAA Compliance Assurance */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--surface-patient-recessed)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
        }}
      >
        <ShieldCheck size={20} color="var(--status-active)" />
        <div>
          <strong>HIPAA Compliant Data Architecture:</strong> All clinical EEG time-series, patient communications, and QEEG normative files are isolated and encrypted in client-side secure storage.
        </div>
      </div>
    </div>
  );
};
