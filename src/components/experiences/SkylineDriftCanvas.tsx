import React, { useEffect, useRef, useState } from 'react';
import type { EEGDataPoint, ProtocolType } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Zap, Shield, Wind, Sparkles, Feather } from 'lucide-react';
import {
  computeTargetElevation,
  isAutopilotActive,
  computeBaseSpeed,
  dampenPitch,
  updateFlowProgression,
  computeSkyAtmosphere,
  spawnNextLandmark,
  isWaterSkimming,
  calculateFlockOffsets,
  computeStreamNodes,
} from './skyline/skylineGameLogic';
import type {
  SkylineFlightMode,
  DriftingPetal,
  BloomObject,
  SkylineParticle,
  SkylineGameState,
  SkylineLandmark,
  WaterRipple,
} from './skyline/skylineTypes';

export interface SkylineDriftProps {
  eegData: EEGDataPoint | null;
  assignedProtocol?: ProtocolType;
  recentInZonePercent?: number | null;
  biome?: string;
  isPaused?: boolean;
}

const FLIGHT_MODES: { id: SkylineFlightMode; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }[] = [
  { id: 'wind-stream', label: 'Wind Stream', icon: Wind },
  { id: 'spirit-flock', label: 'Spirit Flock', icon: Feather },
  { id: 'living-canvas', label: 'Living Canvas', icon: Sparkles },
];

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  assignedProtocol = 'alpha-enhancement', // Default relaxation protocol
  recentInZonePercent,
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [flightMode, setFlightMode] = useState<SkylineFlightMode>('wind-stream');

  // Minimal HUD state synced at lower tick rate to avoid re-render overhead
  const [hudState, setHudState] = useState<{
    score: number;
    multiplier: 1 | 2 | 3 | 4;
    inZoneContinuousSeconds: number;
    autopilotActive: boolean;
    hyperDriftActive: boolean;
    distanceTraveled: number;
    atmosphereName: string;
    modeMetric: number;
  }>({
    score: 0,
    multiplier: 1,
    inZoneContinuousSeconds: 0,
    autopilotActive: false,
    hyperDriftActive: false,
    distanceTraveled: 0,
    atmosphereName: 'Alpine Dawn',
    modeMetric: 0,
  });

  // Game state & simulation refs
  const stateRef = useRef<SkylineGameState>({
    score: 0,
    streak: 0,
    maxStreak: 0,
    multiplier: 1,
    inZoneContinuousSeconds: 0,
    petalsCollected: 0,
    flockCount: 1,
    bloomsAwakened: 0,
    hyperDriftActive: false,
    hyperDriftTimeLeft: 0,
    gliderY: 0.5,
    gliderTargetY: 0.5,
    gliderPitch: 0,
    gliderRoll: 0,
    speed: 1.0,
    autopilotActive: false,
    distanceTraveled: 0,
    timeOfDay: 0.05, // Starts at gentle morning dawn
    isSkimmingWater: false,
    flightMode: 'wind-stream',
  });

  stateRef.current.flightMode = flightMode;

  const worldOffsetRef = useRef(0);
  const particlesRef = useRef<SkylineParticle[]>([]);
  const landmarksRef = useRef<SkylineLandmark[]>([]);
  const ripplesRef = useRef<WaterRipple[]>([]);
  const petalsRef = useRef<DriftingPetal[]>([]);
  const bloomsRef = useRef<BloomObject[]>([]);
  const lastFlockCountRef = useRef(1);

  const eegDataRef = useRef<EEGDataPoint | null>(null);
  eegDataRef.current = eegData;
  const lastHudUpdateRef = useRef(0);

  // Initialize ambient particles, petals, blooms, and cleanup
  useEffect(() => {
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

    // Wind stream floating petals (Mode 1)
    petalsRef.current = Array.from({ length: 12 }, (_, i) => ({
      x: (Math.random() - 0.5) * 60,
      y: 0.35 + Math.random() * 0.35,
      z: 200 + i * 110,
      size: 6 + Math.random() * 4,
      color: i % 2 === 0 ? '#F5C6A5' : '#E8967A',
      rotation: Math.random() * Math.PI * 2,
      collected: false,
    }));

    // Living Canvas blooms & lanterns (Mode 3)
    bloomsRef.current = Array.from({ length: 16 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 450,
      y: i % 3 === 0 ? 0.90 : 0.68 + (Math.random() * 0.15),
      z: 150 + i * 90,
      type: i % 3 === 0 ? 'lantern' : 'flower',
      scale: 0.2,
      alpha: 0.3,
      color: i % 3 === 0 ? '#F59E0B' : ['#E8967A', '#F5C6A5', '#A78BFA', '#F472B6'][i % 4],
      bloomed: false,
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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
        s.gliderRoll = Math.sin(time * 0.002) * 0.12;
        worldOffsetRef.current += dt * 75 * s.speed;
        s.distanceTraveled += dt * 36 * s.speed;

        // Continuous Day/Night Odyssey: complete cycle every ~4.5 minutes
        s.timeOfDay = (s.timeOfDay + dt * 0.0037) % 1.0;

        // Continuous Flow Multiplier Progression (Replaces Circle Rings!)
        const flowResult = updateFlowProgression(
          s.inZoneContinuousSeconds,
          dt,
          inZone,
          s.hyperDriftActive
        );
        s.inZoneContinuousSeconds = flowResult.newInZoneSeconds;
        s.multiplier = flowResult.multiplier;
        s.score += flowResult.scoreGained;

        if (flowResult.triggerHyperDrift && !s.hyperDriftActive) {
          s.hyperDriftActive = true;
          s.hyperDriftTimeLeft = 15;
          audioEngine.playHyperDriftStinger();
        }

        if (s.hyperDriftActive) {
          s.hyperDriftTimeLeft -= dt;
          if (s.hyperDriftTimeLeft <= 0) {
            s.hyperDriftActive = false;
          }
        }

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

        // Spirit flock count escalation (Mode 2)
        const targetFlock = s.multiplier === 4 ? 7 : s.multiplier === 3 ? 5 : s.multiplier === 2 ? 3 : 1;
        s.flockCount = targetFlock;
        if (targetFlock > lastFlockCountRef.current) {
          audioEngine.playPentatonicRingArpeggio(targetFlock - 1);
        }
        lastFlockCountRef.current = targetFlock;
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

      // ==========================================
      // 3. FLIGHT MODALITY RENDERING
      // ==========================================
      const gliderScreenX = width * 0.5;
      const gliderScreenY = height * (0.2 + s.gliderY * 0.55);

      // ─── MODE 1: WIND STREAM ──────────────────────────────────────
      if (s.flightMode === 'wind-stream') {
        const streamNodes = computeStreamNodes(time, s.gliderTargetY);

        // Draw flowing undulating thermal slipstream ribbon
        if (streamNodes.length >= 2) {
          ctx.save();
          ctx.beginPath();
          for (let i = 0; i < streamNodes.length; i++) {
            const node = streamNodes[i];
            const scale = fov / (fov + node.z);
            const px = width * 0.5 + node.x * scale;
            const py = height * node.y;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = atmo.streamColor;
          ctx.lineWidth = 16;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();

          // Soft inner glowing core
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.restore();
        }

        // Drifting Petals on the Wind
        petalsRef.current.forEach((petal) => {
          if (!isPaused) {
            petal.z -= dt * 170 * s.speed;
            petal.rotation += dt * 1.5;
            if (petal.z <= 12) {
              petal.z = 1350;
              petal.y = 0.28 + Math.random() * 0.45;
              petal.x = (Math.random() - 0.5) * 80;
              petal.collected = false;
            }
          }

          if (petal.z > 15 && !petal.collected) {
            const scale = fov / (fov + petal.z);
            const px = width * 0.5 + petal.x * scale;
            const py = height * petal.y;

            // Hit detection with glider
            if (petal.z < 85 && !isPaused) {
              const dy = Math.abs(gliderScreenY - py);
              const dx = Math.abs(gliderScreenX - px);
              if (dy < 38 && dx < 48) {
                petal.collected = true;
                s.petalsCollected += 1;
                s.score += 80 * s.multiplier;
                audioEngine.playShardCollect();
              }
            }

            // Draw organic petal
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(petal.rotation);
            ctx.fillStyle = petal.color;
            ctx.globalAlpha = Math.min(1.0, scale * 2.8);
            ctx.beginPath();
            ctx.ellipse(0, 0, petal.size * scale * 2.2, petal.size * scale * 1.1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });
      }

      // ─── MODE 2: SPIRIT FLOCK (ORIGAMI CRANES) ───────────────────
      if (s.flightMode === 'spirit-flock') {
        const birds = calculateFlockOffsets(s.flockCount);
        birds.forEach((bird) => {
          const birdX = gliderScreenX + bird.offsetX;
          const birdY = gliderScreenY + bird.offsetY;
          const wingFlap = Math.sin(time * 0.005 + bird.wingPhase) * 11;

          ctx.save();
          ctx.translate(birdX, birdY);
          ctx.scale(bird.scale, bird.scale);

          // White origami crane body
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = 'rgba(215, 215, 225, 0.9)';
          ctx.lineWidth = 1.0;

          // Left wing
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-14, -10 - wingFlap);
          ctx.lineTo(-4, -2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Right wing
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(14, -10 - wingFlap);
          ctx.lineTo(4, -2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Head & tail fold
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
        });
      }

      // ─── MODE 3: LIVING CANVAS (BLOOMS & LANTERNS) ────────────────
      if (s.flightMode === 'living-canvas') {
        bloomsRef.current.forEach((b) => {
          if (!isPaused) {
            b.z -= dt * 140 * s.speed;
            if (b.z <= 12) {
              b.z = 1350;
              b.x = (Math.random() - 0.5) * 450;
              b.bloomed = false;
              b.scale = 0.2;
            }
          }

          if (b.z > 15) {
            const scale = fov / (fov + b.z);
            const px = width * 0.5 + b.x * scale;
            const py = height * b.y;

            // In-zone proximity awakens the bloom
            if (b.z < 120 && inZone && !b.bloomed) {
              b.bloomed = true;
              s.bloomsAwakened += 1;
              s.score += 100 * s.multiplier;
              audioEngine.playShardCollect();
            }

            if (b.bloomed && b.scale < 1.0) {
              b.scale = Math.min(1.0, b.scale + dt * 3.0);
            }

            ctx.save();
            ctx.translate(px, py);
            const drawScale = scale * b.scale * 2.2;
            ctx.scale(drawScale, drawScale);

            if (b.type === 'lantern') {
              // River lantern with warm candle flame
              ctx.fillStyle = '#F59E0B';
              ctx.globalAlpha = b.bloomed ? 0.95 : 0.45;
              ctx.beginPath();
              ctx.arc(0, 0, 8, 0, Math.PI * 2);
              ctx.fill();

              // Lantern paper frame
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 1.2;
              ctx.strokeRect(-5, -7, 10, 14);
            } else {
              // Hillside blooming wildflower
              ctx.fillStyle = b.color;
              ctx.globalAlpha = b.bloomed ? 0.95 : 0.40;
              for (let petal = 0; petal < 5; petal++) {
                const angle = (petal * Math.PI * 2) / 5;
                ctx.beginPath();
                ctx.arc(Math.cos(angle) * 5, Math.sin(angle) * 5, 4, 0, Math.PI * 2);
                ctx.fill();
              }
              // Blossom center
              ctx.fillStyle = '#FFFDF5';
              ctx.beginPath();
              ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
        });
      }

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
            const archW = 160 * scale * 2.4;
            const archH = 220 * scale * 2.4;
            ctx.fillStyle = atmo.mountainNear;
            ctx.globalAlpha = Math.min(1.0, scale * 3.0);
            ctx.fillRect(projX - archW * 0.5, projY - archH, archW * 0.22, archH);
            ctx.fillRect(projX + archW * 0.28, projY - archH, archW * 0.22, archH);
            ctx.beginPath();
            ctx.arc(projX, projY - archH + archW * 0.2, archW * 0.5, Math.PI, 0, false);
            ctx.lineWidth = archW * 0.24;
            ctx.strokeStyle = atmo.mountainNear;
            ctx.stroke();
          } else if (lm.kind === 'waterfall') {
            const streamW = 28 * scale * 2.2;
            const streamH = 140 * scale * 2.2;
            ctx.fillStyle = 'rgba(230, 245, 255, 0.75)';
            ctx.fillRect(projX - streamW * 0.5, projY - streamH, streamW, streamH);
          } else if (lm.kind === 'turbines') {
            const mastH = 110 * scale * 2.2;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(1.5, 3 * scale);
            ctx.beginPath();
            ctx.moveTo(projX, projY);
            ctx.lineTo(projX, projY - mastH);
            ctx.stroke();

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

      // ─── Glider (Paper Plane) ───────────────────────────────────────
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
      craftGrad.addColorStop(1, '#E8967A');

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
        const currentModeMetric =
          s.flightMode === 'wind-stream'
            ? s.petalsCollected
            : s.flightMode === 'spirit-flock'
            ? s.flockCount
            : s.bloomsAwakened;

        setHudState({
          score: s.score,
          multiplier: s.multiplier,
          inZoneContinuousSeconds: Math.floor(s.inZoneContinuousSeconds),
          autopilotActive: s.autopilotActive,
          hyperDriftActive: s.hyperDriftActive,
          distanceTraveled: Math.floor(s.distanceTraveled),
          atmosphereName: atmo.name,
          modeMetric: currentModeMetric,
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
  }, [flightMode, isPaused]);

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
          <Compass size={14} color="var(--brand-primary, #E8967A)" />
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
          <Wind size={13} color="var(--brand-primary, #E8967A)" />
          <span>{hudState.distanceTraveled.toLocaleString()} m</span>
        </div>

        {/* Mode Specific Metric Badge */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(8px)',
            color: 'var(--brand-primary, #E8967A)',
            padding: '5px 10px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 700,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
          }}
        >
          {flightMode === 'wind-stream' && (
            <>
              <Wind size={13} />
              <span>{hudState.modeMetric} Petals</span>
            </>
          )}
          {flightMode === 'spirit-flock' && (
            <>
              <Feather size={13} />
              <span>{hudState.modeMetric} Cranes</span>
            </>
          )}
          {flightMode === 'living-canvas' && (
            <>
              <Sparkles size={13} />
              <span>{hudState.modeMetric} Awakened</span>
            </>
          )}
        </div>

        {/* Flow State Pill */}
        {hudState.multiplier > 1 && (
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

      {/* Bottom Right Minimal Flight Mode Switcher (Replaces Color Palette) */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          display: 'flex',
          gap: '4px',
          background: 'rgba(255, 255, 255, 0.88)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
        }}
      >
        {FLIGHT_MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = flightMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => setFlightMode(mode.id)}
              style={{
                background: isActive ? 'var(--brand-primary, #E8967A)' : 'transparent',
                color: isActive ? '#FFFFFF' : 'var(--text-primary)',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={12} color={isActive ? '#FFFFFF' : 'var(--text-secondary)'} />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
