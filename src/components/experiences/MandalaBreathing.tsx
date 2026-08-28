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
      const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

      // Background Canvas
      const bgGrad = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, Math.max(width, height) * 0.7);
      bgGrad.addColorStop(0, '#FFFFFF');
      bgGrad.addColorStop(0.5, '#FAF8F5');
      bgGrad.addColorStop(1, '#EDE7DF');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Breathing envelope cycle (5.5s cycle = 0.1Hz HRV resonance)
      const breatheCycle = (Math.sin(timeElapsed * 1.14) + 1) * 0.5; // 0 to 1
      const baseRadius = Math.min(width, height) * 0.22;

      // Outer sacred geometry mandala petals (12-fold symmetry)
      const petals = 12;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(timeElapsed * 0.12);

      for (let p = 0; p < petals; p++) {
        const angle = (p * Math.PI * 2) / petals;
        ctx.save();
        ctx.rotate(angle);

        const petalLen = baseRadius * (1.1 + 0.35 * breatheCycle + 0.3 * zoneScore);
        const petalWidth = 24 * (0.8 + 0.4 * coherence);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(petalWidth, petalLen * 0.5, 0, petalLen);
        ctx.quadraticCurveTo(-petalWidth, petalLen * 0.5, 0, 0);

        ctx.fillStyle = p % 2 === 0
          ? `rgba(232, 150, 122, ${0.25 + 0.35 * zoneScore})`
          : `rgba(228, 184, 124, ${0.25 + 0.35 * zoneScore})`;
        ctx.fill();

        ctx.strokeStyle = `rgba(232, 150, 122, ${0.6 + 0.3 * zoneScore})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
      }
      ctx.restore();

      // Inner 8-fold Lotus Ring
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(-timeElapsed * 0.18);

      for (let p = 0; p < 8; p++) {
        const angle = (p * Math.PI * 2) / 8;
        ctx.save();
        ctx.rotate(angle);

        const innerLen = baseRadius * (0.65 + 0.2 * breatheCycle);
        const innerW = 16 * (0.8 + 0.3 * coherence);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(innerW, innerLen * 0.5, 0, innerLen);
        ctx.quadraticCurveTo(-innerW, innerLen * 0.5, 0, 0);

        ctx.fillStyle = `rgba(245, 212, 199, ${0.45 + 0.4 * zoneScore})`;
        ctx.fill();
        ctx.strokeStyle = '#E8967A';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
      }
      ctx.restore();

      // Central Harmonic Crystal
      const centerR = 18 + 6 * breatheCycle + 8 * coherence;
      const centerGrad = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, centerR);
      centerGrad.addColorStop(0, '#FFFFFF');
      centerGrad.addColorStop(0.6, '#E8967A');
      centerGrad.addColorStop(1, 'rgba(232, 150, 122, 0)');

      ctx.fillStyle = centerGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, centerR, 0, Math.PI * 2);
      ctx.fill();

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
