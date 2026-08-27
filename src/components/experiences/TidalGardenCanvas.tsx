import React, { useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';

interface TidalGardenProps {
  eegData: EEGDataPoint | null;
  stage?: number;
  growthPoints?: number;
  inZonePercent?: number;
  isPaused?: boolean;
}

export const TidalGardenCanvas: React.FC<TidalGardenProps> = ({
  eegData,
  stage = 3,
  growthPoints = 420,
  inZonePercent = 0,
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const planktonRef = useRef<Array<{ x: number; y: number; speed: number; radius: number; hue: number }>>([]);
  const kelpRef = useRef<Array<{ x: number; height: number; segments: number; baseSpeed: number; width: number }>>([]);

  useEffect(() => {
    // Generate kelp forest stalks
    kelpRef.current = Array.from({ length: 14 }, () => ({
      x: Math.random() * 800,
      height: Math.random() * 220 + 120,
      segments: Math.floor(Math.random() * 4) + 6,
      baseSpeed: Math.random() * 0.8 + 0.6,
      width: Math.random() * 12 + 8,
    }));

    // Generate bioluminescent plankton
    planktonRef.current = Array.from({ length: 50 }, () => ({
      x: Math.random() * 800,
      y: Math.random() * 600,
      speed: Math.random() * 18 + 8,
      radius: Math.random() * 2.8 + 1.2,
      hue: Math.random() * 40 + 15, // Coral/Amber hue range
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();
    let timeElapsed = 0;

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
      if (!isPaused) timeElapsed += dt;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      // Alpha wave dominance drives garden bioluminescence & bloom
      const alphaVal = eegData?.bands.alpha || 8.5;
      const alphaRatio = Math.max(0.2, Math.min(1.0, (alphaVal - 5) / 12));
      const inZone = eegData?.inZone ?? true;
      const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

      // Deep tranquil warm sea background gradient (interpolated)
      const interpolateColor = (c1: number[], c2: number[], t: number) => {
        const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
        const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
        const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
        return `rgb(${r},${g},${b})`;
      };
      const seaGrad = ctx.createLinearGradient(0, 0, 0, height);
      seaGrad.addColorStop(0, interpolateColor([222, 214, 203], [232, 222, 209], zoneScore));
      seaGrad.addColorStop(0.5, interpolateColor([237, 230, 220], [245, 237, 228], zoneScore));
      seaGrad.addColorStop(1, interpolateColor([242, 236, 228], [248, 245, 240], zoneScore));
      
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, 0, width, height);

      // Procedural Seabed Dunes
      ctx.fillStyle = '#E8DDD0';
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += 10) {
        const y = height - 50 + Math.sin(x * 0.008 + 1) * 16 + Math.cos(x * 0.02) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.fill();

      // Swaying Kelp Forest
      kelpRef.current.forEach(k => {
        const xPos = (k.x / 800) * width;
        const baseY = height - 35;
        ctx.beginPath();
        ctx.moveTo(xPos, baseY);

        const sway = Math.sin(timeElapsed * k.baseSpeed + k.x) * (20 * alphaRatio);
        const cp1x = xPos + sway * 0.5;
        const cp1y = baseY - k.height * 0.5;
        const topX = xPos + sway;
        const topY = baseY - k.height;

        ctx.quadraticCurveTo(cp1x, cp1y, topX, topY);
        
        const kr = 150 + (125 - 150) * zoneScore;
        const kg = 170 + (166 - 170) * zoneScore;
        const kb = 140 + (104 - 140) * zoneScore;
        const ka = 0.4 + (0.65 - 0.4) * zoneScore;
        ctx.strokeStyle = `rgba(${kr}, ${kg}, ${kb}, ${ka})`;
        ctx.lineWidth = k.width;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Little leaf fronds
        for (let seg = 1; seg <= k.segments; seg++) {
          const t = seg / (k.segments + 1);
          const leafY = baseY - k.height * t;
          const leafX = xPos + sway * t;
          const leafDir = seg % 2 === 0 ? 1 : -1;
          ctx.beginPath();
          ctx.ellipse(leafX + leafDir * 14, leafY, 14, 6, (leafDir * Math.PI) / 6, 0, Math.PI * 2);
          
          const lr = 180 + (168 - 180) * zoneScore;
          const lg = 195 + (196 - 195) * zoneScore;
          const lb = 175 + (148 - 175) * zoneScore;
          const la = 0.5 + (0.7 - 0.5) * zoneScore;
          ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${la})`;
          ctx.fill();
        }
      });

      // Coral Formations at base (Stage-dependent density)
      const corals = [
        { x: width * 0.25, r: 42, color: '#E8967A' },
        { x: width * 0.48, r: 56, color: '#E4B87C' },
        { x: width * 0.75, r: 48, color: '#D4805E' },
      ];

      const bloomMultiplier = 1 + (inZonePercent / 100) * 0.5;

      corals.forEach(coral => {
        const coralY = height - 40;
        ctx.save();
        ctx.translate(coral.x, coralY);

        // Multi-layered rounded coral domes
        for (let branch = 0; branch < 5; branch++) {
          const angle = -Math.PI / 2 + (branch - 2) * 0.35;
          const len = coral.r * bloomMultiplier * (0.8 + Math.sin(timeElapsed * 0.8 + branch) * 0.06 * alphaRatio);
          const bx = Math.cos(angle) * len;
          const by = Math.sin(angle) * len;

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = coral.color;
          ctx.lineWidth = 18;
          ctx.lineCap = 'round';
          ctx.stroke();

          // Bioluminescent tip glow
          const glowRadius = 8 + 6 * alphaRatio;
          const glowGrad = ctx.createRadialGradient(bx, by, 1, bx, by, glowRadius);
          glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
          glowGrad.addColorStop(0.5, coral.color);
          glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

          ctx.fillStyle = glowGrad;
          ctx.beginPath();
          ctx.arc(bx, by, glowRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // Floating Bioluminescent Plankton
      planktonRef.current.forEach(p => {
        if (!isPaused) {
          p.y -= dt * p.speed * (0.6 + alphaRatio * 0.8);
          if (p.y < -10) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
        }
        const pX = (p.x / 800) * width + Math.sin(timeElapsed + p.y * 0.05) * 8;
        const pRadius = p.radius * (0.8 + alphaRatio * 0.7);

        ctx.beginPath();
        ctx.arc(pX, p.y, pRadius, 0, Math.PI * 2);
        
        const pr = 200 + (232 - 200) * zoneScore;
        const pg = 180 + (150 - 180) * zoneScore;
        const pb = 160 + (122 - 160) * zoneScore;
        const pa = 0.25 + ((0.4 + alphaRatio * 0.45) - 0.25) * zoneScore;
        ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${pa})`;
        
        ctx.fill();
      });

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [eegData, stage, growthPoints, isPaused]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          background: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(4px)',
          padding: '4px 12px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        Tidal Garden: Stage {stage} ({growthPoints} XP)
      </div>
    </div>
  );
};
