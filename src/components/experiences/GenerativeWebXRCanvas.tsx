import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Sparkles, Camera, RotateCcw, Palette } from 'lucide-react';

interface GenerativeArtProps {
  eegData: EEGDataPoint | null;
}

interface WatercolorDrop {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
  spreadRate: number;
}

interface SoftDriftingMote {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  opacity: number;
  phase: number;
}

const THERAPEUTIC_PALETTES = [
  {
    id: 'warm-terracotta',
    name: 'Warm Sunset & Earth',
    bg: '#0F0E13',
    primary: 'rgba(232, 150, 122, 0.28)', // Soft Terracotta
    secondary: 'rgba(245, 198, 165, 0.22)', // Warm Sand
    accent: 'rgba(255, 235, 180, 0.45)', // Soft Amber
    dotColor: '#E8967A',
  },
  {
    id: 'sage-tranquility',
    name: 'Sage Garden & Rain',
    bg: '#0C110F',
    primary: 'rgba(104, 211, 145, 0.24)', // Soft Sage
    secondary: 'rgba(79, 209, 197, 0.20)', // Pale Eucalyptus
    accent: 'rgba(230, 255, 250, 0.40)', // Dew
    dotColor: '#68D391',
  },
  {
    id: 'lavender-twilight',
    name: 'Lavender Dusk & Mist',
    bg: '#100D14',
    primary: 'rgba(159, 122, 234, 0.24)', // Soft Lavender
    secondary: 'rgba(183, 148, 244, 0.18)', // Pale Violet
    accent: 'rgba(254, 215, 226, 0.38)', // Rose Mist
    dotColor: '#9F7AEA',
  },
  {
    id: 'ocean-whisper',
    name: 'Quiet Ocean Caustics',
    bg: '#090E14',
    primary: 'rgba(74, 144, 217, 0.24)', // Soft Slate Blue
    secondary: 'rgba(129, 230, 217, 0.18)', // Seafoam
    accent: 'rgba(226, 232, 240, 0.42)', // Soft Pearl
    dotColor: '#4A90D9',
  },
];

export const GenerativeWebXRCanvas: React.FC<GenerativeArtProps> = ({ eegData }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePalette, setActivePalette] = useState(THERAPEUTIC_PALETTES[0]);
  const [snapshotSaved, setSnapshotSaved] = useState(false);

  // Smoothly interpolated values to prevent ANY abrupt visual jumps or flashing
  const smoothZoneScoreRef = useRef(0.5);
  const smoothAlphaRef = useRef(10.0);
  const dropsRef = useRef<WatercolorDrop[]>([]);
  const motesRef = useRef<SoftDriftingMote[]>([]);
  const breathingCycleRef = useRef(0);

  const inZone = eegData?.inZone ?? true;
  const rawZoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);
  const rawAlpha = eegData?.bands.alpha ?? 10.0;

  // Initialize a few gentle drifting motes (like soft sakura petals or dust in sunlight)
  useEffect(() => {
    motesRef.current = Array.from({ length: 9 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      radius: 1.5 + Math.random() * 2.0,
      vx: (Math.random() - 0.5) * 6,
      vy: -3 - Math.random() * 5, // Slow upward float
      opacity: 0.15 + Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2,
    }));
  }, []);

  // Gentle Touch: drops a soft watercolor bloom
  const handleTouch = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let x = 0;
    let y = 0;

    if ('touches' in e && e.touches.length > 0) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else if ('clientX' in e) {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    dropsRef.current.push({
      x,
      y,
      radius: 10,
      maxRadius: 100 + smoothAlphaRef.current * 4,
      color: Math.random() > 0.5 ? activePalette.primary : activePalette.secondary,
      alpha: 0.45,
      spreadRate: 14 + Math.random() * 8,
    });

    if (dropsRef.current.length > 8) {
      dropsRef.current.shift();
    }
  };

  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSnapshotSaved(true);
    setTimeout(() => setSnapshotSaved(false), 1600);

    const imageUri = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `calm-neural-art-${Date.now()}.png`;
    link.href = imageUri;
    link.click();
  };

  const handleReset = () => {
    dropsRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activePalette.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  // Ultra-Smooth, Slow-Paced Meditative Rendering Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();

    const resize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Heavy damping to ensure zero sudden jumps or visual jarring
      smoothZoneScoreRef.current += (rawZoneScore - smoothZoneScoreRef.current) * (dt * 0.8);
      smoothAlphaRef.current += (rawAlpha - smoothAlphaRef.current) * (dt * 0.8);

      const zoneScore = smoothZoneScoreRef.current;
      const alpha = smoothAlphaRef.current;

      // Slow 8-second breathing oscillation (0.125 Hz resonant breathing)
      breathingCycleRef.current += dt * (0.45 + 0.15 * zoneScore);
      const breathPhase = Math.sin(breathingCycleRef.current);
      const breathScale = 1.0 + breathPhase * 0.08;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // 1. Soft diffusion wash (simulates absorbent watercolor rice paper)
      ctx.fillStyle = activePalette.bg;
      ctx.globalAlpha = 0.035; // Ultra-slow, seamless fading
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1.0;

      // 2. Central Blooming Watercolor Cloud (Soft, warm, non-flashing)
      const baseBloomRadius = Math.min(width, height) * (0.24 + (alpha / 30) * 0.14) * breathScale;

      // Layer 1: Outermost ethereal mist
      const outerGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        baseBloomRadius * 0.2,
        centerX,
        centerY,
        baseBloomRadius * 1.6
      );
      outerGrad.addColorStop(0, activePalette.secondary);
      outerGrad.addColorStop(0.6, activePalette.primary);
      outerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = outerGrad;
      ctx.globalAlpha = 0.35 + 0.35 * zoneScore;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseBloomRadius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Layer 2: Inner warm glow
      const innerGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        2,
        centerX,
        centerY,
        baseBloomRadius * 0.75
      );
      innerGrad.addColorStop(0, activePalette.accent);
      innerGrad.addColorStop(0.5, activePalette.primary);
      innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = innerGrad;
      ctx.globalAlpha = 0.45 + 0.3 * zoneScore;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseBloomRadius * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // 3. User Watercolor Drops (Diffuse softly like ink in clear water)
      dropsRef.current.forEach((drop) => {
        drop.radius += dt * drop.spreadRate;
        drop.alpha -= dt * 0.08;

        if (drop.alpha > 0 && drop.radius < drop.maxRadius) {
          const dropGrad = ctx.createRadialGradient(drop.x, drop.y, 0, drop.x, drop.y, drop.radius);
          dropGrad.addColorStop(0, drop.color);
          dropGrad.addColorStop(0.8, drop.color);
          dropGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.fillStyle = dropGrad;
          ctx.globalAlpha = drop.alpha;
          ctx.beginPath();
          ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      });
      dropsRef.current = dropsRef.current.filter((d) => d.alpha > 0 && d.radius < d.maxRadius);

      // 4. Subtle, Slow Floating Light Motes (No fast motion or spinning)
      motesRef.current.forEach((mote) => {
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.phase += dt * 0.5;

        // Wrap around smoothly
        if (mote.y < -20) mote.y = height + 20;
        if (mote.x < -20) mote.x = width + 20;
        if (mote.x > width + 20) mote.x = -20;

        const pulseOpacity = mote.opacity * (0.7 + 0.3 * Math.sin(mote.phase)) * (0.6 + 0.4 * zoneScore);

        ctx.fillStyle = activePalette.accent;
        ctx.globalAlpha = pulseOpacity;
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [activePalette, rawZoneScore, rawAlpha]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: activePalette.bg,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      {/* Top Quiet Header */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          right: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 17, 26, 0.65)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFFFFF',
            pointerEvents: 'auto',
          }}
        >
          <Sparkles size={13} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#F0EBE1' }}>
            Tranquil Watercolor Garden
          </span>
          <span style={{ fontSize: '10px', color: inZone ? '#68D391' : '#CBD5E0' }}>
            {inZone ? '• Deep Rest' : '• Resting'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', pointerEvents: 'auto' }}>
          <button
            onClick={handleCaptureSnapshot}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 12px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Camera size={12} />
            <span>{snapshotSaved ? 'Saved!' : 'Save Art'}</span>
          </button>

          <button
            onClick={handleReset}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              color: '#CBD5E0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              backdropFilter: 'blur(8px)',
            }}
            title="Reset Canvas"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Main Meditative Canvas (Tap gently anywhere to create soft watercolor ripples) */}
      <canvas
        ref={canvasRef}
        onClick={handleTouch}
        onTouchStart={handleTouch}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      />

      {/* Gentle Bottom Prompt & Palette Dots */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 17, 26, 0.65)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 'var(--radius-full)',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 10,
        }}
      >
        <Palette size={12} color="#CBD5E0" />
        {THERAPEUTIC_PALETTES.map((pal) => (
          <div
            key={pal.id}
            onClick={() => setActivePalette(pal)}
            style={{
              width: '15px',
              height: '15px',
              borderRadius: '50%',
              backgroundColor: pal.dotColor,
              cursor: 'pointer',
              border: activePalette.id === pal.id ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.2)',
              transform: activePalette.id === pal.id ? 'scale(1.2)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
            title={pal.name}
          />
        ))}
      </div>
    </div>
  );
};
