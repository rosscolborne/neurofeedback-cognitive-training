import React, { useEffect, useState } from 'react';
import type { ClinicBrandConfig } from '../../types';
import { clinicSettingsRepository } from '../../services/clinicSettingsRepository';
import { errorMessage, settingsNotice, type SettingsLoadState } from '../../services/clinicSettingsState';
import { Activity, Award, CheckCircle2, ShieldCheck, Sliders } from 'lucide-react';

interface ClinicSettingsViewProps {
  brand: ClinicBrandConfig;
  onOpenRebrand: () => void;
  /** Retained temporarily for shell compatibility; production settings no longer expose demo-data controls. */
  onClearDemoData: () => void;
  /** Retained temporarily for shell compatibility; production settings no longer expose demo-data controls. */
  onResetDemoData: () => void;
}

export const ClinicSettingsView: React.FC<ClinicSettingsViewProps> = ({ brand, onOpenRebrand }) => {
  const [loadState, setLoadState] = useState<SettingsLoadState>({ status: 'loading' });
  const [clinicName, setClinicName] = useState('');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [practitionerName, setPractitionerName] = useState('');
  const [licenseIdentifier, setLicenseIdentifier] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let active = true;
    clinicSettingsRepository.load().then((snapshot) => {
      if (!active) return;
      setClinicName(snapshot.clinic?.name ?? '');
      setTimezone(snapshot.clinic?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      setPractitionerName(snapshot.practitioner?.displayName ?? '');
      setLicenseIdentifier(snapshot.practitioner?.credentials[0]?.identifier ?? '');
      setLoadState({ status: 'ready', snapshot });
    }).catch((error: unknown) => {
      if (active) setLoadState({ status: 'error', message: errorMessage(error, 'Clinic settings could not be loaded.') });
    });
    return () => { active = false; };
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveState('saving');
    setSaveError('');
    try {
      const snapshot = await clinicSettingsRepository.saveSettings({ clinicName, timezone, practitionerName, licenseIdentifier });
      setLoadState({ status: 'ready', snapshot });
      setSaveState('saved');
    } catch (error) {
      setSaveError(errorMessage(error, 'Clinic settings could not be saved. Try again.'));
      setSaveState('error');
    }
  };

  const notice = settingsNotice(loadState);
  const isUnavailable = loadState.status === 'error';
  const isLoading = loadState.status === 'loading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '900px' }}>
      <div>
        <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Clinic and practitioner settings</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>Manage the clinic identity and practitioner details used in your workspace and reports.</p>
      </div>

      {notice && (
        <div role={loadState.status === 'error' ? 'alert' : 'status'} style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-patient-recessed)', fontSize: '12px', color: loadState.status === 'error' ? 'var(--status-alert)' : 'var(--text-secondary)' }}>
          {notice}
        </div>
      )}

      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Award size={18} color="var(--brand-primary)" />
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Clinic and practitioner profile</h2>
        </div>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <label style={labelStyle}>Clinic name<input required disabled={isLoading || isUnavailable || saveState === 'saving'} value={clinicName} onChange={(event) => setClinicName(event.target.value)} placeholder="Enter your clinic name" style={inputStyle} /></label>
            <label style={labelStyle}>Clinic timezone<input required disabled={isLoading || isUnavailable || saveState === 'saving'} value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="e.g. America/Toronto" style={inputStyle} /></label>
            <label style={labelStyle}>Practitioner name and titles<input required disabled={isLoading || isUnavailable || saveState === 'saving'} value={practitionerName} onChange={(event) => setPractitionerName(event.target.value)} placeholder="Enter your professional display name" style={inputStyle} /></label>
            <label style={labelStyle}>License or certification identifier (optional)<input disabled={isLoading || isUnavailable || saveState === 'saving'} value={licenseIdentifier} onChange={(event) => setLicenseIdentifier(event.target.value)} placeholder="Enter an identifier; verification is separate" style={inputStyle} /></label>
          </div>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-tertiary)' }}>Entered credentials are stored as unverified until a separate verification process is available.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="submit" disabled={isLoading || isUnavailable || saveState === 'saving'} className="btn btn-dense" style={{ padding: '7px 14px', fontSize: '12px' }}>{saveState === 'saving' ? 'Saving…' : 'Save profile'}</button>
            {saveState === 'saved' && <span role="status" style={{ fontSize: '12px', color: 'var(--status-active)', display: 'flex', gap: '4px', alignItems: 'center' }}><CheckCircle2 size={14} /> Saved</span>}
            {saveState === 'error' && <span role="alert" style={{ fontSize: '12px', color: 'var(--status-alert)' }}>{saveError}</span>}
          </div>
        </form>
      </div>

      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '14px' }}>
          <Activity size={18} color="var(--brand-primary)" />
          <div><h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Supported hardware reference</h2><div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Product capability information only — not a live device or patient assignment status.</div></div>
        </div>
        <div style={{ padding: '12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-patient-recessed)' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Muse-compatible browser training</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>The application includes browser Bluetooth support for compatible devices. No device assignment, connection, firmware, signal quality, or readiness information is available on this settings page.</div>
        </div>
      </div>

      <div className="card-clinician" style={{ padding: '20px', backgroundColor: '#FFFFFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Sliders size={18} color="var(--brand-primary)" /><div><h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Clinic branding</h2><div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Current preview: <strong>{brand.name}</strong> · <span style={{ color: brand.primaryAccent, fontWeight: 700 }}>{brand.primaryAccent}</span></div></div></div>
          <button onClick={onOpenRebrand} className="btn btn-dense" style={{ fontSize: '12px', padding: '7px 14px' }}>Open theme customizer</button>
        </div>
      </div>

      <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--surface-patient-recessed)', display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
        <ShieldCheck size={20} color="var(--text-secondary)" />
        <div><strong>Access boundary:</strong> clinic and practitioner records are loaded through the signed-in account and clinic membership. Compliance certification is not inferred from this screen.</div>
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' };
const inputStyle: React.CSSProperties = { display: 'block', width: '100%', marginTop: '4px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '13px' };
