import React, { useState, useEffect, useRef } from 'react';
import { EEGDataPoint } from '../../types';
import { Sparkles, Camera, RotateCcw, Palette } from 'lucide-react';

interface GenerativeArtProps {
  eegData: EEGDataPoint | null;
}

interface PaletteTheme {
  id: string;
  name: string;
  bg: string;
  strokeAlpha: string; // Used when Alpha is high (Calm)
  strokeSMR: string;   // Used when SMR is high (Stillness)
  strokeCoherence: string; // Used when Coherence is high (Harmony)
  accent: string;
  dotColor: string;
}

const THERAPEUTIC_PALETTES: PaletteTheme[] = [
  {
    id: 'warm-terracotta',
    name: 'Warm Sunset & Terracotta',
    bg: '#0E0D12',
    strokeAlpha: 'rgba(232, 150, 122, 0.45)', // Soft Terracotta
    strokeSMR: 'rgba(245, 198, 165, 0.40)',   // Warm Sand
    strokeCoherence: 'rgba(255, 235, 180, 0.55)', // Radiant Amber
    accent: '#E8967A',
    dotColor: '#E8967A',
  },
  {
    id: 'sage-tranquility',
    name: 'Sage Garden & Spring Rain',
    bg: '#0A100D',
    strokeAlpha: 'rgba(104, 211, 145, 0.45)', // Soft Sage
    strokeSMR: 'rgba(79, 209, 197, 0.40)',    // Pale Eucalyptus
    strokeCoherence: 'rgba(230, 255, 250, 0.55)', // Dew
    accent: '#68D391',
    dotColor: '#68D391',
  },
  {
    id: 'lavender-twilight',
    name: 'Lavender Mist & Dusk',
    bg: '#0F0C15',
    strokeAlpha: 'rgba(159, 122, 234, 0.45)', // Soft Lavender
    strokeSMR: 'rgba(183, 148, 244, 0.40)',   // Pale Violet
    strokeCoherence: 'rgba(254, 215, 226, 0.55)', // Rose Glow
    accent: '#9F7AEA',
    dotColor: '#9F7AEA',
  },
  {
    id: 'ocean-whisper',
    name: 'Quiet Ocean & Seafoam',
    bg: '#080E14',
    strokeAlpha: 'rgba(74, 144, 217, 0.45)',  // Slate Blue
    strokeSMR: 'rgba(129, 230, 217, 0.40)',   // Seafoam
    strokeCoherence: 'rgba(226, 232, 240, 0.55)', // Pearl
    accent: '#4A90D9',
    dotColor: '#4A90D9',
  },
];

export const GenerativeWebXRCanvas: React.FC<GenerativeArtProps> = ({ eegData }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activePalette, setActivePalette] = useState<PaletteTheme>(THERAPEUTIC_PALETTES[0]);
  const [snapshotSaved, setSnapshotSaved] = useState(false);

  // Store latest EEG data in a ref so the render loop doesn't re-trigger React mounts or resize
  const eegRef = useRef<EEGDataPoint | null>(eegData);
  useEffect(() => {
    eegRef.current = eegData;
  }, [eegData]);

  // Keep active palette ref updated for the persistent render loop
  const paletteRef = useRef<PaletteTheme>(activePalette);
  useEffect(() => {
    paletteRef.current = activePalette;
  }, [activePalette]);

  // Persistent brush state driven entirely by user's EEG metrics
  const brushStateRef = useRef({
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    angle: 0,
    speed: 40,
    smoothAlpha: 10,
    smoothSMR: 6.5,
    smoothBeta: 12,
    smoothTheta: 6,
    smoothCoherence: 75,
    smoothZoneScore: 0.5,
    time: 0,
    pointsDrawn: 0,
  });

  // Handle Snapshot
  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSnapshotSaved(true);
    setTimeout(() => setSnapshotSaved(false), 1600);

    const imageUri = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `neural-eeg-art-${Date.now()}.png`;
    link.href = imageUri;
    link.click();
  };

  // Handle Clear & Reset
  const handleReset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = paletteRef.current.bg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    brushStateRef.current.pointsDrawn = 0;
  };

  // Handle Palette Switch (clears background to new palette color)
  const handleSelectPalette = (theme: PaletteTheme) => {
    setActivePalette(theme);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, rect.width, rect.height);
  };

  // MAIN STABLE RENDER LOOP (Runs once on mount, NEVER resets canvas buffer on EEG ticks)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let lastTime = performance.now();

    // 1. Single Resize Handler — only resizes on actual window changes
    const setupCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      
      // Only resize buffer if actual dimensions changed to prevent clearing canvas
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        // Fill initial solid dark background
        ctx.fillStyle = paletteRef.current.bg;
        ctx.fillRect(0, 0, rect.width, rect.height);

        // Center the starting brush position
        brushStateRef.current.x = rect.width * 0.5;
        brushStateRef.current.y = rect.height * 0.5;
        brushStateRef.current.prevX = rect.width * 0.5;
        brushStateRef.current.prevY = rect.height * 0.5;
      }
    };

    setupCanvas();
    window.addEventListener('resize', setupCanvas);

    // 2. Smooth, Progressive EEG Painting Loop (Zero canvas clearing, zero strobing)
    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      const b = brushStateRef.current;
      b.time += dt;

      // Extract real user EEG data (or fallback to gentle resting values)
      const currentEeg = eegRef.current;
      const rawAlpha = currentEeg?.bands.alpha ?? 10.0;
      const rawSMR = currentEeg?.bands.smr ?? 6.5;
      const rawBeta = currentEeg?.bands.beta ?? 12.0;
      const rawTheta = currentEeg?.bands.theta ?? 6.0;
      const rawCoherence = currentEeg?.coherence ?? 75.0;
      const inZone = currentEeg?.inZone ?? true;
      const rawZoneScore = currentEeg?.zoneScore ?? (inZone ? 1.0 : 0.2);

      // Ultra-gentle exponential smoothing (smoothing constant ~2.5 seconds)
      b.smoothAlpha += (rawAlpha - b.smoothAlpha) * (dt * 1.2);
      b.smoothSMR += (rawSMR - b.smoothSMR) * (dt * 1.2);
      b.smoothBeta += (rawBeta - b.smoothBeta) * (dt * 1.2);
      b.smoothTheta += (rawTheta - b.smoothTheta) * (dt * 1.2);
      b.smoothCoherence += (rawCoherence - b.smoothCoherence) * (dt * 1.2);
      b.smoothZoneScore += (rawZoneScore - b.smoothZoneScore) * (dt * 1.2);

      // --- Pure EEG Mathematical Vector Field ---
      // 1. Curvature & Angular Velocity:
      //    Alpha promotes smooth, harmonic, gentle curves.
      //    Theta adds subtle wandering spirals.
      //    Beta adds sharp directional clarity.
      const thetaRatio = b.smoothTheta / Math.max(1, b.smoothBeta);
      const alphaInfluence = Math.sin(b.time * 0.4) * (b.smoothAlpha / 18);
      const thetaWander = Math.cos(b.time * 0.25) * thetaRatio * 0.6;
      const angularSpeed = (alphaInfluence + thetaWander) * 0.85;

      b.angle += angularSpeed * dt;

      // 2. Linear Speed & Step:
      //    In-Zone calmness allows smooth, graceful, steady stroke progression.
      const speed = 25 + b.smoothZoneScore * 35; // 25 to 60 px/sec (calm & unhurried)
      b.prevX = b.x;
      b.prevY = b.y;

      b.x += Math.cos(b.angle) * speed * dt;
      b.y += Math.sin(b.angle) * speed * dt;

      // 3. Soft Gravitational Pull toward canvas center (prevents drifting off-screen)
      const distFromCenter = Math.hypot(b.x - centerX, b.y - centerY);
      const maxRadius = Math.min(width, height) * 0.42;
      if (distFromCenter > maxRadius) {
        const pullAngle = Math.atan2(centerY - b.y, centerX - b.x);
        b.x += Math.cos(pullAngle) * (distFromCenter - maxRadius) * (dt * 2.0);
        b.y += Math.sin(pullAngle) * (distFromCenter - maxRadius) * (dt * 2.0);
      }

      // 4. Progressive Painting on Canvas (No clearing = cumulative artwork)
      const pal = paletteRef.current;
      const strokeWidth = 1.5 + (b.smoothAlpha / 15) * 3.5; // 1.5px to 5px based on Alpha calmness
      const coherenceSymmetry = b.smoothCoherence > 70 ? 4 : 2; // 2-fold or 4-fold sacred symmetry

      ctx.save();
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Pick stroke style based on dominant neurofeedback frequency
      let strokeColor = pal.strokeAlpha;
      if (b.smoothSMR > 8.0) {
        strokeColor = pal.strokeSMR;
      } else if (b.smoothCoherence > 80.0) {
        strokeColor = pal.strokeCoherence;
      }
      ctx.strokeStyle = strokeColor;

      // Paint symmetric harmonic silk trails mapped from center
      for (let s = 0; s < coherenceSymmetry; s++) {
        const rotAngle = (s * (Math.PI * 2)) / coherenceSymmetry;
        
        // Transform coordinates relative to center
        const dx1 = b.prevX - centerX;
        const dy1 = b.prevY - centerY;
        const dx2 = b.x - centerX;
        const dy2 = b.y - centerY;

        const rx1 = centerX + (dx1 * Math.cos(rotAngle) - dy1 * Math.sin(rotAngle));
        const ry1 = centerY + (dx1 * Math.sin(rotAngle) + dy1 * Math.cos(rotAngle));
        const rx2 = centerX + (dx2 * Math.cos(rotAngle) - dy2 * Math.sin(rotAngle));
        const ry2 = centerY + (dx2 * Math.sin(rotAngle) + dy2 * Math.cos(rotAngle));

        ctx.beginPath();
        ctx.moveTo(rx1, ry1);
        ctx.lineTo(rx2, ry2);
        ctx.stroke();
      }

      // If in high SMR stillness, deposit occasional delicate stardust motes
      if (b.smoothSMR > 7.5 && Math.random() < 0.3) {
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      b.pointsDrawn++;

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', setupCanvas);
    };
  }, []); // Empty dependency array ensures canvas buffer is NEVER wiped during session!

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: activePalette.bg,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
    >
      {/* Top Clinical Header HUD */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          right: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(15, 17, 26, 0.75)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#FFFFFF',
            pointerEvents: 'auto',
          }}
        >
          <Sparkles size={13} color="var(--brand-primary)" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#F0EBE1' }}>
            Generative EEG Tapestry
          </span>
          <span style={{ fontSize: '11px', color: (eegData?.inZone ?? true) ? '#68D391' : '#CBD5E0', fontWeight: 500 }}>
            • {(eegData?.inZone ?? true) ? 'Alpha Synchrony' : 'Relaxing'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', pointerEvents: 'auto' }}>
          <button
            onClick={handleCaptureSnapshot}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 12px',
              color: '#FFFFFF',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Camera size={12} />
            <span>{snapshotSaved ? 'Saved!' : 'Save Tapestry'}</span>
          </button>

          <button
            onClick={handleReset}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              color: '#CBD5E0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              backdropFilter: 'blur(8px)',
            }}
            title="Clear Canvas"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Main Persistent Generative Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'default',
          touchAction: 'none',
        }}
      />

      {/* Bottom Palette Selector */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 17, 26, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 'var(--radius-full)',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 10,
        }}
      >
        <Palette size={12} color="#CBD5E0" />
        {THERAPEUTIC_PALETTES.map((pal) => (
          <div
            key={pal.id}
            onClick={() => handleSelectPalette(pal)}
            style={{
              width: '15px',
              height: '15px',
              borderRadius: '50%',
              backgroundColor: pal.dotColor,
              cursor: 'pointer',
              border: activePalette.id === pal.id ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.2)',
              transform: activePalette.id === pal.id ? 'scale(1.25)' : 'scale(1)',
              transition: 'all 0.2s ease',
            }}
            title={pal.name}
          />
        ))}
      </div>
    </div>
  );
};
