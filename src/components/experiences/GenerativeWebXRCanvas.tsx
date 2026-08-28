import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Sparkles, Palette, Camera, RotateCcw, Play, Pause, Layers, Wand2 } from 'lucide-react';

interface GenerativeArtProps {
  eegData: EEGDataPoint | null;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  band: 'alpha' | 'theta' | 'smr' | 'beta';
}

const COLOR_PALETTES = [
  { id: 'terracotta-gold', name: 'Terracotta & Gold', colors: ['#E8967A', '#F5C6A5', '#FFD700', '#D4805E', '#FAF1E6'] },
  { id: 'oceanic-emerald', name: 'Oceanic Emerald', colors: ['#5C8C46', '#4A90D9', '#68D391', '#38B2AC', '#E6FFFA'] },
  { id: 'cyber-neon', name: 'Cyber Neon', colors: ['#00F0FF', '#FF007F', '#7B3B8C', '#FFE600', '#FFFFFF'] },
  { id: 'amethyst-dream', name: 'Amethyst Twilight', colors: ['#7B68AE', '#9F7AEA', '#E9D8FD', '#4A90D9', '#F687B3'] },
];

export const GenerativeWebXRCanvas: React.FC<GenerativeArtProps> = ({ eegData }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePalette, setActivePalette] = useState(COLOR_PALETTES[0]);
  const [symmetrySlices, setSymmetrySlices] = useState<number>(6);
  const [artMode, setArtMode] = useState<'nebula' | 'sacred' | 'fluid' | 'synaptic'>('nebula');
  const [autoFlow, setAutoFlow] = useState<boolean>(true);
  const [snapshotTaken, setSnapshotTaken] = useState(false);

  const particlesRef = useRef<Particle[]>([]);
  const isPointerDownRef = useRef(false);
  const pointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const timeElapsedRef = useRef(0);

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);
  const alphaPower = eegData?.bands.alpha || 10.0;
  const thetaPower = eegData?.bands.theta || 6.5;
  const smrPower = eegData?.bands.smr || 7.0;
  const betaPower = eegData?.bands.beta || 9.5;
  const coherence = eegData?.coherence || 75;

  // Initialize interactive particle pool
  useEffect(() => {
    particlesRef.current = [];
  }, [artMode, activePalette]);

  const spawnParticle = (
    x: number,
    y: number,
    vx: number,
    vy: number,
    band: 'alpha' | 'theta' | 'smr' | 'beta',
    paletteColors: string[]
  ) => {
    const colorIndex = Math.floor(Math.random() * paletteColors.length);
    const color = paletteColors[colorIndex];
    const size = 3 + Math.random() * (band === 'alpha' ? 8 : 4);
    const maxLife = 120 + Math.random() * 80;

    particlesRef.current.push({
      x,
      y,
      vx,
      vy,
      size,
      color,
      alpha: 0.9,
      life: maxLife,
      maxLife,
      band,
    });

    if (particlesRef.current.length > 350) {
      particlesRef.current.shift();
    }
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isPointerDownRef.current = true;
    updatePointerCoords(e);
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (isPointerDownRef.current) {
      updatePointerCoords(e);
    }
  };

  const handlePointerUp = () => {
    isPointerDownRef.current = false;
  };

  const updatePointerCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    pointerPosRef.current = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleClear = () => {
    particlesRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0A0A12';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSnapshotTaken(true);
    setTimeout(() => setSnapshotTaken(false), 1500);

    const imageUri = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `neural-art-${Date.now()}.png`;
    link.href = imageUri;
    link.click();
  };

  // Main Generative Animation Loop
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

    const render = (time: number) => {
      const dt = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;
      timeElapsedRef.current += dt;
      const elapsed = timeElapsedRef.current;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // Soft fading trail effect (simulates darkroom exposure & oil dispersion)
      ctx.fillStyle = 'rgba(10, 10, 18, 0.08)';
      ctx.fillRect(0, 0, width, height);

      // 1. Spawning interactive touch particles or auto-flow streams
      const palette = activePalette.colors;

      if (isPointerDownRef.current) {
        const { x, y } = pointerPosRef.current;
        for (let i = 0; i < 3; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 20 + (betaPower / 10) * 40;
          spawnParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 'alpha', palette);
        }
      }

      if (autoFlow) {
        // Automatic generative stream driven by real-time brainwaves
        const orbitRadius = Math.min(width, height) * (0.2 + (alphaPower / 25) * 0.22);
        const autoX = centerX + Math.cos(elapsed * (0.8 + (smrPower / 15) * 0.5)) * orbitRadius;
        const autoY = centerY + Math.sin(elapsed * (1.1 + (thetaPower / 15) * 0.5)) * (orbitRadius * 0.7);

        const flowAngle = elapsed * 2;
        const flowSpeed = 30 + (coherence / 100) * 45;
        spawnParticle(autoX, autoY, Math.cos(flowAngle) * flowSpeed, Math.sin(flowAngle) * flowSpeed, 'alpha', palette);

        if (inZone && Math.random() < 0.35) {
          // Extra golden sparks when in-zone
          spawnParticle(autoX + (Math.random() - 0.5) * 40, autoY + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 'smr', palette);
        }
      }

      // 2. Physics & Multi-Axis Symmetrical Rendering
      const slices = symmetrySlices;

      particlesRef.current.forEach((p) => {
        p.life -= dt * 35;
        const lifeRatio = Math.max(0, p.life / p.maxLife);

        // State-driven physics forces
        if (artMode === 'nebula') {
          const dx = p.x - centerX;
          const dy = p.y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // Gravitational swirling vortex
          p.vx += (-dy / dist) * (30 * (zoneScore + 0.5)) * dt - (dx / dist) * 8 * dt;
          p.vy += (dx / dist) * (30 * (zoneScore + 0.5)) * dt - (dy / dist) * 8 * dt;
        } else if (artMode === 'sacred') {
          // Angular orbital snap
          const angle = Math.atan2(p.y - centerY, p.x - centerX);
          p.vx = Math.cos(angle + 0.5) * 40 * (1 + zoneScore);
          p.vy = Math.sin(angle + 0.5) * 40 * (1 + zoneScore);
        } else if (artMode === 'fluid') {
          // Sinusoidal turbulence
          p.vx += Math.sin(p.y * 0.02 + elapsed * 2) * 18 * dt;
          p.vy += Math.cos(p.x * 0.02 + elapsed * 2) * 18 * dt;
        } else if (artMode === 'synaptic') {
          // Bio-electrical jitter
          p.vx += (Math.random() - 0.5) * 60 * dt;
          p.vy += (Math.random() - 0.5) * 60 * dt;
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (lifeRatio <= 0) return;

        // Draw particle across symmetry axes
        const relX = p.x - centerX;
        const relY = p.y - centerY;

        for (let s = 0; s < slices; s++) {
          const sliceAngle = (s * Math.PI * 2) / slices;
          ctx.save();
          ctx.translate(centerX, centerY);
          ctx.rotate(sliceAngle);

          const curSize = p.size * (0.4 + 0.6 * lifeRatio);
          ctx.beginPath();
          ctx.arc(relX, relY, curSize, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = lifeRatio * (0.6 + 0.4 * zoneScore);
          ctx.fill();

          // Connect synaptic filaments if in zone
          if (artMode === 'synaptic' && inZone && lifeRatio > 0.5) {
            ctx.beginPath();
            ctx.moveTo(relX, relY);
            ctx.lineTo(relX + p.vx * 0.15, relY + p.vy * 0.15);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }

          ctx.restore();
        }
      });

      // Filter out dead particles
      particlesRef.current = particlesRef.current.filter((p) => p.life > 0);

      // Central Harmonic Core Glow
      const coreRadius = 22 + (coherence / 100) * 18 + Math.sin(elapsed * 3) * 6;
      const coreGrad = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, coreRadius);
      coreGrad.addColorStop(0, '#FFFFFF');
      coreGrad.addColorStop(0.5, activePalette.colors[0]);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [activePalette, symmetrySlices, artMode, autoFlow, inZone, zoneScore, alphaPower, thetaPower, smrPower, betaPower, coherence]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A12',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      {/* Top Floating Control Bar */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {/* State Badge */}
        <div
          style={{
            background: 'rgba(18, 20, 30, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFFFFF',
            pointerEvents: 'auto',
          }}
        >
          <Wand2 size={15} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 700 }}>
            {artMode === 'nebula'
              ? 'Neural Nebula'
              : artMode === 'sacred'
              ? 'Sacred Fractal Bloom'
              : artMode === 'fluid'
              ? 'Fluid Synesthesia'
              : 'Synaptic Web'}
          </span>
          <span style={{ fontSize: '10px', color: inZone ? '#68D391' : '#CBD5E0', fontWeight: 600 }}>
            {inZone ? '✨ Harmony Lock' : '🎨 Interactive'}
          </span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '6px', pointerEvents: 'auto' }}>
          <button
            onClick={() => setAutoFlow(!autoFlow)}
            style={{
              background: autoFlow ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {autoFlow ? <Pause size={12} /> : <Play size={12} />}
            <span>{autoFlow ? 'Auto Paint' : 'Manual'}</span>
          </button>

          <button
            onClick={handleCaptureSnapshot}
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Camera size={12} />
            <span>{snapshotTaken ? 'Saved!' : 'Save Art'}</span>
          </button>

          <button
            onClick={handleClear}
            style={{
              background: 'rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Clear Canvas"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Main Generative Canvas (Touch/Drag Paint Area) */}
      <canvas
        ref={canvasRef}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      />

      {/* Bottom Preset & Symmetry Ribbon */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          right: 10,
          background: 'rgba(15, 17, 26, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          zIndex: 10,
        }}
      >
        {/* Mode Selector */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            { id: 'nebula' as const, label: '🌌 Nebula' },
            { id: 'sacred' as const, label: '🌸 Sacred' },
            { id: 'fluid' as const, label: '🎨 Fluid' },
            { id: 'synaptic' as const, label: '⚡ Synaptic' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setArtMode(m.id)}
              style={{
                background: artMode === m.id ? 'var(--brand-primary)' : 'transparent',
                color: artMode === m.id ? '#FFFFFF' : '#CBD5E0',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Symmetry Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Layers size={13} color="#A0AEC0" />
          {[1, 4, 6, 8, 12].map((s) => (
            <button
              key={s}
              onClick={() => setSymmetrySlices(s)}
              style={{
                background: symmetrySlices === s ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.08)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '3px',
                padding: '3px 6px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Palette Selector */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <Palette size={13} color="#A0AEC0" />
          {COLOR_PALETTES.map((pal) => (
            <div
              key={pal.id}
              onClick={() => setActivePalette(pal)}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${pal.colors[0]} 0%, ${pal.colors[2]} 100%)`,
                cursor: 'pointer',
                border: activePalette.id === pal.id ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.2)',
                transform: activePalette.id === pal.id ? 'scale(1.15)' : 'scale(1)',
                transition: 'all 0.15s ease',
              }}
              title={pal.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
