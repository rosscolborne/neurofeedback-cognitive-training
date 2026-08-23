import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface SignalSortProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

interface Orb {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  radius: number;
  color: string;
  isTarget: boolean;
  collected: boolean;
}

export const SignalSortGame: React.FC<SignalSortProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const orbsRef = useRef<Orb[]>([]);
  const nextSpawnRef = useRef(0);
  const orbIdRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
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

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      const smr = eegData?.bands.smr || 6.5;
      const inZone = eegData?.inZone ?? false;
      const smrRatio = Math.max(0.2, Math.min(1.0, (smr - 4) / 8));

      // Background
      ctx.fillStyle = '#F8F7F4';
      ctx.fillRect(0, 0, width, height);

      // Spawn orbs periodically
      if (!isPaused && time > nextSpawnRef.current) {
        nextSpawnRef.current = time + Math.max(600, 1500 - smrRatio * 600);
        const isTarget = Math.random() > 0.4;
        orbsRef.current.push({
          id: ++orbIdRef.current,
          x: Math.random() * (width - 80) + 40,
          y: -20,
          targetX: isTarget ? width * 0.3 : width * 0.7,
          targetY: height - 55,
          radius: isTarget ? 16 : 12,
          color: isTarget ? '#E8967A' : '#7B68AE',
          isTarget,
          collected: false,
        });
      }

      // Draw Gate Baskets at bottom
      const basketY = height - 55;
      // Target basket (Left: Coral)
      ctx.fillStyle = 'rgba(232, 150, 122, 0.2)';
      ctx.strokeStyle = '#E8967A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(width * 0.2, basketY - 20, width * 0.25, 45, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#E8967A';
      ctx.font = '600 12px "DM Sans"';
      ctx.textAlign = 'center';
      ctx.fillText('Target Focus', width * 0.325, basketY + 6);

      // Distractor basket (Right: Lavender)
      ctx.fillStyle = 'rgba(123, 104, 174, 0.15)';
      ctx.strokeStyle = '#7B68AE';
      ctx.beginPath();
      ctx.roundRect(width * 0.55, basketY - 20, width * 0.25, 45, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#7B68AE';
      ctx.fillText('Filtered', width * 0.675, basketY + 6);

      // Update and draw orbs
      orbsRef.current.forEach(orb => {
        if (!isPaused && !orb.collected) {
          // Falling speed influenced by stillness (higher SMR = smoother guided trajectory)
          const speed = 100 + smrRatio * 60;
          orb.y += dt * speed;

          // Magnetic pull into the correct sorting basket when brain is in SMR zone
          if (inZone) {
            orb.x += (orb.targetX - orb.x) * (dt * 3.5);
          }

          // Check if reached basket
          if (orb.y >= basketY) {
            orb.collected = true;
            const distance = Math.abs(orb.x - orb.targetX);
            if (distance < 50) {
              setScore(s => s + (orb.isTarget ? 15 : 5));
              setCombo(c => c + 1);
              audioEngine.playChime('success');
            } else {
              setCombo(0);
            }
          }
        }

        if (!orb.collected) {
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
          ctx.fillStyle = orb.color;
          ctx.fill();

          if (orb.isTarget && inZone) {
            // Glowing aura on target shapes during high SMR stillness
            ctx.strokeStyle = 'rgba(232, 150, 122, 0.6)';
            ctx.lineWidth = 4;
            ctx.stroke();
          }
        }
      });

      // Filter out collected/out-of-bounds orbs
      orbsRef.current = orbsRef.current.filter(o => !o.collected && o.y < height + 40);

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
          top: 14,
          left: 14,
          display: 'flex',
          gap: '8px',
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '4px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 600,
            border: '1px solid var(--border-subtle)',
          }}
        >
          Score: <span className="font-mono" style={{ color: 'var(--brand-primary)' }}>{score}</span>
        </div>
        {combo > 2 && (
          <div
            style={{
              background: 'var(--status-active-bg)',
              color: 'var(--status-active)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            {combo}x Stillness Streak
          </div>
        )}
      </div>
    </div>
  );
};
