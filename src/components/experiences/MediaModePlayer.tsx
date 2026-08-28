import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Link, Video, Sparkles, Eye, Waves, Compass, Moon, Sun } from 'lucide-react';

interface MediaModeProps {
  eegData: EEGDataPoint | null;
  isPaused?: boolean;
}

interface StreamTheme {
  id: string;
  title: string;
  category: string;
  targetBand: string;
  vibe: string;
  icon: any;
  customVideoUrl?: string;
  renderCanvas: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    zoneScore: number,
    alpha: number,
    theta: number,
    beta: number
  ) => void;
}

const STREAM_THEMES: StreamTheme[] = [
  {
    id: 'alpine-wilderness',
    title: 'Alpine Sunrise & Cloudscape (4K)',
    category: 'Nature & Alpha Calm',
    targetBand: 'Alpha (8-12 Hz)',
    vibe: 'Peaceful',
    icon: Sun,
    renderCanvas: (ctx, width, height, time, zoneScore, alpha) => {
      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#E88B68');
      sky.addColorStop(0.4, '#F5C6A5');
      sky.addColorStop(0.8, '#FAF1E6');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Distant mountain ranges
      const mountainColors = ['#A86852', '#8C5240', '#5E3426'];
      mountainColors.forEach((color, idx) => {
        ctx.beginPath();
        ctx.moveTo(0, height);
        const yBase = height * (0.55 + idx * 0.12);
        for (let x = 0; x <= width; x += 10) {
          const hill = Math.sin(x * 0.004 + idx * 2.5) * 50 + Math.sin(x * 0.012) * 20;
          ctx.lineTo(x, yBase + hill);
        }
        ctx.lineTo(width, height);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5 + idx * 0.25;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Rolling morning mist clouds modulated by Alpha power
      const mistCount = 6;
      for (let m = 0; m < mistCount; m++) {
        const mistX = ((time * (15 + m * 8) + m * 140) % (width + 300)) - 150;
        const mistY = height * 0.52 + Math.sin(time * 0.4 + m) * 30;
        const mistW = 260 + m * 60;
        const mistH = 60 + m * 20;

        const mistGrad = ctx.createRadialGradient(mistX, mistY, 10, mistX, mistY, mistW * 0.5);
        mistGrad.addColorStop(0, `rgba(255, 255, 255, ${0.45 * (0.5 + 0.5 * zoneScore)})`);
        mistGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = mistGrad;
        ctx.beginPath();
        ctx.ellipse(mistX, mistY, mistW * 0.5, mistH * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Golden sun reflection glow
      const sunGrad = ctx.createRadialGradient(width * 0.5, height * 0.35, 10, width * 0.5, height * 0.35, 160);
      sunGrad.addColorStop(0, `rgba(255, 230, 180, ${0.7 + 0.3 * zoneScore})`);
      sunGrad.addColorStop(0.5, `rgba(232, 150, 122, ${0.35 * zoneScore})`);
      sunGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.35, 160, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'galactic-nebula',
    title: 'Galactic Deep Space Nebula (HD)',
    category: 'Curiosity & Focus',
    targetBand: 'SMR (12-15 Hz)',
    vibe: 'Immersive',
    icon: Compass,
    renderCanvas: (ctx, width, height, time, zoneScore) => {
      // Deep space void
      ctx.fillStyle = '#06060E';
      ctx.fillRect(0, 0, width, height);

      // Swirling nebula dust clouds
      const swirls = [
        { x: width * 0.45, y: height * 0.45, r: 240, color: '#7B3B8C' },
        { x: width * 0.58, y: height * 0.52, r: 200, color: '#4A90D9' },
        { x: width * 0.38, y: height * 0.60, r: 180, color: '#E8967A' },
      ];

      swirls.forEach((swirl, i) => {
        const offsetAngle = time * (0.15 + i * 0.05);
        const curX = swirl.x + Math.cos(offsetAngle) * 45;
        const curY = swirl.y + Math.sin(offsetAngle) * 35;

        const rad = ctx.createRadialGradient(curX, curY, 20, curX, curY, swirl.r * (0.8 + 0.4 * zoneScore));
        rad.addColorStop(0, swirl.color);
        rad.addColorStop(0.6, `${swirl.color}44`);
        rad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = rad;
        ctx.globalAlpha = 0.55 + 0.35 * zoneScore;
        ctx.beginPath();
        ctx.arc(curX, curY, swirl.r * (0.8 + 0.4 * zoneScore), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Shimmering stars
      for (let s = 0; s < 60; s++) {
        const starX = (Math.sin(s * 99 + 1) * 0.5 + 0.5) * width;
        const starY = (Math.cos(s * 33 + 2) * 0.5 + 0.5) * height;
        const twinkle = Math.sin(time * 3 + s) * 0.5 + 0.5;
        const starSize = 1.2 + (s % 3) * 0.8;

        ctx.beginPath();
        ctx.arc(starX, starY, starSize * (0.5 + 0.5 * twinkle), 0, Math.PI * 2);
        ctx.fillStyle = s % 4 === 0 ? '#FFD700' : '#FFFFFF';
        ctx.globalAlpha = 0.4 + 0.6 * twinkle * zoneScore;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    },
  },
  {
    id: 'ocean-bioluminescence',
    title: 'Pacific Ocean Shimmer & Marine Reef',
    category: 'Alpha-Theta Meditation',
    targetBand: 'Alpha-Theta',
    vibe: 'Tranquil',
    icon: Waves,
    renderCanvas: (ctx, width, height, time, zoneScore) => {
      // Emerald / deep turquoise ocean depth
      const ocean = ctx.createLinearGradient(0, 0, 0, height);
      ocean.addColorStop(0, '#0F3A40');
      ocean.addColorStop(0.5, '#144A52');
      ocean.addColorStop(1, '#082025');
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, width, height);

      // Underwater light caustics / sun rays
      for (let ray = 0; ray < 7; ray++) {
        const rayX = width * (0.15 + ray * 0.12) + Math.sin(time * 0.6 + ray) * 30;
        ctx.beginPath();
        ctx.moveTo(rayX, 0);
        ctx.lineTo(rayX + 80, height);
        ctx.lineTo(rayX + 30, height);
        ctx.lineTo(rayX - 30, 0);
        ctx.closePath();

        const rayGrad = ctx.createLinearGradient(rayX, 0, rayX, height);
        rayGrad.addColorStop(0, `rgba(130, 230, 220, ${0.25 * zoneScore})`);
        rayGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = rayGrad;
        ctx.fill();
      }

      // Bioluminescent floating particles
      for (let p = 0; p < 45; p++) {
        const pX = (Math.sin(p * 55 + time * 0.2) * 0.5 + 0.5) * width;
        const pY = (p * 23 + time * 20) % height;
        const pRadius = 2 + (p % 3) * 1.5;

        const pGrad = ctx.createRadialGradient(pX, pY, 0.5, pX, pY, pRadius * 3);
        pGrad.addColorStop(0, '#68D391');
        pGrad.addColorStop(0.5, 'rgba(104, 211, 145, 0.4)');
        pGrad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(pX, pY, pRadius * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'cyberpunk-lofi',
    title: 'Cyberpunk Lo-Fi Rain Cityscape',
    category: 'Beta Downtraining',
    targetBand: 'Beta (15-20 Hz)',
    vibe: 'Focus',
    icon: Moon,
    renderCanvas: (ctx, width, height, time, zoneScore) => {
      // Midnight violet gradient
      const night = ctx.createLinearGradient(0, 0, 0, height);
      night.addColorStop(0, '#120924');
      night.addColorStop(0.6, '#20103A');
      night.addColorStop(1, '#0D0518');
      ctx.fillStyle = night;
      ctx.fillRect(0, 0, width, height);

      // City Skyline silhouettes
      const buildings = 14;
      const bWidth = width / buildings;
      for (let b = 0; b < buildings; b++) {
        const bHeight = 70 + Math.sin(b * 133) * 60 + (b % 3) * 40;
        const bX = b * bWidth;
        const bY = height - bHeight;

        ctx.fillStyle = '#090312';
        ctx.fillRect(bX, bY, bWidth - 2, bHeight);

        // Building neon windows
        for (let wY = bY + 10; wY < height - 10; wY += 16) {
          for (let wX = bX + 4; wX < bX + bWidth - 6; wX += 10) {
            if ((b + wY) % 3 !== 0) {
              ctx.fillStyle = (b + wX) % 2 === 0 ? 'rgba(0, 240, 255, 0.65)' : 'rgba(255, 0, 128, 0.65)';
              ctx.fillRect(wX, wY, 6, 8);
            }
          }
        }
      }

      // Rain streaks
      ctx.strokeStyle = `rgba(180, 200, 255, ${0.35 + 0.35 * (1 - zoneScore)})`;
      ctx.lineWidth = 1.2;
      for (let r = 0; r < 50; r++) {
        const rx = (r * 37 + time * 120) % width;
        const ry = (r * 53 + time * 450) % height;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 8, ry + 22);
        ctx.stroke();
      }

      // Neon synthwave horizon line
      ctx.strokeStyle = '#00F0FF';
      ctx.shadowColor = '#00F0FF';
      ctx.shadowBlur = 12 * zoneScore;
      ctx.beginPath();
      ctx.moveTo(0, height - 2);
      ctx.lineTo(width, height - 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    },
  },
];

export const MediaModePlayer: React.FC<MediaModeProps> = ({ eegData, isPaused = false }) => {
  const [activeTheme, setActiveTheme] = useState(STREAM_THEMES[0]);
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const inZone = eegData?.inZone ?? true;
  const zoneScore = eegData?.zoneScore ?? (inZone ? 1.0 : 0.0);
  const alpha = eegData?.bands.alpha || 10.0;
  const theta = eegData?.bands.theta || 7.0;
  const beta = eegData?.bands.beta || 12.0;

  // 60 FPS Procedural Generative Canvas Engine
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

      // Render the active theme's procedural visual stream
      activeTheme.renderCanvas(ctx, width, height, timeElapsed, zoneScore, alpha, theta, beta);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, [activeTheme, zoneScore, alpha, theta, beta, isPaused]);

  const handleLoadCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;

    setVideoError(false);
    setActiveTheme({
      id: 'custom-' + Date.now(),
      title: 'Custom Stream: ' + customUrl.trim().split('/').pop()?.slice(0, 24),
      category: 'User Custom Media',
      targetBand: 'Custom Protocol',
      vibe: 'Personalized',
      icon: Video,
      customVideoUrl: customUrl.trim(),
      renderCanvas: STREAM_THEMES[0].renderCanvas,
    });
    setShowCustomInput(false);
    setCustomUrl('');
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#0A0A0F',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Visualizer & Video Viewport Layer */}
      <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        {/* Custom Video Element if Custom URL provided */}
        {activeTheme.customVideoUrl && !videoError ? (
          <video
            ref={videoRef}
            key={activeTheme.customVideoUrl}
            src={activeTheme.customVideoUrl}
            autoPlay
            loop
            muted
            playsInline
            crossOrigin="anonymous"
            onError={() => setVideoError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: `brightness(${0.35 + 0.65 * zoneScore}) contrast(${0.85 + 0.2 * zoneScore})`,
              transition: 'filter 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        ) : (
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              filter: `brightness(${0.35 + 0.65 * zoneScore}) contrast(${0.85 + 0.2 * zoneScore})`,
              transition: 'filter 0.8s ease',
            }}
          />
        )}

        {/* Dynamic Neuro Vignette Tunnel (sharpens on high zoneScore) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(circle at center, rgba(0,0,0,0) ${40 + 35 * zoneScore}%, rgba(0,0,0,${0.85 - 0.55 * zoneScore}) 100%)`,
            transition: 'all 0.8s ease',
          }}
        />

        {/* Neural Focus Target Reticle HUD in Center */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.6s ease',
            opacity: inZone ? 0.3 + 0.5 * zoneScore : 0.15,
          }}
        >
          <div
            style={{
              width: `${120 + 35 * (1 - zoneScore)}px`,
              height: `${120 + 35 * (1 - zoneScore)}px`,
              borderRadius: '50%',
              border: `1.5px dashed ${inZone ? 'var(--brand-primary)' : 'rgba(255,255,255,0.4)'}`,
              boxShadow: inZone ? '0 0 25px rgba(232, 150, 122, 0.4)' : 'none',
              transition: 'all 0.6s ease',
            }}
          />
        </div>

        {/* Gentle Neuro-Dimming Banner when brain drifts */}
        {zoneScore < 0.35 && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'rgba(18, 20, 28, 0.88)',
              color: '#FFFFFF',
              padding: '12px 24px',
              borderRadius: 'var(--radius-xl)',
              fontSize: '13px',
              fontWeight: 600,
              backdropFilter: 'blur(10px)',
              pointerEvents: 'none',
              border: '1px solid rgba(232, 150, 122, 0.4)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Sparkles size={16} color="var(--brand-primary)" />
            <span>Refocus attention gently to restore full stream clarity</span>
          </div>
        )}

        {/* Top-Right Real-Time Neuro HUD Tag */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            backgroundColor: 'rgba(10, 10, 15, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFF',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: inZone ? '#68D391' : '#F6AD55',
              boxShadow: inZone ? '0 0 10px #68D391' : 'none',
              transition: 'background-color 0.4s ease',
            }}
          />
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em' }}>
            {inZone ? `IN-ZONE (${Math.round(zoneScore * 100)}%)` : 'ATTENTION DRIFT'}
          </span>
        </div>

        {/* Top-Left Stream Category Tag */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            backgroundColor: 'rgba(10, 10, 15, 0.75)',
            backdropFilter: 'blur(8px)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#FFF',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <Video size={13} color="var(--brand-primary)" />
          <span style={{ fontSize: '11px', fontWeight: 600 }}>{activeTheme.category}</span>
        </div>
      </div>

      {/* Stream Selector Strip */}
      <div
        style={{
          padding: '10px 16px',
          backgroundColor: '#161822',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye size={15} color="var(--brand-primary)" />
          <span style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 600 }}>
            {activeTheme.title}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {STREAM_THEMES.map((theme, idx) => {
            const Icon = theme.icon;
            const isSelected = activeTheme.id === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  setVideoError(false);
                  setActiveTheme(theme);
                }}
                style={{
                  backgroundColor: isSelected ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '5px 10px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={12} />
                <span>Stream {idx + 1}</span>
              </button>
            );
          })}
          <button
            onClick={() => setShowCustomInput(!showCustomInput)}
            style={{
              backgroundColor: showCustomInput ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '5px 10px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Link size={12} /> Custom URL
          </button>
        </div>
      </div>

      {/* Custom Stream Form */}
      {showCustomInput && (
        <form
          onSubmit={handleLoadCustom}
          style={{
            padding: '10px 16px',
            backgroundColor: '#202230',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: '8px',
          }}
        >
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Paste direct MP4/WebM video stream URL..."
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: '#12141F',
              color: '#FFFFFF',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button type="submit" className="btn btn-dense" style={{ fontSize: '11px', padding: '6px 14px' }}>
            Load Video
          </button>
        </form>
      )}
    </div>
  );
};
