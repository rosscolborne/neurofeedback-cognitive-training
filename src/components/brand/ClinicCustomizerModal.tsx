import React, { useEffect, useState, useRef } from 'react';
import { ClinicBrandConfig } from '../../types';
import { BRAND_COLOR_PRESETS, calculateContrast, createBrandPalette, applyBrandToDOM, getOnPrimaryColor, isValidHexColor } from '../../services/brandEngine';
import { clinicSettingsRepository } from '../../services/clinicSettingsRepository';
import { errorMessage } from '../../services/clinicSettingsState';
import { BrandLogo } from './BrandLogo';
import { X, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';

interface ClinicCustomizerModalProps {
  currentBrand: ClinicBrandConfig;
  onSave: (newBrand: ClinicBrandConfig) => void;
  onClose: () => void;
}

export const ClinicCustomizerModal: React.FC<ClinicCustomizerModalProps> = ({
  currentBrand,
  onSave,
  onClose,
}) => {
  const [clinicName, setClinicName] = useState(currentBrand.name);
  const [tagline, setTagline] = useState(currentBrand.tagline);
  const [accentColor, setAccentColor] = useState(currentBrand.primaryAccent);
  const [logoUrl, setLogoUrl] = useState(currentBrand.logoUrl);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    clinicSettingsRepository.load().then((snapshot) => {
      if (!active) return;
      if (snapshot.brand) {
        setClinicName(snapshot.brand.name);
        setTagline(snapshot.brand.tagline);
        setAccentColor(snapshot.brand.primaryAccent);
        setLogoUrl(snapshot.brand.logoUrl);
        applyBrandToDOM(snapshot.brand);
      } else if (snapshot.clinic?.name) {
        setClinicName(snapshot.clinic.name);
      } else {
        setClinicName('');
      }
      setStatusMessage(snapshot.brandSource === 'legacy-local' ? 'A matching local theme was found. Save to sync it to this clinic.' : '');
      setLoadState('ready');
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadState('error');
      setStatusMessage(errorMessage(error, 'Clinic branding could not be loaded.'));
    });
    return () => { active = false; };
  }, []);

  // Compute live contrast audit against white card and patient base
  const auditedAccent = isValidHexColor(accentColor) ? accentColor : currentBrand.primaryAccent;
  const contrastOnWhite = calculateContrast(auditedAccent, '#FFFFFF');
  const textOnAccentContrast = calculateContrast(getOnPrimaryColor(auditedAccent), auditedAccent);

  const handleApplyPreset = (accent: string) => {
    setAccentColor(accent);
    if (clinicName.trim()) applyBrandToDOM(createBrandPalette(accent, clinicName, logoUrl));
  };

  const handleColorChange = (hex: string) => {
    setAccentColor(hex);
    if (isValidHexColor(hex) && clinicName.trim()) applyBrandToDOM(createBrandPalette(hex, clinicName, logoUrl));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/svg+xml', 'image/png', 'image/webp'].includes(file.type)) {
      setStatusMessage('Choose an SVG, PNG, or WebP image.');
      return;
    }
    if (file.size > 500_000) {
      setStatusMessage('Logo files must be 500 KB or smaller so the clinic record can be saved.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaveState('saving');
    setStatusMessage('');
    try {
      const finalBrand = createBrandPalette(accentColor, clinicName, logoUrl);
      finalBrand.tagline = tagline.trim();
      const savedBrand = await clinicSettingsRepository.saveBrand(finalBrand);
      applyBrandToDOM(savedBrand);
      onSave(savedBrand);
      onClose();
    } catch (error) {
      setSaveState('error');
      setStatusMessage(errorMessage(error, 'Clinic branding could not be saved. Try again.'));
    }
  };

  const handleClose = () => {
    applyBrandToDOM(currentBrand);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
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
          maxWidth: '560px',
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
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '19px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Clinic Branding & Theme Customizer
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Configure your clinic identity, custom logo, and primary accent palette with live WCAG AA contrast validation.
            </p>
          </div>
          <button onClick={handleClose} className="btn btn-ghost" style={{ padding: '6px' }} aria-label="Close clinic branding customizer">
            <X size={18} />
          </button>
        </div>

        {statusMessage && <div role={loadState === 'error' || saveState === 'error' ? 'alert' : 'status'} style={{ padding: '9px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-patient-recessed)', color: loadState === 'error' || saveState === 'error' ? 'var(--status-alert)' : 'var(--text-secondary)', fontSize: '12px' }}>{statusMessage}</div>}

        {/* Color-only presets intentionally preserve the authenticated clinic identity. */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
            Color presets
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {BRAND_COLOR_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => handleApplyPreset(p.accent)}
                disabled={loadState !== 'ready' || saveState === 'saving'}
                style={{
                  background: 'var(--surface-clinician-base)',
                  border: accentColor === p.accent ? '2px solid var(--brand-primary)' : '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: p.accent }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.label}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{p.accent}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Clinic Name & Tagline */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Clinic Display Name
            </label>
            <input
              type="text"
              value={clinicName}
              disabled={loadState !== 'ready' || saveState === 'saving'}
              onChange={e => setClinicName(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Clinic Tagline
            </label>
            <input
              type="text"
              value={tagline}
              disabled={loadState !== 'ready' || saveState === 'saving'}
              onChange={e => setTagline(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Custom Logo File Upload */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Clinic Logo Upload (SVG, PNG, WebP)
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              backgroundColor: 'var(--surface-clinician-base)',
            }}
          >
            {logoUrl && (logoUrl.startsWith('data:image') || logoUrl.startsWith('http')) ? (
              <img
                src={logoUrl}
                alt="Clinic Logo Preview"
                style={{ width: '42px', height: '42px', objectFit: 'contain', borderRadius: '8px' }}
              />
            ) : (
              <BrandLogo size={42} variant="terracotta" />
            )}

            <div style={{ flex: 1 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/svg+xml,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleLogoUpload}
              />
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px', gap: '6px' }}
                >
                  <Upload size={14} /> Upload Custom Logo File
                </button>
                {logoUrl !== '/app-logo.png' && (
                  <button
                    type="button"
                    onClick={() => setLogoUrl('/app-logo.png')}
                    className="btn btn-ghost"
                    style={{ padding: '6px 10px', fontSize: '11px' }}
                  >
                    Reset to Default
                  </button>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Supported formats: SVG vector, transparent PNG, or WebP (square recommended)
              </div>
            </div>
          </div>
        </div>

        {/* Primary Accent Color Picker */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            Primary Accent Color (Token: <code className="font-mono" style={{ color: 'var(--brand-primary)' }}>brand.primary</code>)
          </label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="color"
              value={auditedAccent}
              onChange={e => handleColorChange(e.target.value)}
              style={{
                width: '48px',
                height: '40px',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                padding: '2px',
              }}
            />
            <input
              type="text"
              value={accentColor}
              onChange={e => handleColorChange(e.target.value)}
              className="font-mono"
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Live Automated WCAG Contrast Verification Panel */}
        <div
          style={{
            backgroundColor: 'var(--surface-patient-recessed)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              WCAG 2.1 Contrast Audit
            </span>
            <span className="status-tag status-tag-active" style={{ fontSize: '11px' }}>
              Contrast Ratio: {contrastOnWhite.ratioFormatted}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {contrastOnWhite.passesAALarge ? <ShieldCheck size={14} color="var(--status-active)" /> : <AlertTriangle size={14} color="var(--status-alert)" />}
              <span>AA Large (3.0:1)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {textOnAccentContrast.passesAANormal ? <ShieldCheck size={14} color="var(--status-active)" /> : <AlertTriangle size={14} color="var(--status-alert)" />}
              <span>Button Text (4.5:1)</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button onClick={() => void handleSave()} disabled={loadState !== 'ready' || saveState === 'saving'} className="btn btn-dense" style={{ flex: 1, padding: '12px' }}>
            {saveState === 'saving' ? 'Saving…' : 'Save and apply clinic branding'}
          </button>
          <button onClick={handleClose} disabled={saveState === 'saving'} className="btn btn-ghost" style={{ flex: 1 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
