import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Target, CheckCircle2, Shield } from 'lucide-react';

interface SignalSortProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

interface SignalOrb {
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

interface RippleParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
}

export const SignalSortGame: React.FC<SignalSortProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const orbsRef = useRef<SignalOrb[]>([]);
  const ripplesRef = useRef<RippleParticle[]>([]);
  const nextSpawnRef = useRef(0);
  const orbIdRef = useRef(0);

  const smr = eegData?.bands.smr ?? 6.5;
  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);

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
      const dt = Math.min(0.08, (time - lastTime) / 1000);
      lastTime = time;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      const smrRatio = Math.max(0.2, Math.min(1.0, (smr - 4) / 8));

      // 1. Soothing Minimalist Matte Ivory Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#FAF8F5');
      bgGrad.addColorStop(1, '#F3EFEA');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Subtle Grid Alignment Guide Lines
      ctx.strokeStyle = 'rgba(215, 205, 195, 0.4)';
      ctx.lineWidth = 1;
      const colWidth = width / 4;
      for (let c = 1; c < 4; c++) {
        ctx.beginPath();
        ctx.moveTo(c * colWidth, 0);
        ctx.lineTo(c * colWidth, height);
        ctx.stroke();
      }

      // 3. Spawn subtle signal orbs
      if (!isPaused && time > nextSpawnRef.current) {
        nextSpawnRef.current = time + Math.max(700, 1600 - smrRatio * 600);
        const isTarget = Math.random() > 0.4;
        orbsRef.current.push({
          id: ++orbIdRef.current,
          x: Math.random() * (width - 120) + 60,
          y: -20,
          targetX: isTarget ? width * 0.3 : width * 0.7,
          targetY: height - 60,
          radius: isTarget ? 14 : 11,
          color: isTarget ? '#D97757' : '#7A6B8E', // Terracotta Target & Slate Violet Distractor
          isTarget,
          collected: false,
        });
      }

      // 4. Draw Sorting Gates at Bottom
      const gateY = height - 65;
      const gateWidth = width * 0.32;

      // Gate 1: SMR Focus Channel (Left)
      const leftGateX = width * 0.14;
      ctx.fillStyle = inZone ? 'rgba(217, 119, 87, 0.12)' : 'rgba(217, 119, 87, 0.05)';
      ctx.strokeStyle = inZone ? '#D97757' : 'rgba(217, 119, 87, 0.4)';
      ctx.lineWidth = inZone ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(leftGateX, gateY - 20, gateWidth, 48, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#A35338';
      ctx.font = '600 12px "DM Sans", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Target Signal (SMR)', leftGateX + gateWidth / 2, gateY + 7);

      // Gate 2: Secondary Channel (Right)
      const rightGateX = width * 0.54;
      ctx.fillStyle = 'rgba(122, 107, 142, 0.06)';
      ctx.strokeStyle = 'rgba(122, 107, 142, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(rightGateX, gateY - 20, gateWidth, 48, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#635377';
      ctx.fillText('Filtered Noise', rightGateX + gateWidth / 2, gateY + 7);

      // 5. Update and render falling orbs with calm magnetic convergence
      orbsRef.current.forEach((orb) => {
        if (!isPaused && !orb.collected) {
          const speed = 120 - smrRatio * 45;
          orb.y += dt * speed;

          // Gentle magnetic guidance scaling with sustained stillness
          if (zoneScore > 0) {
            orb.x += (orb.targetX - orb.x) * (dt * 3.6 * zoneScore);
          }

          // Check gate arrival
          if (orb.y >= gateY) {
            orb.collected = true;
            const distance = Math.abs(orb.x - orb.targetX);
            if (distance < 50) {
              setScore((s) => s + (orb.isTarget ? 20 : 10));
              setStreak((st) => st + 1);
              audioEngine.playChime('success');

              // Soft ripple
              ripplesRef.current.push({
                x: orb.x,
                y: orb.y,
                radius: 12,
                alpha: 0.6,
                color: orb.color,
              });
            } else {
              setStreak(0);
            }
          }
        }

        if (!orb.collected) {
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
          ctx.fillStyle = orb.color;
          ctx.fill();

          if (orb.isTarget && inZone) {
            ctx.strokeStyle = 'rgba(217, 119, 87, 0.4)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        }
      });

      // 6. Draw soft ripples on collection
      ripplesRef.current.forEach((rip) => {
        rip.radius += dt * 30;
        rip.alpha -= dt * 1.2;

        if (rip.alpha > 0) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.radius, 0, Math.PI * 2);
          ctx.strokeStyle = rip.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = rip.alpha;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }
      });

      ripplesRef.current = ripplesRef.current.filter((r) => r.alpha > 0);
      orbsRef.current = orbsRef.current.filter((o) => !o.collected && o.y < height + 40);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [smr, inZone, zoneScore, isPaused]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
        fontFamily: 'var(--font-body)',
        userSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {/* Top Clinical Score & Stillness HUD */}
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
            background: 'rgba(255, 255, 255, 0.92)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}
        >
          <Target size={13} color="var(--brand-primary)" />
          <span>Score: {score}</span>
        </div>

        {streak > 2 && (
          <div
            style={{
              background: 'var(--status-active-bg)',
              color: 'var(--status-active)',
              padding: '5px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              border: '1px solid rgba(16, 185, 129, 0.2)',
            }}
          >
            <CheckCircle2 size={13} />
            <span>{streak} Focus Streak</span>
          </div>
        )}
      </div>

      {/* Top-Right Protocol Focus Indicator */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          background: 'rgba(255, 255, 255, 0.92)',
          padding: '5px 12px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
      >
        <Shield size={12} color="var(--brand-primary)" />
        <span>SMR Motor Stillness: {smr.toFixed(1)} µV</span>
      </div>
    </div>
  );
};
