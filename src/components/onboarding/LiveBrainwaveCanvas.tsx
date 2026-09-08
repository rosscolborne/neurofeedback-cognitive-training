import React, { useEffect, useRef, useState, useCallback } from 'react';
import { eegEngine } from '../../services/eegEngine';
import { EEGDataPoint, MuseChannelQuality, BandPowers } from '../../types';

interface LiveBrainwaveCanvasProps {
  height?: number;
  showBands?: boolean;
  highlightArtifacts?: boolean;
  onBlinkDetected?: () => void;
  onClenchDetected?: () => void;
  isCalibratingEyesClosed?: boolean;
  isCalibratingFocus?: boolean;
}

interface ArtifactBanner {
  type: 'blink' | 'clench';
  label: string;
  time: number;
}

const CHANNELS: Array<{
  key: keyof MuseChannelQuality;
  name: string;
  label: string;
  color: string;
  glowColor: string;
}> = [
  {
    key: 'tp9',
    name: 'TP9',
    label: 'Left Ear (Temporal)',
    color: '#4A90D9', // --chart-delta
    glowColor: 'rgba(74, 144, 217, 0.45)',
  },
  {
    key: 'af7',
    name: 'AF7',
    label: 'Left Forehead (Anterior)',
    color: '#E8967A', // --chart-theta / brand-primary
    glowColor: 'rgba(232, 150, 122, 0.45)',
  },
  {
    key: 'af8',
    name: 'AF8',
    label: 'Right Forehead (Anterior)',
    color: '#C4A35A', // --chart-beta
    glowColor: 'rgba(196, 163, 90, 0.45)',
  },
  {
    key: 'tp10',
    name: 'TP10',
    label: 'Right Ear (Temporal)',
    color: '#7B68AE', // --chart-alpha
    glowColor: 'rgba(123, 104, 174, 0.45)',
  },
];

export const LiveBrainwaveCanvas: React.FC<LiveBrainwaveCanvasProps> = ({
  height = 420,
  showBands = true,
  highlightArtifacts = true,
  onBlinkDetected,
  onClenchDetected,
  isCalibratingEyesClosed = false,
  isCalibratingFocus = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [activeArtifact, setActiveArtifact] = useState<ArtifactBanner | null>(null);
  const [channelQuality, setChannelQuality] = useState<MuseChannelQuality>({
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  });
  const [latestBands, setLatestBands] = useState<BandPowers>({
    delta: 0,
    theta: 0,
    alpha: 0,
    smr: 0,
    beta: 0,
    gamma: 0,
  });

  const lastBlinkRef = useRef(0);
  const lastClenchRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  // Subscribe to real EEG updates
  useEffect(() => {
    eegEngine.start(50); // Ensure engine is streaming

    const unsubscribe = eegEngine.subscribe((data: EEGDataPoint) => {
      setChannelQuality({ ...data.channelQuality });
      if (data.bands) {
        setLatestBands({ ...data.bands });
      }

      const now = performance.now();

      // Physical Blink Detection (from data artifacts or frontal spike)
      if (data.artifacts?.blink && now - lastBlinkRef.current > 1200) {
        lastBlinkRef.current = now;
        setActiveArtifact({
          type: 'blink',
          label: '⚡ Blink Artifact Detected (AF7 / AF8 Motor Cortex)',
          time: now,
        });
        onBlinkDetected?.();
      }

      // Physical Jaw Clench EMG Detection
      if (data.artifacts?.clench && now - lastClenchRef.current > 1200) {
        lastClenchRef.current = now;
        setActiveArtifact({
          type: 'clench',
          label: '⚡ Jaw Clench Detected (TP9 / TP10 Temporalis EMG)',
          time: now,
        });
        onClenchDetected?.();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [onBlinkDetected, onClenchDetected]);

  // Main Canvas Render Loop (60 FPS Phosphor Oscilloscope)
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width / (window.devicePixelRatio || 1);
    const heightPx = canvas.height / (window.devicePixelRatio || 1);

    ctx.save();
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    // Warm Obsidian / Deep Espresso Studio Backdrop
    ctx.fillStyle = '#141312';
    ctx.fillRect(0, 0, width, heightPx);

    // Subtle Grid Lines
    ctx.strokeStyle = 'rgba(232, 150, 122, 0.07)';
    ctx.lineWidth = 1;
    const gridStep = 40;
    for (let x = 0; x < width; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightPx);
      ctx.stroke();
    }

    const scopeHeight = showBands ? heightPx - 70 : heightPx;
    const channelTrackHeight = scopeHeight / CHANNELS.length;

    // Render 4 Staggered Phosphor Traces
    CHANNELS.forEach((ch, idx) => {
      const centerY = channelTrackHeight * idx + channelTrackHeight / 2;
      const buffer = eegEngine.rawBuffers[ch.key] || [];

      // Channel Baseline Divider Line
      ctx.strokeStyle = 'rgba(232, 150, 122, 0.1)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(90, centerY);
      ctx.lineTo(width - 70, centerY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Channel Meta Left Header
      const quality = channelQuality[ch.key];
      const qColor = quality === 'good' ? '#10B981' : quality === 'fair' ? '#F59E0B' : '#EF4444';

      // Status indicator dot
      ctx.fillStyle = qColor;
      ctx.beginPath();
      ctx.arc(16, centerY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Channel name (e.g. "AF7")
      ctx.fillStyle = ch.color;
      ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.name, 28, centerY - 8);

      // Channel site description
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '10px "DM Sans", -apple-system, sans-serif';
      ctx.fillText(ch.label.split(' ')[0], 28, centerY + 8);

      // Latest microvolt value right header
      const lastVal = buffer.length > 0 ? buffer[buffer.length - 1] : 0;
      const uV = (lastVal - 2048) * 0.48828; // Standard 12-bit to μV conversion
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '11px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${uV >= 0 ? '+' : ''}${uV.toFixed(1)} μV`, width - 16, centerY);

      // Draw Waveform Trace
      if (buffer.length > 1) {
        const traceStartX = 90;
        const traceEndX = width - 75;
        const traceWidth = traceEndX - traceStartX;
        const samplesToDraw = Math.min(buffer.length, 256); // 1 second window
        const startIndex = buffer.length - samplesToDraw;

        // Trace glow pass
        ctx.shadowColor = ch.glowColor;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        for (let i = 0; i < samplesToDraw; i++) {
          const sample = buffer[startIndex + i];
          const normalized = (sample - 2048) * 0.48828; // microvolts
          const scale = channelTrackHeight / 110; // ~55uV half-height deflection
          const x = traceStartX + (i / (samplesToDraw - 1)) * traceWidth;
          const y = centerY - normalized * scale;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
      }
    });

    // Bottom Spectral Band Frequency Ribbon
    if (showBands) {
      const bandTopY = scopeHeight;
      const bandHeight = heightPx - scopeHeight;

      ctx.fillStyle = 'rgba(20, 19, 18, 0.95)';
      ctx.fillRect(0, bandTopY, width, bandHeight);

      // Top separator line
      ctx.strokeStyle = 'rgba(232, 150, 122, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bandTopY);
      ctx.lineTo(width, bandTopY);
      ctx.stroke();

      const bandsList = [
        { name: 'Delta (1-4Hz)', val: latestBands.delta || 0, color: '#4A90D9' },
        { name: 'Theta (4-8Hz)', val: latestBands.theta || 0, color: '#E8967A' },
        {
          name: 'Alpha (8-12Hz)',
          val: latestBands.alpha || 0,
          color: '#7B68AE',
          isTarget: isCalibratingEyesClosed,
        },
        {
          name: 'Beta (13-30Hz)',
          val: latestBands.beta || 0,
          color: '#C4A35A',
          isTarget: isCalibratingFocus,
        },
        { name: 'Gamma (30-45Hz)', val: latestBands.gamma || 0, color: '#3A78C0' },
      ];

      const totalPower = bandsList.reduce((acc, b) => acc + Math.max(0.01, b.val), 0);
      const startX = 16;
      const availableWidth = width - 32;
      const barHeight = 16;
      const barY = bandTopY + 28;

      // Label Header
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('LIVE FREQUENCY SPECTRAL DECOMPOSITION (FFT)', startX, bandTopY + 16);

      let currentX = startX;
      bandsList.forEach((band) => {
        const ratio = totalPower > 0 ? Math.max(0.05, band.val / totalPower) : 0.2;
        const segmentWidth = ratio * availableWidth;

        ctx.fillStyle = band.color;
        if (band.isTarget) {
          ctx.shadowColor = band.color;
          ctx.shadowBlur = 10;
        }

        ctx.beginPath();
        ctx.roundRect(currentX, barY, Math.max(2, segmentWidth - 2), barHeight, 3);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Band Mini Label under bar
        ctx.fillStyle = band.isTarget ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)';
        ctx.font = band.isTarget
          ? 'bold 10px "JetBrains Mono", Consolas, monospace'
          : '9px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(band.name.split(' ')[0], currentX + 2, barY + barHeight + 14);

        currentX += segmentWidth;
      });
    }

    ctx.restore();

    animationFrameRef.current = requestAnimationFrame(renderCanvas);
  }, [channelQuality, latestBands, showBands, isCalibratingEyesClosed, isCalibratingFocus]);

  // Handle Resize & Canvas Scaling
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [height]);

  // Start Animation Loop
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderCanvas);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderCanvas]);

  // Clear artifact badge after 2.5s
  useEffect(() => {
    if (!activeArtifact) return;
    const timeout = setTimeout(() => {
      setActiveArtifact(null);
    }, 2400);
    return () => clearTimeout(timeout);
  }, [activeArtifact]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: 'var(--radius-xl, 20px)',
        overflow: 'hidden',
        border: '1px solid rgba(232, 150, 122, 0.25)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        background: '#141312',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px` }} />

      {/* Real-Time Biological Artifact Banner */}
      {highlightArtifacts && activeArtifact && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background:
              activeArtifact.type === 'blink'
                ? 'rgba(232, 150, 122, 0.92)'
                : 'rgba(196, 163, 90, 0.92)',
            color: '#FFFFFF',
            padding: '6px 14px',
            borderRadius: '9999px',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: '"DM Sans", -apple-system, sans-serif',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.2s ease-out',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backdropFilter: 'blur(8px)',
          }}
        >
          {activeArtifact.label}
        </div>
      )}

      {/* Calibration Target Mode Badge */}
      {isCalibratingEyesClosed && (
        <div
          style={{
            position: 'absolute',
            bottom: showBands ? '76px' : '16px',
            right: '16px',
            background: 'rgba(123, 104, 174, 0.85)',
            color: '#FFFFFF',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm, 8px)',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              animation: 'pulse 1.2s infinite',
            }}
          />
          ALPHA SYNCHRONY LOCK (8-12Hz)
        </div>
      )}

      {isCalibratingFocus && (
        <div
          style={{
            position: 'absolute',
            bottom: showBands ? '76px' : '16px',
            right: '16px',
            background: 'rgba(196, 163, 90, 0.85)',
            color: '#FFFFFF',
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm, 8px)',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backdropFilter: 'blur(6px)',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              animation: 'pulse 0.8s infinite',
            }}
          />
          BETA DYNAMIC RANGE LOCK (13-30Hz)
        </div>
      )}
    </div>
  );
};
