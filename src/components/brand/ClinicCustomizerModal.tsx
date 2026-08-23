import React, { useState, useRef } from 'react';
import { ClinicBrandConfig } from '../../types';
import { BRAND_PRESETS, calculateContrast, createBrandPalette, applyBrandToDOM } from '../../services/brandEngine';
import { X, Check, Upload, Image as ImageIcon, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Compute live contrast audit against white card and patient base
  const contrastOnWhite = calculateContrast(accentColor, '#FFFFFF');
  const contrastOnBase = calculateContrast(accentColor, '#F8F7F4');
  const textOnAccentContrast = calculateContrast('#FFFFFF', accentColor);

  const handleApplyPreset = (preset: ClinicBrandConfig) => {
    setClinicName(preset.name);
    setTagline(preset.tagline);
    setAccentColor(preset.primaryAccent);
    setLogoUrl(preset.logoUrl);
    applyBrandToDOM(preset);
  };

  const handleColorChange = (hex: string) => {
    setAccentColor(hex);
    const temp = createBrandPalette(hex, clinicName, logoUrl);
    applyBrandToDOM(temp);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const finalBrand = createBrandPalette(accentColor, clinicName, logoUrl);
    finalBrand.tagline = tagline;
    onSave(finalBrand);
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
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Preset Clinic Brands */}
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
            Curated Clinic Brand Themes
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {BRAND_PRESETS.map(p => (
              <button
                key={p.clinicId}
                onClick={() => handleApplyPreset(p)}
                style={{
                  background: 'var(--surface-clinician-base)',
                  border: accentColor === p.primaryAccent ? '2px solid var(--brand-primary)' : '1px solid var(--border-default)',
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
                <div style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: p.primaryAccent }} />
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{p.primaryAccent}</div>
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
            {logoUrl && logoUrl.startsWith('data:image') ? (
              <img
                src={logoUrl}
                alt="Clinic Logo Preview"
                style={{ width: '42px', height: '42px', objectFit: 'contain', borderRadius: '4px' }}
              />
            ) : (
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--brand-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '18px',
                }}
              >
                ●
              </div>
            )}

            <div style={{ flex: 1 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg,image/webp"
                onChange={handleLogoUpload}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ghost"
                style={{ padding: '6px 12px', fontSize: '12px', border: '1px solid var(--border-default)', backgroundColor: '#FFFFFF' }}
              >
                <Upload size={14} /> Upload Custom Logo File
              </button>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                Recommended: transparent PNG or vector SVG (max 2MB)
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
              value={accentColor}
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
          <button onClick={handleSave} className="btn btn-dense" style={{ flex: 1, padding: '12px' }}>
            Save & Apply Custom Clinic Branding
          </button>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
