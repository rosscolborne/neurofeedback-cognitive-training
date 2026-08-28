import React, { useEffect, useRef, useState } from 'react';
import { EEGDataPoint } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { Compass, Sparkles, Wind } from 'lucide-react';

interface SkylineDriftProps {
  eegData: EEGDataPoint | null;
  biome?: string;
  isPaused?: boolean;
}

const BIOMES = [
  { id: 'Alpine Meadows', label: 'Alpine Meadows', skyTop: '#D4B2A7', skyMid: '#F5E4D7', skyBot: '#FAF7F2', mountain: '#A88D7F' },
  { id: 'Sunset Canyon', label: 'Sunset Canyon', skyTop: '#E88B68', skyMid: '#F5C6A5', skyBot: '#FAF1E6', mountain: '#C46D4E' },
  { id: 'Cyber Neon', label: 'Cyber Synthwave', skyTop: '#2C1B4D', skyMid: '#7B3B8C', skyBot: '#1A0B2E', mountain: '#0D0221' },
  { id: 'Arctic Aurora', label: 'Arctic Aurora', skyTop: '#0D2B45', skyMid: '#203C56', skyBot: '#544E68', mountain: '#305252' },
];

export const SkylineDriftCanvas: React.FC<SkylineDriftProps> = ({
  eegData,
  biome: initialBiome = 'Alpine Meadows',
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeBiome, setActiveBiome] = useState(initialBiome);
  const [ringsPassed, setRingsPassed] = useState(0);
  const gliderPosRef = useRef({ y: 0.5, targetY: 0.5, pitch: 0, roll: 0 });
  const speedRef = useRef(1.0);
  const offsetRef = useRef(0);
  const particlesRef = useRef<Array<{ x: number; y: number; z: number; size: number }>>([]);
  const ringsRef = useRef<Array<{ z: number; y: number; passed: boolean; radius: number }>>([]);

  useEffect(() => {
    // Initialize 3D cloud & air particles
    particlesRef.current = Array.from({ length: 50 }, () => ({
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 400,
      z: Math.random() * 800 + 100,
      size: Math.random() * 2.5 + 1.2,
    }));

    // Initialize altitude ring checkpoints in 3D
    ringsRef.current = Array.from({ length: 6 }, (_, i) => ({
      z: 300 + i * 280,
      y: 0.3 + Math.sin(i * 1.2) * 0.25,
      passed: false,
      radius: 42,
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

    const currentTheme = BIOMES.find(b => b.id === activeBiome) || BIOMES[0];

    const render = (time: number) => {
      const dt = Math.min(0.1, (time - lastTime) / 1000);
      lastTime = time;

      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;

      // Calculate target glider altitude based on Theta/Beta ratio & inZone
      if (eegData) {
        const tbr = eegData.thetaBetaRatio;
        // TBR of 1.1 = high soaring altitude (0.2), TBR of 2.8 = low valley (0.8)
        const target = Math.max(0.18, Math.min(0.82, (tbr - 1.0) / 2.2));
        gliderPosRef.current.targetY += (target - gliderPosRef.current.targetY) * 0.06;
        
        // Speed responds continuously to zoneScore
        const zoneScore = eegData.zoneScore ?? (eegData.inZone ? 1.0 : 0.0);
        const targetSpeed = 0.8 + 0.9 * zoneScore;
        speedRef.current += (targetSpeed - speedRef.current) * 0.06;
      }

      if (!isPaused) {
        const g = gliderPosRef.current;
        g.y += (g.targetY - g.y) * 0.05;
        g.pitch = (g.targetY - g.y) * 1.8;
        offsetRef.current += dt * 70 * speedRef.current;
      }

      // Background Sky Gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, currentTheme.skyTop);
      skyGrad.addColorStop(0.5, currentTheme.skyMid);
      skyGrad.addColorStop(1, currentTheme.skyBot);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // Distant Procedural Mountains (3 Parallax Layers)
      const layers = [
        { speed: 0.1, heightScale: 0.45, yBase: height * 0.55, freq: 0.003, alpha: 0.4 },
        { speed: 0.25, heightScale: 0.35, yBase: height * 0.68, freq: 0.006, alpha: 0.65 },
        { speed: 0.5, heightScale: 0.25, yBase: height * 0.82, freq: 0.01, alpha: 0.95 },
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
        ctx.fillStyle = currentTheme.mountain;
        ctx.globalAlpha = layer.alpha;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Horizon Glow / River Valley at base
      const riverY = height * 0.92;
      ctx.fillStyle = activeBiome === 'Cyber Neon' ? 'rgba(0, 240, 255, 0.3)' : 'rgba(232, 150, 122, 0.4)';
      ctx.beginPath();
      ctx.ellipse(width * 0.5, riverY, width * 0.65, height * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floating 3D Checkpoint Altitude Rings
      ringsRef.current.forEach(ring => {
        if (!isPaused) {
          ring.z -= dt * 180 * speedRef.current;
          if (ring.z <= 10) {
            ring.z = 1200;
            ring.y = 0.25 + Math.random() * 0.45;
            ring.passed = false;
          }
        }

        const fov = 350;
        const scale = fov / (fov + ring.z);
        const projX = width * 0.5;
        const projY = height * ring.y;
        const projRadius = ring.radius * scale * 2.2;

        if (projRadius > 2 && ring.z > 20) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(projX, projY, projRadius, projRadius * 0.4, 0, 0, Math.PI * 2);
          ctx.strokeStyle = activeBiome === 'Cyber Neon' ? '#00FFFF' : 'rgba(232, 150, 122, 0.7)';
          ctx.lineWidth = 3 * scale;
          ctx.stroke();

          // Check if glider is close enough at crossing point
          const gliderScreenY = height * (0.2 + gliderPosRef.current.y * 0.55);
          if (ring.z < 80 && !ring.passed) {
            const dy = Math.abs(gliderScreenY - projY);
            if (dy < 45) {
              ring.passed = true;
              setRingsPassed(r => r + 1);
              audioEngine.playChime('success');
            }
          }
          ctx.restore();
        }
      });

      // Floating 3D Stream Particles
      ctx.fillStyle = activeBiome === 'Cyber Neon' ? '#FF007F' : 'rgba(255, 255, 255, 0.8)';
      particlesRef.current.forEach(p => {
        if (!isPaused) {
          p.z -= dt * 240 * speedRef.current;
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

      // Glider body with smooth lighting
      ctx.beginPath();
      ctx.moveTo(34, 0);       // Nose
      ctx.lineTo(-24, -19);   // Left wingtip
      ctx.lineTo(-14, 0);     // Fuselage fold
      ctx.lineTo(-24, 19);    // Right wingtip
      ctx.closePath();
      
      const craftGrad = ctx.createLinearGradient(-24, -19, 34, 19);
      if (activeBiome === 'Cyber Neon') {
        craftGrad.addColorStop(0, '#00FFFF');
        craftGrad.addColorStop(0.6, '#FF007F');
        craftGrad.addColorStop(1, '#7B3B8C');
      } else {
        craftGrad.addColorStop(0, '#FFFFFF');
        craftGrad.addColorStop(0.5, '#F5D4C7');
        craftGrad.addColorStop(1, '#E8967A');
      }
      ctx.fillStyle = craftGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Wing crease
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.lineTo(-14, 0);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.stroke();

      // Trailing wingtip vapor trails
      const zoneScore = eegData?.zoneScore ?? (eegData?.inZone ? 1.0 : 0.0);
      if (zoneScore > 0.1) {
        ctx.beginPath();
        ctx.moveTo(-24, -19);
        ctx.lineTo(-65, -21);
        ctx.moveTo(-24, 19);
        ctx.lineTo(-65, 21);
        ctx.strokeStyle = activeBiome === 'Cyber Neon' ? `rgba(0, 255, 255, ${0.8 * zoneScore})` : `rgba(232, 150, 122, ${0.8 * zoneScore})`;
        ctx.lineWidth = 2.5;
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
  }, [eegData, activeBiome, isPaused]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      
      {/* Top Left Biome & Rings Badge */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(6px)',
            padding: '5px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <Compass size={14} color="var(--brand-primary)" />
          <span>{activeBiome}</span>
        </div>

        {ringsPassed > 0 && (
          <div
            style={{
              background: 'var(--status-active-bg)',
              color: 'var(--status-active)',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={13} />
            <span>{ringsPassed} Rings Cleared</span>
          </div>
        )}
      </div>

      {/* Bottom Biome Switcher Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          display: 'flex',
          gap: '4px',
          background: 'rgba(0, 0, 0, 0.45)',
          padding: '4px',
          borderRadius: 'var(--radius-md)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {BIOMES.map(b => (
          <button
            key={b.id}
            onClick={() => setActiveBiome(b.id)}
            style={{
              background: activeBiome === b.id ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {b.label.split(' ')[0]}
          </button>
        ))}
      </div>
    </div>
  );
};
