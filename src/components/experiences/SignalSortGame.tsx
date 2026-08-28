import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Zap, Sparkles, Target } from 'lucide-react';

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

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

export const SignalSortGame: React.FC<SignalSortProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const orbsRef = useRef<Orb[]>([]);
  const particlesRef = useRef<Particle[]>([]);
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
      const zoneScore = eegData?.zoneScore ?? (inZone ? 1 : 0);
      const smrRatio = Math.max(0.2, Math.min(1.0, (smr - 4) / 8));

      // Background Canvas Gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#FAF8F5');
      bgGrad.addColorStop(1, '#EDE7DF');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Spawn orbs periodically
      if (!isPaused && time > nextSpawnRef.current) {
        nextSpawnRef.current = time + Math.max(500, 1300 - smrRatio * 500);
        const isTarget = Math.random() > 0.45;
        orbsRef.current.push({
          id: ++orbIdRef.current,
          x: Math.random() * (width - 100) + 50,
          y: -20,
          targetX: isTarget ? width * 0.28 : width * 0.72,
          targetY: height - 55,
          radius: isTarget ? 17 : 13,
          color: isTarget ? '#E8967A' : '#7B68AE',
          isTarget,
          collected: false,
        });
      }

      // Draw Gate Baskets at bottom with Magnetic Forcefields
      const basketY = height - 60;
      
      // Target basket (Left: Coral Focus)
      const leftBasketX = width * 0.16;
      const basketW = width * 0.28;
      ctx.fillStyle = inZone ? 'rgba(232, 150, 122, 0.25)' : 'rgba(232, 150, 122, 0.12)';
      ctx.strokeStyle = '#E8967A';
      ctx.lineWidth = inZone ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(leftBasketX, basketY - 24, basketW, 52, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#C46D4E';
      ctx.font = '700 12px "DM Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎯 SMR Focus Gateway', leftBasketX + basketW / 2, basketY + 6);

      // Distractor basket (Right: Lavender Filter)
      const rightBasketX = width * 0.56;
      ctx.fillStyle = 'rgba(123, 104, 174, 0.15)';
      ctx.strokeStyle = '#7B68AE';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(rightBasketX, basketY - 24, basketW, 52, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#65539E';
      ctx.fillText('🛡️ Filtered Noise', rightBasketX + basketW / 2, basketY + 6);

      // Update and draw orbs
      orbsRef.current.forEach(orb => {
        if (!isPaused && !orb.collected) {
          // Higher SMR = steadier trajectory
          const speed = 150 - smrRatio * 65;
          orb.y += dt * speed;

          // Magnetic attraction into the correct sorting basket scales with zoneScore
          if (zoneScore > 0) {
            orb.x += (orb.targetX - orb.x) * (dt * 4.2 * zoneScore);
          }

          // Check if reached basket
          if (orb.y >= basketY) {
            orb.collected = true;
            const distance = Math.abs(orb.x - orb.targetX);
            if (distance < 55) {
              setScore(s => s + (orb.isTarget ? 20 : 10));
              setCombo(c => c + 1);
              audioEngine.playChime('success');

              // Burst celebratory particles
              for (let p = 0; p < 12; p++) {
                particlesRef.current.push({
                  x: orb.x,
                  y: orb.y,
                  vx: (Math.random() - 0.5) * 160,
                  vy: (Math.random() - 0.5) * 160 - 50,
                  color: orb.color,
                  life: 1.0,
                });
              }
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

          if (orb.isTarget && zoneScore > 0.4) {
            // Glowing aura on target shapes during high SMR stillness
            ctx.strokeStyle = `rgba(232, 150, 122, ${0.7 * zoneScore})`;
            ctx.lineWidth = 4;
            ctx.stroke();
          }
        }
      });

      // Update and render burst particles
      particlesRef.current.forEach(p => {
        if (!isPaused) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 2.2;
        }
        if (p.life > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      });

      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
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
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 700,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <Target size={14} color="var(--brand-primary)" />
          <span>Score: {score}</span>
        </div>
        {combo > 2 && (
          <div
            style={{
              background: 'var(--status-active-bg)',
              color: 'var(--status-active)',
              padding: '5px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Zap size={14} />
            <span>{combo}x Streak!</span>
          </div>
        )}
      </div>
    </div>
  );
};
