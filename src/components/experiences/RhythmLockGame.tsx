import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Music, Zap, Sparkles } from 'lucide-react';

interface RhythmLockProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

export const RhythmLockGame: React.FC<RhythmLockProps> = ({ eegData, isPaused = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const audioStartedRef = useRef(false);
  const tapRipplesRef = useRef<Array<{ x: number; y: number; r: number; alpha: number }>>([]);

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

  const handleTap = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    tapRipplesRef.current.push({ x, y, r: 10, alpha: 1.0 });

    const inZone = eegData?.inZone ?? true;
    const points = inZone ? 25 : 10;
    setScore(s => s + points);
    setFeedbackText(inZone ? '✨ PERFECT SYNC (+25)' : '🎵 HARMONIC LOCK (+10)');
    audioEngine.playChime('success');

    setTimeout(() => setFeedbackText(null), 1200);
  };

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

      // Background Canvas
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#FAF8F5');
      bgGrad.addColorStop(1, '#EDE7DF');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Concentric rhythmic orbital rings
      const rings = [
        { radius: 55, speed: 1.4, color: '#E8967A', dots: 4 },
        { radius: 95, speed: -0.9, color: '#E4B87C', dots: 6 },
        { radius: 140, speed: 0.6, color: '#7B68AE', dots: 8 },
        { radius: 185, speed: -0.4, color: '#5C8C46', dots: 12 },
      ];

      rings.forEach((ring, idx) => {
        // Draw orbital track
        ctx.beginPath();
        ctx.arc(centerX, centerY, ring.radius, 0, Math.PI * 2);
        ctx.strokeStyle = inZone ? 'rgba(232, 150, 122, 0.35)' : 'rgba(200, 190, 180, 0.2)';
        ctx.lineWidth = inZone ? 2.5 : 1.5;
        ctx.stroke();

        // Orbital resonance nodes
        for (let d = 0; d < ring.dots; d++) {
          const angle = (d * (Math.PI * 2)) / ring.dots + timeElapsed * ring.speed;
          const nodeX = centerX + Math.cos(angle) * ring.radius;
          const nodeY = centerY + Math.sin(angle) * ring.radius;

          ctx.beginPath();
          const nodeRadius = inZone ? 5.5 + Math.sin(timeElapsed * 3 + d) * 2 : 3.5;
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
            ctx.strokeStyle = 'rgba(232, 150, 122, 0.22)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }
      });

      // Interactive Tap Ripples
      tapRipplesRef.current.forEach(r => {
        if (!isPaused) {
          r.r += dt * 140;
          r.alpha -= dt * 2.2;
        }
        if (r.alpha > 0) {
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(232, 150, 122, ${r.alpha})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      });
      tapRipplesRef.current = tapRipplesRef.current.filter(r => r.alpha > 0);

      // Center Pulse Crystal
      const pulseRadius = 26 + (inZone ? Math.sin(timeElapsed * 4) * 8 * focusRatio : 0);
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
    <div
      onClick={handleTap}
      onTouchStart={handleTap}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      
      {/* Top Header Badge */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '13px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Music size={14} color="var(--brand-primary)" />
          <span>Resonance: {score}</span>
        </div>

        {feedbackText && (
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
            <Sparkles size={13} />
            <span>{feedbackText}</span>
          </div>
        )}
      </div>

      {/* Tap Instruction Prompt at bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(6px)',
          padding: '5px 16px',
          borderRadius: 'var(--radius-full)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)',
          pointerEvents: 'none',
        }}
      >
        Tap screen to align with harmonic orbit
      </div>
    </div>
  );
};
