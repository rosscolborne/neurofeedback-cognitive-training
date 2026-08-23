import React, { useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface RhythmLockProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

export const RhythmLockGame: React.FC<RhythmLockProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioStartedRef = useRef(false);

  useEffect(() => {
    if (!isPaused && !audioStartedRef.current) {
      audioEngine.startHarmonicPads();
      audioStartedRef.current = true;
    }
    return () => {
      audioEngine.stopAll();
      audioStartedRef.current = false;
    };
  }, [isPaused]);

  useEffect(() => {
    if (eegData) {
      audioEngine.updateNeuroFeedback(eegData.inZone);
    }
  }, [eegData]);

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
      const beta = eegData?.bands.beta || 9.0;
      const focusRatio = Math.max(0.3, Math.min(1.0, beta / 15.0));

      ctx.fillStyle = '#F8F7F4';
      ctx.fillRect(0, 0, width, height);

      // Concentric rhythmic orbital rings
      const rings = [
        { radius: 60, speed: 1.2, color: '#E8967A', dots: 4 },
        { radius: 105, speed: -0.8, color: '#E4B87C', dots: 6 },
        { radius: 150, speed: 0.6, color: '#7B68AE', dots: 8 },
        { radius: 195, speed: -0.4, color: '#5C8C46', dots: 12 },
      ];

      rings.forEach((ring, idx) => {
        // Draw track
        ctx.beginPath();
        ctx.arc(centerX, centerY, ring.radius, 0, Math.PI * 2);
        ctx.strokeStyle = inZone ? 'rgba(232, 150, 122, 0.3)' : 'rgba(200, 190, 180, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Orbital resonance nodes
        for (let d = 0; d < ring.dots; d++) {
          const angle = (d * (Math.PI * 2)) / ring.dots + timeElapsed * ring.speed;
          const nodeX = centerX + Math.cos(angle) * ring.radius;
          const nodeY = centerY + Math.sin(angle) * ring.radius;

          ctx.beginPath();
          const nodeRadius = inZone ? 5 + Math.sin(timeElapsed * 3 + d) * 2 : 3;
          ctx.arc(nodeX, nodeY, nodeRadius, 0, Math.PI * 2);
          ctx.fillStyle = ring.color;
          ctx.fill();

          // Connect harmonics across rings
          if (idx > 0 && inZone && d % 2 === 0) {
            const innerRing = rings[idx - 1];
            const innerAngle = (d * (Math.PI * 2)) / innerRing.dots + timeElapsed * innerRing.speed;
            const inX = centerX + Math.cos(innerAngle) * innerRing.radius;
            const inY = centerY + Math.sin(innerAngle) * innerRing.radius;

            ctx.beginPath();
            ctx.moveTo(nodeX, nodeY);
            ctx.lineTo(inX, inY);
            ctx.strokeStyle = 'rgba(232, 150, 122, 0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      });

      // Center Pulse Crystal
      const pulseRadius = 24 + (inZone ? Math.sin(timeElapsed * 4) * 8 * focusRatio : 0);
      const centerGrad = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, pulseRadius);
      centerGrad.addColorStop(0, '#FFFFFF');
      centerGrad.addColorStop(0.6, '#E8967A');
      centerGrad.addColorStop(1, 'rgba(232, 150, 122, 0)');
      
      ctx.fillStyle = centerGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
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
      <div
        style={{
          position: 'absolute',
          bottom: 14,
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
        🎵 Polyrhythmic Harmonic Resonance Engine Active
      </div>
    </div>
  );
};
