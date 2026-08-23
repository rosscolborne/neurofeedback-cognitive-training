import React, { useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';

interface SkylineDriftProps {
  eegData: EEGDataPoint | null;
  biome?: string;
  isPaused?: boolean;
}

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  biome = 'Alpine Meadows',
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gliderPosRef = useRef({ y: 0.5, targetY: 0.5, pitch: 0, roll: 0 });
  const speedRef = useRef(1.0);
  const offsetRef = useRef(0);
  const particlesRef = useRef<Array<{ x: number; y: number; z: number; size: number }>>([]);

  useEffect(() => {
    // Initialize 3D cloud & air particles
    particlesRef.current = Array.from({ length: 45 }, () => ({
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 400,
      z: Math.random() * 800 + 100,
      size: Math.random() * 2.5 + 1,
    }));
  }, []);

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

      // Calculate target glider altitude based on Theta/Beta ratio & inZone
      if (eegData) {
        // Lower Theta/Beta ratio = higher altitude (0.1 = top sky, 0.9 = near valley)
        const tbr = eegData.thetaBetaRatio;
        // TBR of 1.2 = high flight (0.2), TBR of 2.8 = low flight (0.8)
        const target = Math.max(0.15, Math.min(0.85, (tbr - 1.0) / 2.0));
        gliderPosRef.current.targetY = target;
        
        // Speed responds to inZone
        const targetSpeed = eegData.inZone ? 1.4 : 0.7;
        speedRef.current += (targetSpeed - speedRef.current) * 0.05;
      }

      if (!isPaused) {
        const g = gliderPosRef.current;
        g.y += (g.targetY - g.y) * 0.04;
        g.pitch = (g.targetY - g.y) * 1.5;
        offsetRef.current += dt * 60 * speedRef.current;
      }

      // Background Sky Gradient (Warm Coral / Sunset Gold for Alpine Meadows)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      if (biome === 'Sunset Dunes') {
        skyGrad.addColorStop(0, '#E88B68');
        skyGrad.addColorStop(0.5, '#F5C6A5');
        skyGrad.addColorStop(1, '#FAF1E6');
      } else {
        skyGrad.addColorStop(0, '#D4B2A7');
        skyGrad.addColorStop(0.4, '#F5E4D7');
        skyGrad.addColorStop(1, '#FAF7F2');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Distant Mountains (3 procedural parallax layers)
      const layers = [
        { color: '#D4C0B5', speed: 0.1, heightScale: 0.45, yBase: height * 0.55, freq: 0.003 },
        { color: '#BFA89C', speed: 0.25, heightScale: 0.35, yBase: height * 0.68, freq: 0.006 },
        { color: '#A88D7F', speed: 0.5, heightScale: 0.25, yBase: height * 0.82, freq: 0.01 },
      ];

      layers.forEach(layer => {
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 8) {
          const worldX = x + offsetRef.current * layer.speed * 20;
          const hill =
            Math.sin(worldX * layer.freq) * 45 +
            Math.sin(worldX * layer.freq * 2.3) * 20 +
            Math.cos(worldX * layer.freq * 0.5) * 60;
          const y = layer.yBase + hill * layer.heightScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.fillStyle = layer.color;
        ctx.fill();
      });

      // River / Valley at base
      const riverY = height * 0.92;
      ctx.fillStyle = 'rgba(232, 150, 122, 0.4)';
      ctx.beginPath();
      ctx.ellipse(width * 0.5, riverY, width * 0.6, height * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floating 3D Air stream particles
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      particlesRef.current.forEach(p => {
        if (!isPaused) {
          p.z -= dt * 220 * speedRef.current;
          if (p.z <= 10) {
            p.z = 800;
            p.x = (Math.random() - 0.5) * 800;
            p.y = (Math.random() - 0.5) * 400;
          }
        }
        const fov = 350;
        const scale = fov / (fov + p.z);
        const projX = width * 0.5 + p.x * scale;
        const projY = height * 0.45 + p.y * scale;

        if (projX >= 0 && projX <= width && projY >= 0 && projY <= height) {
          ctx.beginPath();
          ctx.arc(projX, projY, p.size * scale * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Glider (Paper Plane / Minimalist Aerodynamic Craft)
      const gliderScreenX = width * 0.5;
      const gliderScreenY = height * (0.2 + gliderPosRef.current.y * 0.55);
      const pitch = gliderPosRef.current.pitch;

      ctx.save();
      ctx.translate(gliderScreenX, gliderScreenY);
      ctx.rotate(pitch * 0.4);

      // Glider body in warm coral with ambient light
      ctx.beginPath();
      ctx.moveTo(32, 0);       // Nose
      ctx.lineTo(-24, -18);   // Left wingtip
      ctx.lineTo(-14, 0);     // Fuselage fold
      ctx.lineTo(-24, 18);    // Right wingtip
      ctx.closePath();
      
      const craftGrad = ctx.createLinearGradient(-24, -18, 32, 18);
      craftGrad.addColorStop(0, '#FFFFFF');
      craftGrad.addColorStop(0.5, '#F5D4C7');
      craftGrad.addColorStop(1, '#E8967A');
      ctx.fillStyle = craftGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 122, 98, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Wing crease
      ctx.beginPath();
      ctx.moveTo(32, 0);
      ctx.lineTo(-14, 0);
      ctx.strokeStyle = 'rgba(122, 72, 56, 0.4)';
      ctx.stroke();

      // Trailing wingtip vapor trails
      if (eegData?.inZone) {
        ctx.beginPath();
        ctx.moveTo(-24, -18);
        ctx.lineTo(-55, -20);
        ctx.moveTo(-24, 18);
        ctx.lineTo(-55, 20);
        ctx.strokeStyle = 'rgba(232, 150, 122, 0.7)';
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }

      ctx.restore();

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [eegData, biome, isPaused]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(4px)',
          padding: '4px 12px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        Biome: {biome}
      </div>
    </div>
  );
};
