import React, { useEffect, useRef } from 'react';
import { ArrowRight, ShieldCheck, Sparkles, Activity, Zap } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';

interface NeuralImprintCardProps {
  alphaPeakHz: number;
  alphaReactivityPercent: number;
  cognitiveDynamicRange: number;
  signalPurityPercent: number;
  patientName?: string;
  deviceName?: string;
  onSave: () => void;
  saving?: boolean;
}

export const NeuralImprintCard: React.FC<NeuralImprintCardProps> = ({
  alphaPeakHz,
  alphaReactivityPercent,
  cognitiveDynamicRange,
  signalPurityPercent,
  patientName = 'Patient',
  deviceName = 'Muse Headband',
  onSave,
  saving = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate a unique harmonic mandala glyph representing their individual neural signature
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 180;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const baseRadius = 55;

    // Harmonic Petals / Symmetry derived from Peak Alpha Frequency
    // (e.g. 10.2Hz -> ~10-fold symmetry)
    const lobes = Math.max(6, Math.min(14, Math.round(alphaPeakHz)));
    const modulation = 16 * (alphaReactivityPercent / 100);

    ctx.clearRect(0, 0, size, size);

    // Subtle background circle
    ctx.fillStyle = 'rgba(232, 150, 122, 0.05)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 75, 0, Math.PI * 2);
    ctx.fill();

    // 1. Outer Harmonic Ring
    ctx.strokeStyle = 'rgba(232, 150, 122, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let theta = 0; theta <= Math.PI * 2 + 0.05; theta += 0.02) {
      const r = baseRadius + Math.sin(theta * lobes) * (modulation * 0.5);
      const x = centerX + r * Math.cos(theta);
      const y = centerY + r * Math.sin(theta);
      if (theta === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 2. Inner Resonant Ribbon (Alpha Waveform)
    ctx.strokeStyle = '#D16D4D';
    ctx.lineWidth = 2.2;
    ctx.shadowColor = 'rgba(209, 109, 77, 0.4)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let theta = 0; theta <= Math.PI * 2 + 0.05; theta += 0.02) {
      const r = baseRadius * 0.75 + Math.cos(theta * (lobes / 2)) * modulation;
      const x = centerX + r * Math.cos(theta);
      const y = centerY + r * Math.sin(theta);
      if (theta === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 3. Central Core Node
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#D16D4D';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, [alphaPeakHz, alphaReactivityPercent]);

  return (
    <div
      className="card-patient"
      style={{
        width: '100%',
        maxWidth: '440px',
        margin: '0 auto',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        background: '#FFFFFF',
        borderRadius: 'var(--radius-xl, 24px)',
        border: '1px solid var(--border-default, #E8E6E1)',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.06)',
        animation: 'fadeIn 0.5s ease-out',
      }}
    >
      {/* Brand & Provenance Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <BrandLogo size={24} variant="terracotta" />
        <span
          style={{
            fontSize: '12px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--text-tertiary, #8C8578)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          Individual Neural Imprint
        </span>
      </div>

      <h2
        className="font-display"
        style={{
          fontSize: '28px',
          fontWeight: 400,
          color: 'var(--text-primary, #1A1A1A)',
          letterSpacing: '-0.02em',
          margin: '0 0 6px',
        }}
      >
        Baseline Calibrated
      </h2>

      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-secondary, #6B6560)',
          maxWidth: '300px',
          lineHeight: 1.45,
          margin: '0 0 24px',
        }}
      >
        Measured directly from your {deviceName} across 4 physical scalp electrodes.
      </p>

      {/* Unique Harmonic Neural Glyph */}
      <div
        style={{
          position: 'relative',
          width: '180px',
          height: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        <div
          style={{
            position: 'absolute',
            bottom: '2px',
            background: 'var(--surface-patient-recessed, #F2F1EE)',
            border: '1px solid var(--border-subtle, #F2F1EE)',
            padding: '3px 10px',
            borderRadius: '9999px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-secondary, #6B6560)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Sparkles size={11} color="var(--brand-primary, #D16D4D)" />
          {patientName}'s Signature
        </div>
      </div>

      {/* 2x2 Telemetry Metric Grid */}
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '28px',
        }}
      >
        {/* Metric 1: Peak Alpha Frequency */}
        <div
          style={{
            background: 'var(--surface-patient-recessed, #F8F7F4)',
            padding: '16px',
            borderRadius: 'var(--radius-md, 12px)',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#7B68AE' }}>
            <Activity size={15} />
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
              Peak Alpha (PAF)
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-primary, #1A1A1A)',
            }}
          >
            {alphaPeakHz.toFixed(1)} <span style={{ fontSize: '13px', fontWeight: 400 }}>Hz</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
            Individual alpha pace
          </div>
        </div>

        {/* Metric 2: Alpha Reactivity */}
        <div
          style={{
            background: 'var(--surface-patient-recessed, #F8F7F4)',
            padding: '16px',
            borderRadius: 'var(--radius-md, 12px)',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#5C8C46' }}>
            <Sparkles size={15} />
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
              Reactivity
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-primary, #1A1A1A)',
            }}
          >
            +{Math.round(alphaReactivityPercent)}%
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
            Eyes-closed surge
          </div>
        </div>

        {/* Metric 3: Focus Dynamic Range */}
        <div
          style={{
            background: 'var(--surface-patient-recessed, #F8F7F4)',
            padding: '16px',
            borderRadius: 'var(--radius-md, 12px)',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#C4A35A' }}>
            <Zap size={15} />
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
              Focus Range
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-primary, #1A1A1A)',
            }}
          >
            {cognitiveDynamicRange.toFixed(1)}x
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
            Beta activation range
          </div>
        </div>

        {/* Metric 4: Signal Purity */}
        <div
          style={{
            background: 'var(--surface-patient-recessed, #F8F7F4)',
            padding: '16px',
            borderRadius: 'var(--radius-md, 12px)',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#4A90D9' }}>
            <ShieldCheck size={15} />
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>
              Signal Purity
            </span>
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: 'var(--text-primary, #1A1A1A)',
            }}
          >
            {Math.round(signalPurityPercent)}%
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
            Hardware integrity
          </div>
        </div>
      </div>

      {/* Primary Action Button */}
      <button
        onClick={onSave}
        disabled={saving}
        className="btn btn-primary"
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '16px',
          borderRadius: 'var(--radius-xl, 20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          backgroundColor: 'var(--brand-primary, #D16D4D)',
          color: '#FFFFFF',
          border: 'none',
          cursor: saving ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
          transition: 'all 0.2s ease',
        }}
      >
        <span>{saving ? 'Saving Baseline...' : 'Save Neural Imprint & Enter'}</span>
        <ArrowRight size={18} />
      </button>
    </div>
  );
};
