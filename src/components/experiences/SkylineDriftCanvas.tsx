import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { EEGDataPoint, ProtocolType } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Target, Zap, Shield } from 'lucide-react';
import {
  computeTargetElevation,
  isAutopilotActive,
  computeBaseSpeed,
  dampenPitch,
  processRingPass,
  processRingMiss,
  processHyperDriftExpiry,
} from './skyline/skylineGameLogic';
import type {
  BiomeTheme,
  SkylineRing,
  SkylineParticle,
  SkylineGameState,
} from './skyline/skylineTypes';

export interface SkylineDriftProps {
  eegData: EEGDataPoint | null;
  assignedProtocol?: ProtocolType;
  recentInZonePercent?: number | null;
  biome?: string;
  isPaused?: boolean;
}

const BIOME_THEMES: BiomeTheme[] = [
  {
    id: 'Alpine Meadows',
    label: 'Alpine Meadows',
    skyTop: '#D4B2A7',
    skyMid: '#F5E4D7',
    skyBot: '#FAF7F2',
    mountain: '#A88D7F',
    river: 'rgba(232, 150, 122, 0.4)',
    ringColor: '#E8967A',
    craftPalette: ['#FFFFFF', '#F5D4C7', '#E8967A'],
    particleColor: 'rgba(255, 255, 255, 0.85)',
  },
  {
    id: 'Sunset Canyon',
    label: 'Sunset Canyon',
    skyTop: '#E88B68',
    skyMid: '#F5C6A5',
    skyBot: '#FAF1E6',
    mountain: '#C46D4E',
    river: 'rgba(245, 198, 165, 0.5)',
    ringColor: '#E88B68',
    craftPalette: ['#FFFFFF', '#FAD2B8', '#E88B68'],
    particleColor: 'rgba(255, 255, 255, 0.85)',
  },
  {
    id: 'Arctic Aurora',
    label: 'Arctic Aurora',
    skyTop: '#0D2B45',
    skyMid: '#203C56',
    skyBot: '#544E68',
    mountain: '#305252',
    river: 'rgba(84, 160, 160, 0.4)',
    ringColor: '#68D8D6',
    craftPalette: ['#FFFFFF', '#C5E8F7', '#68D8D6'],
    particleColor: 'rgba(255, 255, 255, 0.85)',
  },
  {
    id: 'Cyber Neon',
    label: 'Cyber Synthwave',
    skyTop: '#2C1B4D',
    skyMid: '#7B3B8C',
    skyBot: '#1A0B2E',
    mountain: '#0D0221',
    river: 'rgba(0, 240, 255, 0.3)',
    ringColor: '#00FFFF',
    craftPalette: ['#00FFFF', '#FF007F', '#7B3B8C'],
    particleColor: '#FF007F',
  },
];

interface CachedGradients {
  sky: CanvasGradient;
  craft: CanvasGradient;
}

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  assignedProtocol = 'alpha-enhancement', // Default to relaxation protocol
  recentInZonePercent,
  biome: initialBiome = 'Alpine Meadows',
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeBiome, setActiveBiome] = useState(initialBiome);

  // Minimal HUD state synced at lower tick rate to avoid re-render overhead
  const [hudState, setHudState] = useState<{
    score: number;
    streak: number;
    multiplier: 1 | 2 | 3 | 4;
    ringsCleared: number;
    autopilotActive: boolean;
    hyperDriftActive: boolean;
  }>({
    score: 0,
    streak: 0,
    multiplier: 1,
    ringsCleared: 0,
    autopilotActive: false,
    hyperDriftActive: false,
  });

  // Game state & simulation refs
  const stateRef = useRef<SkylineGameState>({
    score: 0,
    streak: 0,
    maxStreak: 0,
    multiplier: 1,
    ringsCleared: 0,
    shardsCollected: 0,
    hyperDriftActive: false,
    hyperDriftTimeLeft: 0,
    gliderY: 0.5,
    gliderTargetY: 0.5,
    gliderPitch: 0,
    gliderRoll: 0,
    speed: 1.0,
    shockwaveRadius: null,
    autopilotActive: false,
  });

  const worldOffsetRef = useRef(0);
  const ringsRef = useRef<SkylineRing[]>([]);
  const particlesRef = useRef<SkylineParticle[]>([]);
  const cachedGradientsRef = useRef<CachedGradients | null>(null);
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  eegDataRef.current = eegData; // Sync on every render — no useEffect dependency needed
  const lastHudUpdateRef = useRef(0);

  const activeTheme = useMemo(
    () => BIOME_THEMES.find((b) => b.id === activeBiome) || BIOME_THEMES[0],
    [activeBiome]
  );

  // Initialize game objects (rings, atmospheric cloud motes)
  useEffect(() => {
    // 6 floating altitude rings in depth
    ringsRef.current = Array.from({ length: 6 }, (_, i) => ({
      x: 0,
      y: 0.28 + Math.sin(i * 1.1) * 0.22,
      z: 320 + i * 260,
      radius: 42,
      passed: false,
      pulsePhase: Math.random() * Math.PI * 2,
    }));

    // 50 ambient 3D particles (peaceful floating cloud motes)
    particlesRef.current = Array.from({ length: 50 }, () => ({
      x: (Math.random() - 0.5) * 850,
      y: (Math.random() - 0.5) * 420,
      z: Math.random() * 850 + 80,
      size: Math.random() * 2.5 + 1.2,
      vx: 0,
      vy: 0,
      vz: 0,
      color: '#FFFFFF',
      alpha: Math.random() * 0.5 + 0.4,
      life: 1,
      maxLife: 1,
      kind: 'cloud',
    }));

    return () => {
      audioEngine.stopFlightWind();
    };
  }, []);

  // Pre-generate and cache gradients on resize / theme change
  const updateCachedGradients = (ctx: CanvasRenderingContext2D, width: number, height: number, theme: BiomeTheme) => {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(0.5, theme.skyMid);
    sky.addColorStop(1, theme.skyBot);

    const craft = ctx.createLinearGradient(-24, -19, 34, 19);
    craft.addColorStop(0, theme.craftPalette[0]);
    craft.addColorStop(0.5, theme.craftPalette[1]);
    craft.addColorStop(1, theme.craftPalette[2]);

    cachedGradientsRef.current = {
      sky,
      craft,
    };
  };

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();

    const handleResize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // Cap DPR at 2.5 for mobile perf
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      updateCachedGradients(ctx, rect.width, rect.height, activeTheme);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const render = (time: number) => {
      const dt = Math.min(0.08, (time - lastTime) / 1000);
      lastTime = time;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (!cachedGradientsRef.current) {
        updateCachedGradients(ctx, width, height, activeTheme);
      }

      const s = stateRef.current;

      // 1. NEUROFEEDBACK DRIVEN DYNAMICS
      const currentEEG = eegDataRef.current;
      if (currentEEG) {
        const rawZoneScore = currentEEG.zoneScore ?? (currentEEG.inZone ? 1.0 : 0.45);
        const inZone = currentEEG.inZone ?? rawZoneScore >= 0.6;

        s.autopilotActive = isAutopilotActive(currentEEG);

        const targetElevation = computeTargetElevation(rawZoneScore);

        if (s.autopilotActive) {
          s.gliderPitch = dampenPitch(s.gliderPitch);
        } else {
          s.gliderTargetY += (targetElevation - s.gliderTargetY) * 0.06;
          s.gliderPitch = (s.gliderTargetY - s.gliderY) * 1.5;
        }

        const targetSpeed = computeBaseSpeed(rawZoneScore, s.hyperDriftActive);
        s.speed += (targetSpeed - s.speed) * 0.05;

        if (!isPaused) {
          audioEngine.updateFlightWind(s.speed, inZone);
        }
      }

      if (!isPaused) {
        s.gliderY += (s.gliderTargetY - s.gliderY) * 0.05;
        s.gliderRoll = Math.sin(time * 0.002) * 0.12; // Gentle aerodynamic roll
        worldOffsetRef.current += dt * 75 * s.speed;

        // Hyper-Drift timer countdown
        if (s.hyperDriftActive) {
          s.hyperDriftTimeLeft -= dt;
          if (s.hyperDriftTimeLeft <= 0) {
            const expiry = processHyperDriftExpiry();
            s.hyperDriftActive = expiry.hyperDriftActive;
            s.streak = expiry.newStreak;
            s.multiplier = expiry.newMultiplier;
          }
        }
      }

      // ==========================================
      // 2. RENDERING PIPELINE (Original Minimalist Aesthetic)
      // ==========================================

      // Background Sky Gradient (Cached)
      const gradients = cachedGradientsRef.current;
      ctx.fillStyle = gradients ? gradients.sky : activeTheme.skyMid;
      ctx.fillRect(0, 0, width, height);

      // Distant Procedural Watercolor Mountains (3 Parallax Layers with subtle alpha)
      const layers = [
        { speed: 0.1, heightScale: 0.45, yBase: height * 0.55, freq: 0.003, alpha: 0.4 },
        { speed: 0.25, heightScale: 0.35, yBase: height * 0.68, freq: 0.006, alpha: 0.65 },
        { speed: 0.5, heightScale: 0.25, yBase: height * 0.82, freq: 0.01, alpha: 0.95 },
      ];

      layers.forEach((layer) => {
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 8) {
          const worldX = x + worldOffsetRef.current * layer.speed * 20;
          const hill =
            Math.sin(worldX * layer.freq) * 45 +
            Math.sin(worldX * layer.freq * 2.3) * 20 +
            Math.cos(worldX * layer.freq * 0.5) * 60;
          const y = layer.yBase + hill * layer.heightScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.fillStyle = activeTheme.mountain;
        ctx.globalAlpha = layer.alpha;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Soft Horizon River Valley at base
      const riverY = height * 0.92;
      ctx.fillStyle = activeTheme.river;
      ctx.beginPath();
      ctx.ellipse(width * 0.5, riverY, width * 0.65, height * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floating 3D Air / Cloud Motes
      ctx.fillStyle = activeTheme.particleColor;
      const fov = 350;
      particlesRef.current.forEach((p) => {
        if (!isPaused) {
          p.z -= dt * 240 * s.speed;
          if (p.z <= 10) {
            p.z = 850;
            p.x = (Math.random() - 0.5) * 850;
            p.y = (Math.random() - 0.5) * 420;
          }
        }
        const scale = fov / (fov + p.z);
        const projX = width * 0.5 + p.x * scale;
        const projY = height * 0.45 + p.y * scale;

        if (projX >= 0 && projX <= width && projY >= 0 && projY <= height) {
          ctx.beginPath();
          ctx.arc(projX, projY, p.size * scale * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Floating Altitude Checkpoint Rings (Minimal, clean, elegant)
      const gliderScreenY = height * (0.2 + s.gliderY * 0.55);

      ringsRef.current.forEach((ring) => {
        if (!isPaused) {
          ring.z -= dt * 180 * s.speed;
          if (ring.z <= 12) {
            if (!ring.passed && !isPaused) {
              const miss = processRingMiss();
              s.streak = miss.newStreak;
              s.multiplier = miss.newMultiplier;
            }
            ring.z = 1350;
            ring.y = 0.25 + Math.random() * 0.45;
            ring.passed = false;
          }
        }

        if (ring.z > 20) {
          const scale = fov / (fov + ring.z);
          const projX = width * 0.5;
          const projY = height * ring.y;
          const projRadius = ring.radius * scale * 2.2;

          if (projRadius > 2) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(projX, projY, projRadius, projRadius * 0.4, 0, 0, Math.PI * 2);
            ctx.strokeStyle = ring.passed ? '#10B981' : activeTheme.ringColor;
            ctx.lineWidth = Math.max(1.5, 3 * scale);
            ctx.stroke();

            // Hit detection at crossing point
            if (ring.z < 80 && !ring.passed && !isPaused) {
              const dy = Math.abs(gliderScreenY - projY);
              if (dy < 45) {
                ring.passed = true;
                s.ringsCleared += 1;

                const result = processRingPass(s.streak, s.hyperDriftActive);
                s.streak = result.newStreak;
                s.multiplier = result.newMultiplier;
                if (s.streak > s.maxStreak) s.maxStreak = s.streak;

                if (result.triggerHyperDrift) {
                  s.hyperDriftActive = true;
                  s.hyperDriftTimeLeft = 15;
                  audioEngine.playHyperDriftStinger();
                }

                s.score += result.scoreAwarded;
                audioEngine.playPentatonicRingArpeggio(s.streak - 1);
              }
            }
            ctx.restore();
          }
        }
      });

      // Glider (Paper Plane / Minimalist Aerodynamic Craft)
      const gliderScreenX = width * 0.5;
      const craftAngle = s.gliderPitch * 0.35 + s.gliderRoll * 0.4;

      ctx.save();
      ctx.translate(gliderScreenX, gliderScreenY);
      ctx.rotate(craftAngle);

      // Trailing wingtip vapor trails (gentle, elegant)
      const zoneScore = currentEEG ? (currentEEG.zoneScore ?? (currentEEG.inZone ? 1.0 : 0.0)) : 0.5;
      if (zoneScore > 0.08) {
        ctx.beginPath();
        const trailLen = 45 + (s.multiplier > 1 ? s.multiplier * 18 : 0);
        ctx.moveTo(-24, -19);
        ctx.lineTo(-24 - trailLen, -21);
        ctx.moveTo(-24, 19);
        ctx.lineTo(-24 - trailLen, 21);
        ctx.strokeStyle = activeTheme.id === 'Cyber Neon'
          ? `rgba(0, 255, 255, ${0.85 * zoneScore})`
          : `rgba(232, 150, 122, ${0.8 * zoneScore})`;
        ctx.lineWidth = s.multiplier >= 2 ? 2.5 : 1.8;
        ctx.stroke();
      }

      // Paper plane body with smooth pastel gradient
      ctx.beginPath();
      ctx.moveTo(34, 0);       // Nose
      ctx.lineTo(-24, -19);   // Left wingtip
      ctx.lineTo(-14, 0);     // Fuselage fold
      ctx.lineTo(-24, 19);    // Right wingtip
      ctx.closePath();

      ctx.fillStyle = gradients ? gradients.craft : activeTheme.craftPalette[0];
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Wing crease
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.lineTo(-14, 0);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1.0;
      ctx.stroke();

      ctx.restore();

      // Sync HUD state every 150ms
      if (time - lastHudUpdateRef.current > 150) {
        lastHudUpdateRef.current = time;
        setHudState({
          score: s.score,
          streak: s.streak,
          multiplier: s.multiplier,
          ringsCleared: s.ringsCleared,
          autopilotActive: s.autopilotActive,
          hyperDriftActive: s.hyperDriftActive,
        });
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      audioEngine.stopFlightWind();
    };
  }, [activeTheme, isPaused]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
        userSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {/* Top Left Clean Status Badges */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Biome Badge */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(8px)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
          }}
        >
          <Compass size={14} color={activeTheme.ringColor} />
          <span>{activeTheme.label}</span>
        </div>

        {/* Rings Cleared Badge */}
        {hudState.ringsCleared > 0 && (
          <div
            style={{
              background: 'var(--status-active-bg, rgba(209, 250, 229, 0.9))',
              color: 'var(--status-active, #059669)',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Target size={13} />
            <span>{hudState.ringsCleared} Rings</span>
          </div>
        )}

        {/* Subtle Flow State Pill */}
        {hudState.multiplier > 1 && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.88)',
              backdropFilter: 'blur(8px)',
              color: activeTheme.ringColor,
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}
          >
            <Zap size={13} />
            <span>{hudState.multiplier === 4 ? 'Flow State (4×)' : `${hudState.multiplier}× Flow`}</span>
          </div>
        )}

        {/* Minimal Autopilot Badge */}
        {hudState.autopilotActive && (
          <div
            style={{
              background: 'rgba(254, 243, 199, 0.9)',
              color: '#D97706',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 700,
              border: '1px solid rgba(217, 119, 6, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Shield size={12} />
            <span>Autopilot</span>
          </div>
        )}
      </div>

      {/* Bottom Right Minimal Biome Switcher */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          display: 'flex',
          gap: '4px',
          background: 'rgba(255, 255, 255, 0.85)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
        }}
      >
        {BIOME_THEMES.map((b) => (
          <button
            key={b.id}
            onClick={() => setActiveBiome(b.id)}
            style={{
              background: activeBiome === b.id ? 'var(--brand-primary, #E8967A)' : 'transparent',
              color: activeBiome === b.id ? '#FFFFFF' : 'var(--text-primary)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {b.label.split(' ')[0]}
          </button>
        ))}
      </div>
    </div>
  );
};
