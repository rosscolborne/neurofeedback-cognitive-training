import React, { useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';

interface MandalaProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

export const MandalaBreathing: React.FC<MandalaProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let timeElapsed = 0;
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
      if (!isPaused) timeElapsed += dt;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      const inZone = eegData?.inZone ?? true;
      const coherence = (eegData?.coherence || 75) / 100;

      // Clear background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      // Outer breathing envelope (4s cycle)
      const breatheCycle = (Math.sin(timeElapsed * 1.5) + 1) * 0.5; // 0 to 1
      const baseRadius = Math.min(width, height) * 0.22;

      // Multi-layer concentric glowing rings
      const rings = [
        { r: baseRadius * 1.6 + breatheCycle * 14, color: 'rgba(232, 150, 122, 0.2)', width: 3 },
        { r: baseRadius * 1.35 + breatheCycle * 18, color: 'rgba(228, 184, 124, 0.4)', width: 8 },
        { r: baseRadius * 1.1 + breatheCycle * 22, color: 'rgba(232, 150, 122, 0.65)', width: 14 },
        { r: baseRadius * 0.75 + breatheCycle * 12, color: 'rgba(228, 184, 124, 0.85)', width: 10 },
        { r: baseRadius * 0.45 + breatheCycle * 6, color: '#FFFFFF', width: 4 },
      ];

      rings.forEach(ring => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = ring.width;
        ctx.stroke();
      });

      // Organic sinusoidal orbiting filaments
      const filamentCount = inZone ? 5 : 2;
      for (let f = 0; f < filamentCount; f++) {
        ctx.beginPath();
        const fAngleOffset = (f * Math.PI * 2) / filamentCount;
        const fRadius = baseRadius * (1.1 + f * 0.12);

        for (let a = 0; a <= Math.PI * 2; a += 0.08) {
          const wave = Math.sin(a * 4 + timeElapsed * 2 + fAngleOffset) * (8 * coherence);
          const r = fRadius + wave;
          const x = centerX + Math.cos(a) * r;
          const y = centerY + Math.sin(a) * r;

          if (a === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = f % 2 === 0 ? 'rgba(232, 150, 122, 0.5)' : 'rgba(228, 184, 124, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [eegData, isPaused]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};
