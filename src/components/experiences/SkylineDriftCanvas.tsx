import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { EEGDataPoint, ProtocolType } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Target, Wind, Zap, Sparkles, Shield } from 'lucide-react';
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
  ZenShard,
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
    skyTop: '#1E3A5F',
    skyMid: '#5B84B1',
    skyBot: '#FC766A',
    mountainBack: '#2E4057',
    mountainMid: '#4E6E8E',
    mountainFront: '#23374D',
    river: 'rgba(252, 118, 106, 0.45)',
    ringColor: '#68D8D6',
    ringGlow: 'rgba(104, 216, 214, 0.35)',
    shardColor: '#FFD166',
    craftPalette: ['#FFFFFF', '#C5E8F7', '#68D8D6'],
    starAlpha: 0.35,
  },
  {
    id: 'Sunset Canyon',
    label: 'Sunset Canyon',
    skyTop: '#2C1B4D',
    skyMid: '#9A3B5A',
    skyBot: '#FCA311',
    mountainBack: '#5A1846',
    mountainMid: '#900C3F',
    mountainFront: '#330B24',
    river: 'rgba(252, 163, 17, 0.5)',
    ringColor: '#FFBA08',
    ringGlow: 'rgba(255, 186, 8, 0.4)',
    shardColor: '#FFE494',
    craftPalette: ['#FFFFFF', '#FAD2B8', '#FCA311'],
    starAlpha: 0.5,
  },
  {
    id: 'Cyber Synthwave',
    label: 'Cyber Synthwave',
    skyTop: '#0D0221',
    skyMid: '#4717F6',
    skyBot: '#E7DFDD',
    mountainBack: '#1B063A',
    mountainMid: '#380E6B',
    mountainFront: '#0F0326',
    river: 'rgba(0, 255, 240, 0.65)',
    ringColor: '#00FFF0',
    ringGlow: 'rgba(0, 255, 240, 0.45)',
    shardColor: '#FF007F',
    craftPalette: ['#00FFF0', '#FF007F', '#7B2CBF'],
    starAlpha: 0.9,
  },
  {
    id: 'Arctic Aurora',
    label: 'Arctic Aurora',
    skyTop: '#051923',
    skyMid: '#003554',
    skyBot: '#00A896',
    mountainBack: '#002B42',
    mountainMid: '#024059',
    mountainFront: '#011F30',
    river: 'rgba(2, 195, 154, 0.55)',
    ringColor: '#02C39A',
    ringGlow: 'rgba(2, 195, 154, 0.4)',
    shardColor: '#70EE9C',
    craftPalette: ['#FFFFFF', '#B8F2E6', '#02C39A'],
    starAlpha: 0.85,
  },
];

interface CachedGradients {
  sky: CanvasGradient;
  river: CanvasGradient;
  mountainBack: CanvasGradient;
  mountainMid: CanvasGradient;
  mountainFront: CanvasGradient;
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

  // High-level HUD state synced at lower tick rate to avoid re-render overhead
  const [hudState, setHudState] = useState<{
    score: number;
    streak: number;
    multiplier: 1 | 2 | 3 | 4;
    ringsCleared: number;
    shardsCollected: number;
    autopilotActive: boolean;
    altitudePercent: number;
    hyperDriftActive: boolean;
  }>({
    score: 0,
    streak: 0,
    multiplier: 1,
    ringsCleared: 0,
    shardsCollected: 0,
    autopilotActive: false,
    altitudePercent: 50,
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
  const shardsRef = useRef<ZenShard[]>([]);
  const particlesRef = useRef<SkylineParticle[]>([]);
  const speedLinesRef = useRef<Array<{ x: number; y: number; len: number; speed: number }>>([]);
  const vaporTrailsRef = useRef<Array<{ lx: number; ly: number; rx: number; ry: number; alpha: number }>>([]);
  const cachedGradientsRef = useRef<CachedGradients | null>(null);
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  eegDataRef.current = eegData; // Sync on every render — no useEffect dependency needed
  const lastHudUpdateRef = useRef(0);

  const activeTheme = useMemo(
    () => BIOME_THEMES.find((b) => b.id === activeBiome) || BIOME_THEMES[0],
    [activeBiome]
  );

  // Initialize game objects (rings, shards, particles)
  useEffect(() => {
    // 6 floating altitude rings in depth
    ringsRef.current = Array.from({ length: 6 }, (_, i) => ({
      x: 0,
      y: 0.3 + Math.sin(i * 1.1) * 0.22,
      z: 320 + i * 260,
      radius: 44,
      passed: false,
      pulsePhase: Math.random() * Math.PI * 2,
    }));

    // 12 floating collectible Zen Shards
    shardsRef.current = Array.from({ length: 12 }, (_, i) => ({
      x: (Math.random() - 0.5) * 160,
      y: 0.22 + Math.random() * 0.56,
      z: 200 + i * 130,
      collected: false,
      sparklePhase: Math.random() * Math.PI * 2,
    }));

    // 50 ambient 3D particles (stars / cloud motes)
    particlesRef.current = Array.from({ length: 50 }, () => ({
      x: (Math.random() - 0.5) * 900,
      y: (Math.random() - 0.5) * 450,
      z: Math.random() * 900 + 80,
      size: Math.random() * 2.2 + 1.0,
      vx: 0,
      vy: 0,
      vz: 0,
      color: '#FFFFFF',
      alpha: Math.random() * 0.6 + 0.3,
      life: 1,
      maxLife: 1,
      kind: 'star',
    }));

    // 24 screen-edge speedlines
    speedLinesRef.current = Array.from({ length: 24 }, () => ({
      x: Math.random(),
      y: Math.random(),
      len: Math.random() * 60 + 40,
      speed: Math.random() * 0.8 + 0.6,
    }));

    return () => {
      audioEngine.stopFlightWind();
    };
  }, []);

  // Pre-generate and cache gradients to avoid allocations in 60fps loop
  const updateCachedGradients = (ctx: CanvasRenderingContext2D, width: number, height: number, theme: BiomeTheme) => {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(0.5, theme.skyMid);
    sky.addColorStop(1, theme.skyBot);

    const river = ctx.createLinearGradient(0, height * 0.86, 0, height);
    river.addColorStop(0, theme.river);
    river.addColorStop(1, 'rgba(0, 0, 0, 0.1)');

    const mountainBack = ctx.createLinearGradient(0, height * 0.35, 0, height);
    mountainBack.addColorStop(0, theme.mountainBack);
    mountainBack.addColorStop(1, theme.skyBot);

    const mountainMid = ctx.createLinearGradient(0, height * 0.5, 0, height);
    mountainMid.addColorStop(0, theme.mountainMid);
    mountainMid.addColorStop(1, theme.skyBot);

    const mountainFront = ctx.createLinearGradient(0, height * 0.65, 0, height);
    mountainFront.addColorStop(0, theme.mountainFront);
    mountainFront.addColorStop(1, '#000000');

    cachedGradientsRef.current = {
      sky,
      river,
      mountainBack,
      mountainMid,
      mountainFront,
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // Cap DPR at 2.5 for mobile battery/perf
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

      // 1. NEUROFEEDBACK DRIVEN DYNAMICS (read from ref — not a useEffect dependency)
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
        worldOffsetRef.current += dt * 80 * s.speed;

        // Hyper-Drift timer countdown
        if (s.hyperDriftActive) {
          s.hyperDriftTimeLeft -= dt;
          if (s.hyperDriftTimeLeft <= 0) {
            // Clean cycle reset — prevents infinite re-triggering while streak >= 10
            const expiry = processHyperDriftExpiry();
            s.hyperDriftActive = expiry.hyperDriftActive;
            s.streak = expiry.newStreak;
            s.multiplier = expiry.newMultiplier;
          }
        }

        // Shockwave expansion
        if (s.shockwaveRadius !== null) {
          s.shockwaveRadius += dt * 850;
          if (s.shockwaveRadius > Math.max(width, height) * 1.2) {
            s.shockwaveRadius = null;
          }
        }
      }

      // ==========================================
      // 2. RENDERING PIPELINE (Optimized Canvas2D)
      // ==========================================

      // Clear & Background Sky (Cached Gradient)
      const gradients = cachedGradientsRef.current;
      ctx.fillStyle = gradients ? gradients.sky : activeTheme.skyMid;
      ctx.fillRect(0, 0, width, height);

      // Starfield / Upper Atmospheric Particles
      ctx.fillStyle = '#FFFFFF';
      particlesRef.current.forEach((p) => {
        if (!isPaused) {
          p.z -= dt * 260 * s.speed;
          if (p.z <= 15) {
            p.z = 900;
            p.x = (Math.random() - 0.5) * 900;
            p.y = (Math.random() - 0.5) * 450;
          }
        }
        const fov = 340;
        const scale = fov / (fov + p.z);
        const projX = width * 0.5 + p.x * scale;
        const projY = height * 0.42 + p.y * scale;

        if (projX >= 0 && projX <= width && projY >= 0 && projY <= height * 0.75) {
          ctx.globalAlpha = p.alpha * activeTheme.starAlpha;
          ctx.beginPath();
          ctx.arc(projX, projY, p.size * scale * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1.0;

      // Parallax Mountains (3 Tiers with Sine Harmonics)
      const mountainLayers = [
        { speed: 0.08, heightScale: 0.42, yBase: height * 0.52, freq: 0.0025, fill: gradients?.mountainBack || activeTheme.mountainBack, alpha: 0.45 },
        { speed: 0.22, heightScale: 0.32, yBase: height * 0.65, freq: 0.0055, fill: gradients?.mountainMid || activeTheme.mountainMid, alpha: 0.70 },
        { speed: 0.45, heightScale: 0.22, yBase: height * 0.78, freq: 0.010, fill: gradients?.mountainFront || activeTheme.mountainFront, alpha: 0.95 },
      ];

      mountainLayers.forEach((layer) => {
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 10) {
          const worldX = x + worldOffsetRef.current * layer.speed * 20;
          const hill =
            Math.sin(worldX * layer.freq) * 48 +
            Math.sin(worldX * layer.freq * 2.1) * 22 +
            Math.cos(worldX * layer.freq * 0.6) * 55;
          const y = layer.yBase + hill * layer.heightScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.fillStyle = layer.fill;
        ctx.globalAlpha = layer.alpha;
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Valley River Reflection
      const riverY = height * 0.92;
      ctx.fillStyle = gradients ? gradients.river : activeTheme.river;
      ctx.beginPath();
      ctx.ellipse(width * 0.5, riverY, width * 0.7, height * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();

      // Checkpoint Rings (Layered Concentric Glow - Zero shadowBlur)
      const fov = 340;
      const gliderScreenY = height * (0.2 + s.gliderY * 0.55);

      ringsRef.current.forEach((ring) => {
        if (!isPaused) {
          ring.z -= dt * 190 * s.speed;
          ring.pulsePhase += dt * 4;

          // Recycle ring when passed behind camera
          if (ring.z <= 15) {
            if (!ring.passed && !isPaused) {
              // Ring flew past without being hit — streak broken
              const miss = processRingMiss();
              s.streak = miss.newStreak;
              s.multiplier = miss.newMultiplier;
            }
            ring.z = 1500;
            ring.y = 0.25 + Math.random() * 0.48;
            ring.passed = false;
          }
        }

        if (ring.z > 25) {
          const scale = fov / (fov + ring.z);
          const projX = width * 0.5;
          const projY = height * ring.y;
          const projRadius = ring.radius * scale * 2.2;

          if (projRadius > 2) {
            ctx.save();
            const pulse = Math.sin(ring.pulsePhase) * 0.15;

            // Outer glow stroke (translucent wide)
            ctx.beginPath();
            ctx.ellipse(projX, projY, projRadius * (1.0 + pulse), projRadius * (0.42 + pulse * 0.4), 0, 0, Math.PI * 2);
            ctx.strokeStyle = activeTheme.ringGlow;
            ctx.lineWidth = Math.max(3, 7 * scale);
            ctx.stroke();

            // Inner core stroke (crisp vibrant)
            ctx.beginPath();
            ctx.ellipse(projX, projY, projRadius, projRadius * 0.42, 0, 0, Math.PI * 2);
            ctx.strokeStyle = ring.passed ? '#00FF88' : activeTheme.ringColor;
            ctx.lineWidth = Math.max(1.5, 3 * scale);
            ctx.stroke();

            // Hit detection at crossing threshold
            if (ring.z < 85 && !ring.passed && !isPaused) {
              const dy = Math.abs(gliderScreenY - projY);
              if (dy < 46) {
                ring.passed = true;
                s.ringsCleared += 1;

                const result = processRingPass(s.streak, s.hyperDriftActive);
                s.streak = result.newStreak;
                s.multiplier = result.newMultiplier;
                if (s.streak > s.maxStreak) s.maxStreak = s.streak;

                if (result.triggerHyperDrift) {
                  s.hyperDriftActive = true;
                  s.hyperDriftTimeLeft = 15;
                  s.shockwaveRadius = 15;
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

      // Collectible Zen Shards (Floating Crystals)
      shardsRef.current.forEach((shard) => {
        if (!isPaused) {
          shard.z -= dt * 190 * s.speed;
          shard.sparklePhase += dt * 5;

          // Magnetic attraction when in-zone & multiplier >= 2x
          if (!shard.collected && shard.z < 350 && shard.z > 60 && s.multiplier >= 2) {
            const targetProjY = s.gliderY;
            shard.y += (targetProjY - shard.y) * 0.08;
            shard.x *= 0.94; // Pull to center
          }

          if (shard.z <= 15) {
            shard.z = 1300 + Math.random() * 400;
            shard.x = (Math.random() - 0.5) * 160;
            shard.y = 0.25 + Math.random() * 0.50;
            shard.collected = false;
          }
        }

        if (!shard.collected && shard.z > 25) {
          const scale = fov / (fov + shard.z);
          const projX = width * 0.5 + shard.x * scale;
          const projY = height * shard.y;
          const shardSize = 7 * scale * (1.0 + Math.sin(shard.sparklePhase) * 0.25);

          if (shardSize > 1) {
            ctx.save();
            ctx.translate(projX, projY);
            ctx.rotate(shard.sparklePhase * 0.5);

            // Shard diamond geometry
            ctx.fillStyle = activeTheme.shardColor;
            ctx.beginPath();
            ctx.moveTo(0, -shardSize * 1.4);
            ctx.lineTo(shardSize, 0);
            ctx.lineTo(0, shardSize * 1.4);
            ctx.lineTo(-shardSize, 0);
            ctx.closePath();
            ctx.fill();

            // Check collection proximity
            if (shard.z < 85 && !isPaused) {
              const dy = Math.abs(gliderScreenY - projY);
              const dx = Math.abs(width * 0.5 - projX);
              if (dy < 38 && dx < 45) {
                shard.collected = true;
                s.shardsCollected += 1;
                s.score += 25 * s.multiplier;
                audioEngine.playShardCollect();
              }
            }
            ctx.restore();
          }
        }
      });

      // Hyper-Drift Radial Shockwave
      if (s.shockwaveRadius !== null) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(width * 0.5, gliderScreenY, s.shockwaveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = activeTheme.ringColor;
        ctx.lineWidth = Math.max(1, 8 * (1.0 - s.shockwaveRadius / (Math.max(width, height) * 1.2)));
        ctx.globalAlpha = Math.max(0, 1.0 - s.shockwaveRadius / (Math.max(width, height) * 1.2));
        ctx.stroke();
        ctx.restore();
      }

      // Speedlines (Active at high speed or Hyper-Drift)
      if (s.speed > 1.25 || s.hyperDriftActive) {
        ctx.save();
        ctx.strokeStyle = s.hyperDriftActive ? activeTheme.ringColor : 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = s.hyperDriftActive ? 2 : 1.2;
        const speedAlpha = Math.min(0.65, (s.speed - 1.2) * 0.8 + (s.hyperDriftActive ? 0.3 : 0));
        ctx.globalAlpha = speedAlpha;

        speedLinesRef.current.forEach((line) => {
          if (!isPaused) {
            line.len = 40 + s.speed * 45;
          }
          const startX = line.x < 0.5 ? width * line.x * 0.4 : width * (1 - (1 - line.x) * 0.4);
          const startY = height * line.y;
          const dirX = line.x < 0.5 ? -1 : 1;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(startX + dirX * line.len, startY + (line.y - 0.5) * 20);
          ctx.stroke();
        });
        ctx.restore();
      }

      // Glider (Aerodynamic Sci-Fi Craft with banking roll)
      const gliderScreenX = width * 0.5;
      ctx.save();
      ctx.translate(gliderScreenX, gliderScreenY);
      ctx.rotate(s.gliderPitch * 0.35 + s.gliderRoll * 0.5);

      // Wingtip Vapor Trails
      if (!isPaused) {
        vaporTrailsRef.current.unshift({
          lx: gliderScreenX - 28,
          ly: gliderScreenY - 18,
          rx: gliderScreenX + 28,
          ry: gliderScreenY - 18,
          alpha: s.hyperDriftActive ? 0.9 : 0.45,
        });
        if (vaporTrailsRef.current.length > 18) vaporTrailsRef.current.pop();
      }

      // Glider Fuselage & Wings
      ctx.beginPath();
      ctx.moveTo(38, 0);       // Nose cone
      ctx.lineTo(-26, -22);   // Port wingtip
      ctx.lineTo(-15, 0);     // Keel fold
      ctx.lineTo(-26, 22);    // Starboard wingtip
      ctx.closePath();

      // Two-tone gradient lighting
      const craftGrad = ctx.createLinearGradient(-26, -22, 38, 22);
      craftGrad.addColorStop(0, activeTheme.craftPalette[0]);
      craftGrad.addColorStop(0.5, activeTheme.craftPalette[1]);
      craftGrad.addColorStop(1, activeTheme.craftPalette[2]);
      ctx.fillStyle = craftGrad;
      ctx.fill();

      // Wing facet lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(38, 0);
      ctx.lineTo(-15, 0);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.stroke();

      // Under-glow thruster engine
      ctx.beginPath();
      ctx.ellipse(-17, 0, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = s.hyperDriftActive ? '#FF007F' : activeTheme.ringColor;
      ctx.fill();

      ctx.restore();

      // Sync HUD state every 150ms to keep React render overhead minimal
      if (time - lastHudUpdateRef.current > 150) {
        lastHudUpdateRef.current = time;
        setHudState({
          score: s.score,
          streak: s.streak,
          multiplier: s.multiplier,
          ringsCleared: s.ringsCleared,
          shardsCollected: s.shardsCollected,
          autopilotActive: s.autopilotActive,
          altitudePercent: Math.round((1 - s.gliderY) * 100),
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

      {/* ================= HUD TOP BAR ================= */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          right: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Left: Biome Badge & Protocol */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              background: 'rgba(20, 24, 33, 0.78)',
              backdropFilter: 'blur(10px)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Compass size={14} color={activeTheme.ringColor} />
            <span>{activeBiome}</span>
          </div>

          {hudState.autopilotActive && (
            <div
              style={{
                background: 'rgba(255, 170, 0, 0.22)',
                color: '#FFB703',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                fontWeight: 700,
                border: '1px solid rgba(255, 183, 3, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                animation: 'pulse 1.8s infinite',
              }}
            >
              <Shield size={13} />
              <span>Autopilot Active</span>
            </div>
          )}
        </div>

        {/* Center: Flow Multiplier Badge */}
        <div
          style={{
            background: hudState.hyperDriftActive
              ? 'linear-gradient(135deg, #FF007F, #7B2CBF)'
              : hudState.multiplier > 1
              ? 'rgba(0, 255, 240, 0.25)'
              : 'rgba(20, 24, 33, 0.75)',
            color: '#FFFFFF',
            border: hudState.hyperDriftActive
              ? '1px solid #FF007F'
              : hudState.multiplier > 1
              ? `1px solid ${activeTheme.ringColor}`
              : '1px solid rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(10px)',
            padding: '6px 18px',
            borderRadius: '24px',
            fontSize: '13px',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: hudState.hyperDriftActive
              ? '0 0 16px rgba(255, 0, 127, 0.55)'
              : 'none',
            letterSpacing: '0.5px',
          }}
        >
          <Zap size={14} color={hudState.hyperDriftActive ? '#FFE494' : activeTheme.ringColor} />
          <span>
            {hudState.hyperDriftActive
              ? 'HYPER-DRIFT (4x)'
              : `${hudState.multiplier}x FLOW BOOST`}
          </span>
        </div>

        {/* Right: Score, Streak, & Collectibles */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              background: 'rgba(20, 24, 33, 0.78)',
              backdropFilter: 'blur(10px)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              color: '#FFFFFF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Sparkles size={13} color={activeTheme.shardColor} />
            <span>{hudState.score} PTS</span>
          </div>

          <div
            style={{
              background: 'rgba(20, 24, 33, 0.78)',
              backdropFilter: 'blur(10px)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              color: activeTheme.ringColor,
              border: '1px solid rgba(255, 255, 255, 0.12)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <Target size={13} />
            <span>{hudState.ringsCleared} Rings</span>
          </div>
        </div>
      </div>

      {/* ================= HUD BOTTOM BAR ================= */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 14,
          right: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        {/* Altitude & Cruise Gauge */}
        <div
          style={{
            background: 'rgba(20, 24, 33, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            minWidth: '130px',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#A0AEC0', fontWeight: 600 }}>
            <span>Altitude</span>
            <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{hudState.altitudePercent}%</span>
          </div>
          <div
            style={{
              width: '100%',
              height: '5px',
              background: 'rgba(255, 255, 255, 0.15)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${hudState.altitudePercent}%`,
                height: '100%',
                background: activeTheme.ringColor,
                transition: 'width 0.15s ease',
              }}
            />
          </div>
        </div>

        {/* Gentle Updraft Prompt (When in low altitude valley) */}
        {hudState.altitudePercent < 35 && (
          <div
            style={{
              background: 'rgba(20, 24, 33, 0.70)',
              backdropFilter: 'blur(8px)',
              padding: '6px 16px',
              borderRadius: '20px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#E2E8F0',
              fontSize: '11px',
              fontWeight: 600,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Wind size={13} color={activeTheme.ringColor} />
            <span>Breathe deeply to catch the mountain updraft</span>
          </div>
        )}

        {/* Biome Switcher */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: 'rgba(0, 0, 0, 0.55)',
            padding: '4px',
            borderRadius: 'var(--radius-md)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          {BIOME_THEMES.map((b) => (
            <button
              key={b.id}
              onClick={() => setActiveBiome(b.id)}
              style={{
                background: activeBiome === b.id ? 'var(--brand-primary, #68D8D6)' : 'transparent',
                color: activeBiome === b.id ? '#000000' : '#FFFFFF',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 10px',
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
    </div>
  );
};
