import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Sparkles, Camera, RotateCcw, Palette, Wind } from 'lucide-react';

interface GenerativeArtProps {
  eegData: EEGDataPoint | null;
}

interface SilkWave {
  angle: number;
  radius: number;
  speed: number;
  color: string;
  opacity: number;
  thickness: number;
}

interface SoftParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
}

const PALETTES = [
  { id: 'dawn-gold', name: 'Dawn Gold & Terracotta', primary: '#E8967A', secondary: '#FFD700', bg: '#0A0A12', glow: 'rgba(232, 150, 122, 0.4)' },
  { id: 'aurora-emerald', name: 'Celestial Aurora', primary: '#68D391', secondary: '#4FD1C5', bg: '#081014', glow: 'rgba(104, 211, 145, 0.4)' },
  { id: 'ocean-sapphire', name: 'Oceanic Serenity', primary: '#4A90D9', secondary: '#81E6D9', bg: '#060B14', glow: 'rgba(74, 144, 217, 0.4)' },
  { id: 'twilight-amethyst', name: 'Twilight Amethyst', primary: '#9F7AEA', secondary: '#F687B3', bg: '#0C0814', glow: 'rgba(159, 122, 234, 0.4)' },
];

export const GenerativeWebXRCanvas: React.FC<GenerativeArtProps> = ({ eegData }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePalette, setActivePalette] = useState(PALETTES[0]);
  const [snapshotSaved, setSnapshotSaved] = useState(false);

  const touchRipplesRef = useRef<Array<{ x: number; y: number; radius: number; maxRadius: number; alpha: number }>>([]);
  const particlesRef = useRef<SoftParticle[]>([]);
  const timeRef = useRef(0);
  const isTouchingRef = useRef(false);

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);
  const alphaPower = eegData?.bands.alpha ?? 10.0;
  const coherence = eegData?.coherence ?? 75;
  const smrPower = eegData?.bands.smr ?? 7.0;

  // Touch / Drag Interaction
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

    touchRipplesRef.current.push({
      x,
      y,
      radius: 5,
      maxRadius: 80 + (alphaPower / 25) * 60,
      alpha: 0.7,
    });

    if (touchRipplesRef.current.length > 12) {
      touchRipplesRef.current.shift();
    }
  };

  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSnapshotSaved(true);
    setTimeout(() => setSnapshotSaved(false), 1600);

    const imageUri = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `neural-artwork-${Date.now()}.png`;
    link.href = imageUri;
    link.click();
  };

  const handleReset = () => {
    touchRipplesRef.current = [];
    particlesRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = activePalette.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  // 60 FPS Organic Generative Silk & Aura Engine
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
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;
      timeRef.current += dt * (0.6 + zoneScore * 0.4);
      const time = timeRef.current;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // 1. Gentle darkroom fade trail (slow dissipation of light)
      ctx.fillStyle = activePalette.bg === '#0A0A12' ? 'rgba(10, 10, 18, 0.05)' : 'rgba(8, 16, 20, 0.05)';
      ctx.fillRect(0, 0, width, height);

      // 2. Central Breathing Neural Core
      const corePulse = Math.sin(time * 1.5) * 0.15 + 0.85;
      const baseRadius = Math.min(width, height) * (0.15 + (alphaPower / 30) * 0.12 * corePulse);
      
      const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * 1.8);
      coreGrad.addColorStop(0, '#FFFFFF');
      coreGrad.addColorStop(0.3, activePalette.primary);
      coreGrad.addColorStop(0.7, `${activePalette.secondary}44`);
      coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = coreGrad;
      ctx.globalAlpha = 0.4 + 0.5 * zoneScore;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // 3. Ethereal Silk Ribbons (Flowing Lissajous Curves evolving with Coherence & SMR)
      const numPetals = inZone && coherence > 60 ? 8 : 5;
      const growthFactor = 0.4 + zoneScore * 0.6;

      ctx.lineWidth = 1.6 + zoneScore * 1.2;
      for (let p = 0; p < numPetals; p++) {
        const baseAngle = (p * Math.PI * 2) / numPetals;
        const petalOffset = Math.sin(time * 0.8 + p) * 0.4;

        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 2; t += 0.08) {
          const r = baseRadius * (1 + Math.sin(t * 3 + time * 1.2 + p) * (0.35 * growthFactor) + Math.cos(t * 2 - time * 0.8) * 0.2);
          const x = centerX + Math.cos(t + baseAngle + petalOffset) * r;
          const y = centerY + Math.sin(t + baseAngle + petalOffset) * (r * 0.85);

          if (t === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();

        ctx.strokeStyle = p % 2 === 0 ? activePalette.primary : activePalette.secondary;
        ctx.globalAlpha = (0.25 + 0.45 * zoneScore) * (1 - p * 0.05);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // 4. Harmonic Sacred Circles (Appear subtly as SMR & Coherence rise)
      if (inZone && smrPower > 6.0) {
        const ringCount = Math.min(4, Math.floor(coherence / 25) + 1);
        for (let rIdx = 1; rIdx <= ringCount; rIdx++) {
          const ringR = baseRadius * (0.8 + rIdx * 0.45) + Math.sin(time * 0.6 + rIdx) * 10;
          ctx.beginPath();
          ctx.arc(centerX, centerY, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = activePalette.secondary;
          ctx.lineWidth = 1.0;
          ctx.globalAlpha = 0.2 * zoneScore;
          ctx.setLineDash([6, 12]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
        }
      }

      // 5. Gentle Floating Starlight Motes
      if (particlesRef.current.length < 25 && Math.random() < 0.2) {
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnR = baseRadius * (0.5 + Math.random() * 0.8);
        particlesRef.current.push({
          x: centerX + Math.cos(spawnAngle) * spawnR,
          y: centerY + Math.sin(spawnAngle) * spawnR,
          vx: (Math.random() - 0.5) * 12,
          vy: (Math.random() - 0.5) * 12 - 6,
          size: 1.5 + Math.random() * 2.5,
          color: Math.random() > 0.5 ? activePalette.primary : activePalette.secondary,
          alpha: 0.8,
          life: 1.0,
        });
      }

      particlesRef.current.forEach((pt) => {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.life -= dt * 0.25;

        if (pt.life > 0) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
          ctx.fillStyle = pt.color;
          ctx.globalAlpha = pt.alpha * pt.life * (0.4 + 0.6 * zoneScore);
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      });
      particlesRef.current = particlesRef.current.filter((pt) => pt.life > 0);

      // 6. User Touch Ripples (Soft, organic watercolor dispersion)
      touchRipplesRef.current.forEach((rip) => {
        rip.radius += dt * 45;
        rip.alpha -= dt * 0.55;

        if (rip.alpha > 0) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.radius, 0, Math.PI * 2);
          ctx.strokeStyle = activePalette.primary;
          ctx.lineWidth = 2.0;
          ctx.globalAlpha = rip.alpha;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }
      });
      touchRipplesRef.current = touchRipplesRef.current.filter((rip) => rip.alpha > 0);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [activePalette, inZone, zoneScore, alphaPower, coherence, smrPower]);

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
            background: 'rgba(15, 17, 26, 0.75)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFFFFF',
            pointerEvents: 'auto',
          }}
        >
          <Sparkles size={14} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 600 }}>Living Neural Aura</span>
          <span style={{ fontSize: '10px', color: inZone ? '#68D391' : '#CBD5E0' }}>
            {inZone ? '• Blooming' : '• Resting'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', pointerEvents: 'auto' }}>
          <button
            onClick={handleCaptureSnapshot}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 12px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
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
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
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

      {/* Main Interactive Canvas (Touch to add gentle ripples) */}
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

      {/* Bottom Palette Dots */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 17, 26, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 'var(--radius-full)',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 10,
        }}
      >
        <Palette size={13} color="#CBD5E0" />
        {PALETTES.map((pal) => (
          <div
            key={pal.id}
            onClick={() => setActivePalette(pal)}
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${pal.primary} 0%, ${pal.secondary} 100%)`,
              cursor: 'pointer',
              border: activePalette.id === pal.id ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.2)',
              transform: activePalette.id === pal.id ? 'scale(1.2)' : 'scale(1)',
              transition: 'all 0.15s ease',
            }}
            title={pal.name}
          />
        ))}
      </div>
    </div>
  );
};
