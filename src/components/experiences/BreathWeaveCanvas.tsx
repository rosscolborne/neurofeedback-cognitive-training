import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface BreathWeaveProps {
  eegData: EEGDataPoint | null;
  cadence?: 'box' | '4-7-8' | 'resonance';
  isPaused?: boolean;
}

export const BreathWeaveCanvas: React.FC<BreathWeaveProps> = ({
  eegData,
  cadence = '4-7-8',
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentPhase, setCurrentPhase] = useState<'Inhale' | 'Hold' | 'Exhale' | 'Rest'>('Inhale');
  const phaseTimerRef = useRef(0);
  const lastPhaseRef = useRef<'Inhale' | 'Hold' | 'Exhale' | 'Rest'>('Inhale');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();
    let cycleTime = 0;

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

    const getPhaseAndProgress = (t: number) => {
      // Durations based on cadence
      let inhale = 4, hold1 = 7, exhale = 8, hold2 = 0;
      if (cadence === 'box') {
        inhale = 4; hold1 = 4; exhale = 4; hold2 = 4;
      } else if (cadence === 'resonance') {
        inhale = 5.5; hold1 = 0; exhale = 5.5; hold2 = 0;
      }

      const total = inhale + hold1 + exhale + hold2;
      const mod = t % total;

      if (mod < inhale) {
        return { phase: 'Inhale' as const, progress: mod / inhale, circleScale: mod / inhale };
      } else if (mod < inhale + hold1) {
        return { phase: 'Hold' as const, progress: (mod - inhale) / hold1, circleScale: 1.0 };
      } else if (mod < inhale + hold1 + exhale) {
        const p = (mod - inhale - hold1) / exhale;
        return { phase: 'Exhale' as const, progress: p, circleScale: 1.0 - p };
      } else {
        return { phase: 'Rest' as const, progress: (mod - inhale - hold1 - exhale) / hold2, circleScale: 0.0 };
      }
    };

    const render = (time: number) => {
      const dt = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;

      if (!isPaused) {
        cycleTime += dt;
      }

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      const { phase, circleScale } = getPhaseAndProgress(cycleTime);

      if (phase !== lastPhaseRef.current) {
        lastPhaseRef.current = phase;
        setCurrentPhase(phase);
        if (phase === 'Inhale') audioEngine.playChime('breath-in');
      }

      // Warm surface background
      ctx.fillStyle = '#F8F7F4';
      ctx.fillRect(0, 0, width, height);

      const alphaVal = eegData?.bands.alpha || 10.0;
      const alphaNorm = Math.max(0.3, Math.min(1.2, alphaVal / 12.0));

      // Draw Weave Threads (Sinusoidal Harmonic Tapestry)
      const threadCount = Math.floor(18 * alphaNorm);
      for (let i = 0; i < threadCount; i++) {
        ctx.beginPath();
        const yOffset = (height / (threadCount + 1)) * (i + 1);
        const freq = 0.008 + (i % 3) * 0.003;
        const amp = (18 + (i % 4) * 8) * alphaNorm;
        const speed = (i % 2 === 0 ? 1 : -1) * (0.8 + (i % 3) * 0.3);

        for (let x = 0; x <= width; x += 6) {
          const y = yOffset + Math.sin(x * freq + cycleTime * speed) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        const colors = ['rgba(232, 150, 122, 0.45)', 'rgba(228, 184, 124, 0.45)', 'rgba(123, 104, 174, 0.4)'];
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }

      // Central Breathing Circle / Loom Hub
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const minRadius = 45;
      const maxRadius = 110;
      const currentRadius = minRadius + (maxRadius - minRadius) * circleScale;

      // Outer soft aura
      const auraGrad = ctx.createRadialGradient(centerX, centerY, minRadius * 0.8, centerX, centerY, currentRadius + 30);
      auraGrad.addColorStop(0, 'rgba(232, 150, 122, 0.35)');
      auraGrad.addColorStop(0.7, 'rgba(228, 184, 124, 0.15)');
      auraGrad.addColorStop(1, 'rgba(248, 247, 244, 0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius + 30, 0, Math.PI * 2);
      ctx.fill();

      // Main Breathing Ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#E8967A';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // Inner Core Circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 212, 199, 0.6)';
      ctx.fill();

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [eegData, cadence, isPaused]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--text-primary)', fontWeight: 600 }}>
          {currentPhase}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {cadence.toUpperCase()} Breath
        </div>
      </div>
    </div>
  );
};
