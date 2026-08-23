import React, { useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';

interface TidalGardenProps {
  eegData: EEGDataPoint | null;
  stage?: number;
  growthPoints?: number;
  isPaused?: boolean;
}

export const TidalGardenCanvas: React.FC<TidalGardenProps> = ({
  eegData,
  stage = 3,
  growthPoints = 420,
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

      // Deep tranquil warm sea background gradient
      const seaGrad = ctx.createLinearGradient(0, 0, 0, height);
      if (inZone) {
        seaGrad.addColorStop(0, '#E8DED1');
        seaGrad.addColorStop(0.5, '#F5EDE4');
        seaGrad.addColorStop(1, '#F8F5F0');
      } else {
        seaGrad.addColorStop(0, '#DED6CB');
        seaGrad.addColorStop(0.5, '#EDE6DC');
        seaGrad.addColorStop(1, '#F2ECE4');
      }
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
        ctx.strokeStyle = inZone ? 'rgba(125, 166, 104, 0.65)' : 'rgba(150, 170, 140, 0.4)';
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
          ctx.fillStyle = inZone ? 'rgba(168, 196, 148, 0.7)' : 'rgba(180, 195, 175, 0.5)';
          ctx.fill();
        }
      });

      // Coral Formations at base (Stage-dependent density)
      const corals = [
        { x: width * 0.25, r: 42, color: '#E8967A' },
        { x: width * 0.48, r: 56, color: '#E4B87C' },
        { x: width * 0.75, r: 48, color: '#D4805E' },
      ];

      corals.forEach(coral => {
        const coralY = height - 40;
        ctx.save();
        ctx.translate(coral.x, coralY);

        // Multi-layered rounded coral domes
        for (let branch = 0; branch < 5; branch++) {
          const angle = -Math.PI / 2 + (branch - 2) * 0.35;
          const len = coral.r * (0.8 + Math.sin(timeElapsed * 0.8 + branch) * 0.06 * alphaRatio);
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
        ctx.fillStyle = inZone ? `rgba(232, 150, 122, ${0.4 + alphaRatio * 0.45})` : 'rgba(200, 180, 160, 0.25)';
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
