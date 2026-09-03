import React, { useEffect, useRef, useState } from 'react';
import type { EEGDataPoint, ProtocolType } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Wind, Sparkles, Shield } from 'lucide-react';
import {
  computeTargetElevation,
  isAutopilotActive,
  computeAerodynamics,
  updateAtmosphericMist,
  getExpeditionRegion,
  checkExpeditionMilestone,
} from './skyline/skylineGameLogic';
import type {
  SkylineGameState,
  SkylineParticle,
  ExpeditionMilestone,
} from './skyline/skylineTypes';

export interface SkylineDriftProps {
  eegData: EEGDataPoint | null;
  assignedProtocol?: ProtocolType;
  recentInZonePercent?: number | null;
  biome?: string;
  isPaused?: boolean;
}

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Minimal HUD state
  const [hudState, setHudState] = useState<{
    regionName: string;
    distanceTraveled: number;
    inZone: boolean;
    autopilotActive: boolean;
    currentMilestone: ExpeditionMilestone | null;
  }>({
    regionName: 'The Alpine Glades',
    distanceTraveled: 0,
    inZone: false,
    autopilotActive: false,
    currentMilestone: null,
  });

  // Game state & simulation refs
  const stateRef = useRef<SkylineGameState>({
    gliderY: 0.5,
    gliderTargetY: 0.5,
    gliderPitch: 0,
    gliderRoll: 0,
    verticalVelocity: 0,
    speed: 1.0,
    distanceTraveled: 0,
    mistDensity: 0.35, // Starts with gentle mist
    autopilotActive: false,
    activeRegion: 'alpine-glades',
    currentMilestone: null,
    milestoneTimeLeft: 0,
    inZone: false,
  });

  const worldOffsetRef = useRef(0);
  const particlesRef = useRef<SkylineParticle[]>([]);
  const achievedMilestonesRef = useRef<Set<string>>(new Set());
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  eegDataRef.current = eegData;
  const lastHudUpdateRef = useRef(0);

  // Initialize ambient cloud motes & cleanup audio
  useEffect(() => {
    particlesRef.current = Array.from({ length: 40 }, () => ({
      x: (Math.random() - 0.5) * 850,
      y: (Math.random() - 0.5) * 420,
      z: Math.random() * 850 + 80,
      size: Math.random() * 2.2 + 1.0,
      color: '#FFFFFF',
      alpha: Math.random() * 0.45 + 0.3,
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

      // 1. NEUROFEEDBACK DRIVEN FLIGHT & MIST DYNAMICS
      const currentEEG = eegDataRef.current;
      const rawZoneScore = currentEEG ? (currentEEG.zoneScore ?? (currentEEG.inZone ? 1.0 : 0.45)) : 0.5;
      const inZone = currentEEG ? (currentEEG.inZone ?? rawZoneScore >= 0.6) : false;
      s.inZone = inZone;

      if (currentEEG) {
        s.autopilotActive = isAutopilotActive(currentEEG);
        s.gliderTargetY = computeTargetElevation(rawZoneScore);
      }

      const region = getExpeditionRegion(s.distanceTraveled);
      s.activeRegion = region.id;

      if (!isPaused) {
        // Kinetic Aerodynamics (Lift, Dive, Momentum, Banking)
        const baseSpeed = 0.90 + rawZoneScore * 0.70;
        const aero = computeAerodynamics(
          {
            gliderY: s.gliderY,
            pitch: s.gliderPitch,
            roll: s.gliderRoll,
            speed: s.speed,
            verticalVelocity: s.verticalVelocity,
          },
          s.gliderTargetY,
          baseSpeed,
          s.autopilotActive,
          dt,
          time
        );

        s.gliderY = aero.gliderY;
        s.gliderPitch = aero.pitch;
        s.gliderRoll = aero.roll;
        s.speed = aero.speed;
        s.verticalVelocity = aero.verticalVelocity;

        worldOffsetRef.current += dt * 70 * s.speed;
        s.distanceTraveled += dt * 32 * s.speed;

        // Atmospheric Mist Parting (Clinical Biofeedback)
        s.mistDensity = updateAtmosphericMist(s.mistDensity, inZone, dt);

        // Milestone detection
        const newMilestone = checkExpeditionMilestone(s.distanceTraveled, achievedMilestonesRef.current);
        if (newMilestone) {
          achievedMilestonesRef.current.add(newMilestone.id);
          s.currentMilestone = newMilestone;
          s.milestoneTimeLeft = 4.5;
          audioEngine.playMeditativeIntroChime();
        }

        if (s.milestoneTimeLeft > 0) {
          s.milestoneTimeLeft -= dt;
          if (s.milestoneTimeLeft <= 0) {
            s.currentMilestone = null;
          }
        }

        // Modulate Audio Engine: in-zone opens crystalline sound; out-of-zone muffles
        audioEngine.updateFlightWind(s.speed, inZone);
        audioEngine.updateNeuroFeedback(inZone, rawZoneScore);
        audioEngine.updateAmbientFlowLayers(inZone ? 3 : 1, inZone);
      }

      // ==========================================
      // 2. PRISTINE SCENIC WATERCOLOR RENDERING
      // ==========================================

      // Background Sky Gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, region.skyTop);
      skyGrad.addColorStop(0.55, region.skyMid);
      skyGrad.addColorStop(1, region.skyBot);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Warm Sun & Radiant Beams (Amplified when In-Zone)
      const sunX = width * 0.72;
      const sunY = height * 0.26;
      ctx.save();
      const sunClarity = 1.0 - s.mistDensity * 0.75;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 70);
      sunGlow.addColorStop(0, `rgba(255, 250, 240, ${0.95 * sunClarity})`);
      sunGlow.addColorStop(0.4, `rgba(255, 220, 180, ${0.35 * sunClarity})`);
      sunGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 70, 0, Math.PI * 2);
      ctx.fill();

      // Sharp sun disc
      ctx.fillStyle = `rgba(255, 253, 245, ${0.98 * sunClarity})`;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Parallax Watercolor Mountains
      const layers = region.cloudSeaActive
        ? [
            // Cloud Sea: rolling billowy cloud banks instead of rocky peaks
            { speed: 0.10, heightScale: 0.25, yBase: height * 0.65, freq: 0.003, color: region.mountainFar, alpha: 0.50 },
            { speed: 0.25, heightScale: 0.35, yBase: height * 0.76, freq: 0.005, color: region.mountainMid, alpha: 0.75 },
            { speed: 0.45, heightScale: 0.40, yBase: height * 0.86, freq: 0.008, color: region.mountainNear, alpha: 0.95 },
          ]
        : [
            // Mountain Ridges
            { speed: 0.10, heightScale: 0.45, yBase: height * 0.55, freq: region.mountainFreq, color: region.mountainFar, alpha: 0.45 },
            { speed: 0.25, heightScale: 0.35, yBase: height * 0.68, freq: region.mountainFreq * 2, color: region.mountainMid, alpha: 0.70 },
            { speed: 0.50, heightScale: 0.25, yBase: height * 0.82, freq: region.mountainFreq * 3.3, color: region.mountainNear, alpha: 0.95 },
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

      // Horizon River Valley (when in canyon/glades)
      if (!region.cloudSeaActive) {
        const riverY = height * 0.92;
        ctx.fillStyle = region.river;
        ctx.beginPath();
        ctx.ellipse(width * 0.5, riverY, width * 0.65, height * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ambient 3D Cloud / Mist Motes
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      particlesRef.current.forEach((p) => {
        if (!isPaused) {
          p.z -= dt * 220 * s.speed;
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

      // ==========================================
      // 3. CLINICAL BIOFEEDBACK MIST OVERLAY
      // ==========================================
      // When out-of-zone, soft translucent mist rolls across the lower half of screen
      if (s.mistDensity > 0.02) {
        ctx.save();
        const mistGrad = ctx.createLinearGradient(0, height * 0.35, 0, height);
        mistGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        mistGrad.addColorStop(0.5, `rgba(245, 238, 230, ${0.45 * s.mistDensity})`);
        mistGrad.addColorStop(1, `rgba(240, 232, 222, ${0.75 * s.mistDensity})`);
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, height * 0.35, width, height * 0.65);
        ctx.restore();
      }

      // ==========================================
      // 4. KINETIC PAPER GLIDER
      // ==========================================
      const gliderScreenX = width * 0.5;
      const gliderScreenY = height * (0.2 + s.gliderY * 0.55);
      const craftAngle = s.gliderPitch * 0.45 + s.gliderRoll * 0.35;

      ctx.save();
      ctx.translate(gliderScreenX, gliderScreenY);
      ctx.rotate(craftAngle);

      // Wingtip vapor trails (elongate smoothly during high focus & climb)
      if (rawZoneScore > 0.12) {
        ctx.beginPath();
        const trailLen = 45 + rawZoneScore * 35;
        ctx.moveTo(-24, -19);
        ctx.lineTo(-24 - trailLen, -21);
        ctx.moveTo(-24, 19);
        ctx.lineTo(-24 - trailLen, 21);
        ctx.strokeStyle = `rgba(232, 150, 122, ${0.85 * rawZoneScore})`;
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }

      // Minimalist Paper Plane Body
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
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
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
          regionName: region.name,
          distanceTraveled: Math.floor(s.distanceTraveled),
          inZone: s.inZone,
          autopilotActive: s.autopilotActive,
          currentMilestone: s.currentMilestone,
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
  }, [isPaused]);

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

      {/* Top Left Clean Status Badges (Minimalist & Calm) */}
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
        {/* Scenic Region Badge */}
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
          <span>{hudState.regionName}</span>
        </div>

        {/* Distance Soared Meter */}
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

        {/* In-Zone Flow Indicator */}
        {hudState.inZone && (
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
            <Sparkles size={13} />
            <span>Soaring (In Flow)</span>
          </div>
        )}

        {/* Autopilot Badge (Engages during blink / muscle clench) */}
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

      {/* Bottom Center Elegant Milestone Toast (Fades in quietly for 4s) */}
      {hudState.currentMilestone && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 18px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
            textAlign: 'center',
            pointerEvents: 'none',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-primary, #E8967A)' }}>
            {hudState.currentMilestone.title}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {hudState.currentMilestone.description}
          </div>
        </div>
      )}
    </div>
  );
};
