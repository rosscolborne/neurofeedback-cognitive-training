import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { EEGDataPoint, ProtocolType } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Target, Zap, Shield, Wind, Sparkles } from 'lucide-react';
import {
  computeTargetElevation,
  isAutopilotActive,
  computeBaseSpeed,
  dampenPitch,
  processRingPass,
  processRingMiss,
  processHyperDriftExpiry,
  computeSkyAtmosphere,
  spawnNextLandmark,
  updateCompanionDynamics,
  isWaterSkimming,
  processThermalUpdraft,
} from './skyline/skylineGameLogic';
import type {
  BiomeTheme,
  SkylineRing,
  SkylineParticle,
  SkylineGameState,
  SkylineLandmark,
  SpiritCompanion,
  WaterRipple,
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
    id: 'Alpine Odyssey',
    label: 'Alpine Odyssey',
    skyTop: '#D4B2A7',
    skyMid: '#F5E4D7',
    skyBot: '#FAF7F2',
    mountain: '#A88D7F',
    river: 'rgba(232, 150, 122, 0.45)',
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
];

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  assignedProtocol = 'alpha-enhancement', // Default to relaxation protocol
  recentInZonePercent,
  biome: initialBiome = 'Alpine Odyssey',
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
    distanceTraveled: number;
    atmosphereName: string;
  }>({
    score: 0,
    streak: 0,
    multiplier: 1,
    ringsCleared: 0,
    autopilotActive: false,
    hyperDriftActive: false,
    distanceTraveled: 0,
    atmosphereName: 'Alpine Dawn',
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
    distanceTraveled: 0,
    timeOfDay: 0.05, // Starts at gentle morning dawn
    isSkimmingWater: false,
  });

  const worldOffsetRef = useRef(0);
  const ringsRef = useRef<SkylineRing[]>([]);
  const particlesRef = useRef<SkylineParticle[]>([]);
  const landmarksRef = useRef<SkylineLandmark[]>([]);
  const ripplesRef = useRef<WaterRipple[]>([]);
  const companionRef = useRef<SpiritCompanion>({
    active: false,
    x: 100,
    y: 0.45,
    z: 180,
    targetX: 100,
    targetY: 0.45,
    wingPhase: 0,
    alpha: 0,
    leadDistance: 45,
  });

  const eegDataRef = useRef<EEGDataPoint | null>(null);
  eegDataRef.current = eegData;
  const lastHudUpdateRef = useRef(0);

  const activeTheme = useMemo(
    () => BIOME_THEMES.find((b) => b.id === activeBiome) || BIOME_THEMES[0],
    [activeBiome]
  );

  // Initialize rings, particles, and clean up audio on unmount
  useEffect(() => {
    // 6 floating altitude rings in depth
    ringsRef.current = Array.from({ length: 6 }, (_, i) => ({
      x: 0,
      y: 0.28 + Math.sin(i * 1.1) * 0.22,
      z: 320 + i * 260,
      radius: 42,
      passed: false,
      pulsePhase: Math.random() * Math.PI * 2,
      isUpdraft: i % 4 === 0, // Occasional thermal updraft ring
    }));

    // 50 ambient 3D particles (peaceful floating cloud & star motes)
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
      audioEngine.stopAmbientFlowLayers();
    };
  }, []);

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
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5); // Cap DPR for mobile perf
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const render = (time: number) => {
      const dt = Math.min(0.08, (time - lastTime) / 1000);
      lastTime = time;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const fov = 350;

      const s = stateRef.current;

      // 1. NEUROFEEDBACK DRIVEN DYNAMICS
      const currentEEG = eegDataRef.current;
      const rawZoneScore = currentEEG ? (currentEEG.zoneScore ?? (currentEEG.inZone ? 1.0 : 0.45)) : 0.5;
      const inZone = currentEEG ? (currentEEG.inZone ?? rawZoneScore >= 0.6) : false;

      if (currentEEG) {
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
      }

      if (!isPaused) {
        s.gliderY += (s.gliderTargetY - s.gliderY) * 0.05;
        s.gliderRoll = Math.sin(time * 0.002) * 0.12; // Gentle aerodynamic roll
        worldOffsetRef.current += dt * 75 * s.speed;
        s.distanceTraveled += dt * 36 * s.speed;

        // Continuous Day/Night Odyssey: complete cycle every ~4.5 minutes
        s.timeOfDay = (s.timeOfDay + dt * 0.0037) % 1.0;

        // Audio modulation
        audioEngine.updateFlightWind(s.speed, inZone);
        audioEngine.updateAmbientFlowLayers(s.multiplier, inZone);

        // Water skimming detection
        s.isSkimmingWater = isWaterSkimming(s.gliderY);
        audioEngine.updateWaterSkimSound(s.isSkimmingWater);

        // Spawn ripples when skimming the river
        if (s.isSkimmingWater && Math.random() < 0.35) {
          ripplesRef.current.push({
            x: width * 0.5 + (Math.random() - 0.5) * 40,
            y: height * 0.90,
            z: 90,
            radius: 4,
            maxRadius: 36,
            alpha: 0.65,
          });
        }

        // Hyper-Drift countdown
        if (s.hyperDriftActive) {
          s.hyperDriftTimeLeft -= dt;
          if (s.hyperDriftTimeLeft <= 0) {
            const expiry = processHyperDriftExpiry();
            s.hyperDriftActive = expiry.hyperDriftActive;
            s.streak = expiry.newStreak;
            s.multiplier = expiry.newMultiplier;
          }
        }

        // Procedural Landmark Milestones (every ~600m)
        const nextLandmark = spawnNextLandmark(s.distanceTraveled);
        if (nextLandmark && !landmarksRef.current.some(l => l.kind === nextLandmark && l.z > 800)) {
          landmarksRef.current.push({
            kind: nextLandmark,
            x: 0,
            y: nextLandmark === 'arch' ? 0.72 : nextLandmark === 'waterfall' ? 0.62 : 0.78,
            z: 1650,
            scale: 1.0,
            passed: false,
            rotation: 0,
          });
        }

        // Companion crane dynamics (joins in flow or when multiplier >= 2)
        const gliderScreenCoord = { x: width * 0.5, y: height * (0.2 + s.gliderY * 0.55) };
        companionRef.current = updateCompanionDynamics(
          companionRef.current,
          gliderScreenCoord,
          inZone || s.multiplier >= 2,
          dt
        );
      }

      // ==========================================
      // 2. ATMOSPHERIC ODYSSEY RENDERING
      // ==========================================
      const atmo = computeSkyAtmosphere(s.timeOfDay);

      // Smooth Sky Gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, atmo.skyTop);
      skyGrad.addColorStop(0.55, atmo.skyMid);
      skyGrad.addColorStop(1, atmo.skyBot);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Celestial Orb (Sun or Moon)
      const sunX = width * atmo.sunPos.x;
      const sunY = height * atmo.sunPos.y;
      ctx.save();
      const sunGrad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 55);
      sunGrad.addColorStop(0, atmo.isNight ? 'rgba(235, 235, 255, 0.95)' : 'rgba(255, 250, 240, 0.95)');
      sunGrad.addColorStop(0.35, atmo.isNight ? 'rgba(180, 195, 255, 0.35)' : 'rgba(255, 220, 180, 0.35)');
      sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 55, 0, Math.PI * 2);
      ctx.fill();

      // Sharp celestial disc
      ctx.fillStyle = atmo.isNight ? '#F0F3FF' : '#FFFDF5';
      ctx.beginPath();
      ctx.arc(sunX, sunY, atmo.isNight ? 12 : 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Distant Procedural Watercolor Mountains (3 Parallax Layers)
      const layers = [
        { speed: 0.10, heightScale: 0.45, yBase: height * 0.55, freq: 0.003, color: atmo.mountainFar, alpha: 0.45 },
        { speed: 0.25, heightScale: 0.35, yBase: height * 0.68, freq: 0.006, color: atmo.mountainMid, alpha: 0.70 },
        { speed: 0.50, heightScale: 0.25, yBase: height * 0.82, freq: 0.010, color: atmo.mountainNear, alpha: 0.95 },
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
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = layer.alpha;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Horizon River Valley
      const riverY = height * 0.92;
      ctx.fillStyle = atmo.river;
      ctx.beginPath();
      ctx.ellipse(width * 0.5, riverY, width * 0.65, height * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();

      // Procedural Landmarks (Ancient Arch, Waterfall, Turbines)
      landmarksRef.current.forEach((lm) => {
        if (!isPaused) {
          lm.z -= dt * 140 * s.speed;
          if (lm.rotation != null) lm.rotation += dt * 1.4;
        }

        if (lm.z > 15) {
          const scale = fov / (fov + lm.z);
          const projX = width * 0.5 + lm.x * scale;
          const projY = height * lm.y;

          ctx.save();
          if (lm.kind === 'arch') {
            // Minimalist colossal stone archway
            const archW = 160 * scale * 2.4;
            const archH = 220 * scale * 2.4;
            ctx.fillStyle = atmo.mountainNear;
            ctx.globalAlpha = Math.min(1.0, scale * 3.0);

            // Left pillar
            ctx.fillRect(projX - archW * 0.5, projY - archH, archW * 0.22, archH);
            // Right pillar
            ctx.fillRect(projX + archW * 0.28, projY - archH, archW * 0.22, archH);
            // Curved top lintel
            ctx.beginPath();
            ctx.arc(projX, projY - archH + archW * 0.2, archW * 0.5, Math.PI, 0, false);
            ctx.lineWidth = archW * 0.24;
            ctx.strokeStyle = atmo.mountainNear;
            ctx.stroke();
          } else if (lm.kind === 'waterfall') {
            // Shimmering mountain waterfall stream
            const streamW = 28 * scale * 2.2;
            const streamH = 140 * scale * 2.2;
            ctx.fillStyle = 'rgba(230, 245, 255, 0.75)';
            ctx.fillRect(projX - streamW * 0.5, projY - streamH, streamW, streamH);
          } else if (lm.kind === 'turbines') {
            // White minimalist wind turbines
            const mastH = 110 * scale * 2.2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(1.5, 3 * scale);
            ctx.beginPath();
            ctx.moveTo(projX, projY);
            ctx.lineTo(projX, projY - mastH);
            ctx.stroke();

            // 3 rotating blades
            const rot = lm.rotation || 0;
            const bladeLen = 45 * scale * 2.2;
            for (let b = 0; b < 3; b++) {
              const angle = rot + (b * Math.PI * 2) / 3;
              ctx.beginPath();
              ctx.moveTo(projX, projY - mastH);
              ctx.lineTo(projX + Math.cos(angle) * bladeLen, projY - mastH + Math.sin(angle) * bladeLen);
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      });
      landmarksRef.current = landmarksRef.current.filter((lm) => lm.z > 15);

      // Water Ripples (When skimming river)
      ripplesRef.current.forEach((rip) => {
        if (!isPaused) {
          rip.radius += dt * 42;
          rip.alpha -= dt * 0.75;
          rip.z -= dt * 140 * s.speed;
        }
        if (rip.alpha > 0 && rip.z > 10) {
          const scale = fov / (fov + rip.z);
          ctx.save();
          ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, rip.alpha)})`;
          ctx.lineWidth = 1.8 * scale;
          ctx.beginPath();
          ctx.ellipse(rip.x, rip.y, rip.radius * scale, rip.radius * 0.28 * scale, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });
      ripplesRef.current = ripplesRef.current.filter((rip) => rip.alpha > 0 && rip.z > 10);

      // Ambient 3D Cloud & Star Motes
      ctx.fillStyle = atmo.isNight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.65)';
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
          ctx.arc(projX, projY, p.size * scale * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Floating Altitude Checkpoint Rings (with Updraft visual)
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
            ring.isUpdraft = ring.y >= 0.55 && Math.random() < 0.4;
          }
        }

        if (ring.z > 20) {
          const scale = fov / (fov + ring.z);
          const projX = width * 0.5;
          const projY = height * ring.y;
          const projRadius = ring.radius * scale * 2.2;

          if (projRadius > 2) {
            ctx.save();

            // Updraft thermal rising vapor indicators
            if (ring.isUpdraft && !ring.passed) {
              ctx.strokeStyle = 'rgba(245, 180, 120, 0.45)';
              ctx.lineWidth = 1.2;
              for (let v = -1; v <= 1; v++) {
                ctx.beginPath();
                const vx = projX + v * projRadius * 0.45;
                const vy = projY - Math.sin(time * 0.005 + v) * 15;
                ctx.moveTo(vx, vy + 20);
                ctx.lineTo(vx, vy - 25);
                ctx.stroke();
              }
            }

            ctx.beginPath();
            ctx.ellipse(projX, projY, projRadius, projRadius * 0.4, 0, 0, Math.PI * 2);
            ctx.strokeStyle = ring.passed
              ? '#10B981'
              : ring.isUpdraft
              ? '#F59E0B'
              : atmo.ringColor;
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

                // If thermal updraft, apply upward lift
                if (ring.isUpdraft) {
                  s.gliderTargetY = processThermalUpdraft(s.gliderTargetY);
                  audioEngine.playUpdraftWhoosh();
                }

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

      // ─── Spirit Companion (Origami Crane in Flow) ───────────────────
      const companion = companionRef.current;
      if (companion.alpha > 0.05) {
        ctx.save();
        ctx.translate(companion.x, companion.y);
        ctx.globalAlpha = companion.alpha;

        const flap = Math.sin(companion.wingPhase) * 12;

        // Origami crane body & wings
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = 'rgba(220, 220, 230, 0.8)';
        ctx.lineWidth = 1.0;

        // Left wing
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-14, -10 - flap);
        ctx.lineTo(-4, -2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Right wing
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(14, -10 - flap);
        ctx.lineTo(4, -2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Origami body & beak
        ctx.fillStyle = '#F5D4C7';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-3, 6);
        ctx.lineTo(0, 10);
        ctx.lineTo(3, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      }

      // ─── Glider (Paper Plane) ───────────────────────────────────────
      const gliderScreenX = width * 0.5;
      const craftAngle = s.gliderPitch * 0.35 + s.gliderRoll * 0.4;

      ctx.save();
      ctx.translate(gliderScreenX, gliderScreenY);
      ctx.rotate(craftAngle);

      // Trailing wingtip vapor trails
      if (rawZoneScore > 0.08) {
        ctx.beginPath();
        const trailLen = 45 + (s.multiplier > 1 ? s.multiplier * 18 : 0);
        ctx.moveTo(-24, -19);
        ctx.lineTo(-24 - trailLen, -21);
        ctx.moveTo(-24, 19);
        ctx.lineTo(-24 - trailLen, 21);
        ctx.strokeStyle = `rgba(232, 150, 122, ${0.85 * rawZoneScore})`;
        ctx.lineWidth = s.multiplier >= 2 ? 2.5 : 1.8;
        ctx.stroke();
      }

      // Paper plane body
      ctx.beginPath();
      ctx.moveTo(34, 0);       // Nose
      ctx.lineTo(-24, -19);   // Left wingtip
      ctx.lineTo(-14, 0);     // Fuselage fold
      ctx.lineTo(-24, 19);    // Right wingtip
      ctx.closePath();

      const craftGrad = ctx.createLinearGradient(-24, -19, 34, 19);
      craftGrad.addColorStop(0, '#FFFFFF');
      craftGrad.addColorStop(0.5, '#F5D4C7');
      craftGrad.addColorStop(1, activeTheme.craftPalette[2]);

      ctx.fillStyle = craftGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
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
          distanceTraveled: Math.floor(s.distanceTraveled),
          atmosphereName: atmo.name,
        });
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      audioEngine.stopFlightWind();
      audioEngine.stopAmbientFlowLayers();
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
        {/* Biome & Time-of-Day Badge */}
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
          <span>{hudState.atmosphereName}</span>
        </div>

        {/* Distance Traveled Meter */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(8px)',
            padding: '5px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
          }}
        >
          <Wind size={13} color="var(--brand-primary)" />
          <span>{hudState.distanceTraveled.toLocaleString()} m</span>
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
            <span>{hudState.ringsCleared}</span>
          </div>
        )}

        {/* Flow State Pill */}
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
