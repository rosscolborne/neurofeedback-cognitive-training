import React, { useEffect, useState, useRef, useCallback } from 'react';
import { EEGDataPoint } from '../../types';
import {
  generativeMusicEngine,
  GenerativeMusicMode as GMMode,
  THERAPEUTIC_SCALES,
  TherapeuticScale,
} from '../../services/generativeMusicEngine';
import { Play, Pause, Music, Waves, Drum, Radio, Volume2, VolumeX, Activity } from 'lucide-react';

interface GenerativeMusicProps {
  eegData: EEGDataPoint | null;
}

const MODE_OPTIONS: { id: GMMode; label: string; icon: typeof Music; desc: string }[] = [
  { id: 'brain-melody', label: 'Brain Melody', icon: Music, desc: 'Pentatonic melody from your brainwaves' },
  { id: 'neural-synth', label: 'Neural Synth', icon: Radio, desc: 'FM synthesis controlled by EEG bands' },
  { id: 'brainwave-drums', label: 'Brain Drums', icon: Drum, desc: 'Rhythmic patterns from band powers' },
];

export const GenerativeMusicMode: React.FC<GenerativeMusicProps> = ({ eegData }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeMode, setActiveMode] = useState<GMMode>('brain-melody');
  const [activeScale, setActiveScale] = useState<TherapeuticScale>(THERAPEUTIC_SCALES[0]);
  const [isMuted, setIsMuted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? 0.7;
  const coherence = eegData?.coherence ?? 75;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      generativeMusicEngine.cleanup();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Ambient pulse animation
  const drawAmbient = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const cy = h / 2;
    const time = Date.now() / 1000;

    ctx.clearRect(0, 0, w, h);

    // Background gradient
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    bg.addColorStop(0, inZone ? 'rgba(232, 150, 122, 0.08)' : 'rgba(74, 144, 217, 0.05)');
    bg.addColorStop(1, 'rgba(10, 10, 16, 0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Concentric breathing rings (3 rings, pulsing with zone score)
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const phase = time * (0.8 + i * 0.3) + i * (Math.PI * 2 / ringCount);
      const breathScale = 0.85 + Math.sin(phase) * 0.15 * (zoneScore + 0.3);
      const baseRadius = 30 + i * 28;
      const radius = baseRadius * breathScale;

      const alpha = inZone
        ? 0.15 + zoneScore * 0.25 - i * 0.06
        : 0.06 + zoneScore * 0.08 - i * 0.02;

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
      ctx.strokeStyle = inZone
        ? `rgba(232, 150, 122, ${Math.max(0.02, alpha)})`
        : `rgba(74, 144, 217, ${Math.max(0.02, alpha)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Center glow dot
    const dotRadius = 6 + zoneScore * 4;
    const dotGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotRadius * 3);
    dotGlow.addColorStop(0, inZone ? 'rgba(232, 150, 122, 0.6)' : 'rgba(74, 144, 217, 0.3)');
    dotGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, dotRadius * 3, 0, Math.PI * 2);
    ctx.fillStyle = dotGlow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = inZone ? 'rgba(232, 150, 122, 0.85)' : 'rgba(74, 144, 217, 0.5)';
    ctx.fill();

    // Coherence particles (small dots orbiting when coherence is high)
    if (coherence != null && coherence > 40 && isPlaying) {
      const particleCount = Math.floor((coherence - 40) / 10);
      for (let p = 0; p < particleCount; p++) {
        const angle = time * (0.5 + p * 0.15) + p * (Math.PI * 2 / particleCount);
        const orbitR = 55 + p * 8;
        const px = cx + Math.cos(angle) * orbitR;
        const py = cy + Math.sin(angle) * orbitR;
        const pAlpha = 0.3 + (coherence / 100) * 0.4;

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(212, 175, 55, ${pAlpha})`;
        ctx.fill();
      }
    }

    animFrameRef.current = requestAnimationFrame(drawAmbient);
  }, [inZone, zoneScore, coherence, isPlaying]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawAmbient);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [drawAmbient]);

  const handleTogglePlay = async () => {
    if (!isPlaying) {
      await generativeMusicEngine.play();
      setIsPlaying(true);
    } else {
      generativeMusicEngine.stop();
      setIsPlaying(false);
    }
  };

  const handleModeChange = (mode: GMMode) => {
    setActiveMode(mode);
    generativeMusicEngine.setMode(mode);
  };

  const handleScaleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const scale = THERAPEUTIC_SCALES.find(s => s.id === e.target.value);
    if (scale) {
      setActiveScale(scale);
      generativeMusicEngine.setScale(scale);
    }
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    generativeMusicEngine.setMasterVolume(next ? 0 : 0.75);
  };

  // EEG-to-parameter mapping display
  const getParamMapping = (): string => {
    switch (activeMode) {
      case 'brain-melody':
        return 'α → pitch  ·  attention → tempo  ·  β → duration';
      case 'neural-synth':
        return 'α → carrier  ·  θ → mod depth  ·  β → mod rate';
      case 'brainwave-drums':
        return 'α → instrument  ·  attention → tempo  ·  θ → ghost notes';
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A10',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        color: '#FFFFFF',
        fontFamily: 'var(--font-body)',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Music size={16} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#CBD5E0' }}>
            Generative Music
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Scale selector (only for Brain Melody) */}
          {activeMode === 'brain-melody' && (
            <select
              value={activeScale.id}
              onChange={handleScaleChange}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                color: '#CBD5E0',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {THERAPEUTIC_SCALES.map(s => (
                <option key={s.id} value={s.id} style={{ background: '#1A1A2E' }}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleToggleMute}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 8px',
              color: '#CBD5E0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </div>
      </div>

      {/* Central Ambient Visualization */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />

        {/* Play button overlay */}
        <button
          onClick={handleTogglePlay}
          style={{
            position: 'relative',
            zIndex: 5,
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: inZone ? 'var(--brand-primary)' : '#2D3748',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: inZone
              ? '0 8px 28px rgba(232, 150, 122, 0.4), 0 0 40px rgba(232, 150, 122, 0.15)'
              : '0 6px 20px rgba(0, 0, 0, 0.5)',
            transition: 'all 0.4s ease',
          }}
        >
          {isPlaying ? <Pause size={28} /> : <Play size={28} style={{ marginLeft: '3px' }} />}
        </button>

        {/* Parameter mapping HUD */}
        <div
          style={{
            position: 'relative',
            zIndex: 5,
            marginTop: '20px',
            background: 'rgba(20, 22, 32, 0.85)',
            backdropFilter: 'blur(12px)',
            border: inZone ? '1px solid rgba(232, 150, 122, 0.25)' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '11px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Waves size={13} color="var(--brand-primary)" />
            <span style={{ color: '#A0AEC0', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.02em' }}>
              {getParamMapping()}
            </span>
          </div>

          <div style={{ width: '1px', height: '14px', backgroundColor: 'rgba(255,255,255,0.15)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Activity size={12} color={inZone ? '#68D391' : '#F6AD55'} />
            <span style={{ color: inZone ? '#68D391' : '#F6AD55', fontWeight: 600, fontSize: '10px' }}>
              {inZone ? `Zone ${Math.round(zoneScore * 100)}%` : 'Drift'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Mode Selector */}
      <div
        style={{
          padding: '12px 16px 16px',
          backgroundColor: '#12141F',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          gap: '8px',
          zIndex: 10,
        }}
      >
        {MODE_OPTIONS.map(opt => {
          const Icon = opt.icon;
          const isActive = activeMode === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handleModeChange(opt.id)}
              style={{
                flex: 1,
                background: isActive ? 'rgba(232, 150, 122, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: isActive ? '1.5px solid var(--brand-primary)' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={16} color={isActive ? 'var(--brand-primary)' : '#A0AEC0'} />
              <span style={{ fontSize: '10px', fontWeight: 600, color: isActive ? '#FFFFFF' : '#CBD5E0' }}>
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
