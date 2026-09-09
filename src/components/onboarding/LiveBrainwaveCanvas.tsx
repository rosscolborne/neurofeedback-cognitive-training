import React, { useEffect, useRef, useState, useCallback } from 'react';
import { eegEngine } from '../../services/eegEngine';
import { EEGDataPoint, MuseChannelQuality, BandPowers } from '../../types';
import { Activity, Waves, BarChart2, ZoomIn, Eye, Sparkles } from 'lucide-react';

export type CanvasViewMode = 'bands' | 'raw' | 'spectrum';

interface LiveBrainwaveCanvasProps {
  height?: number;
  initialMode?: CanvasViewMode;
  allowModeSwitching?: boolean;
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

const RAW_CHANNELS: Array<{
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
    color: '#4A90D9',
    glowColor: 'rgba(74, 144, 217, 0.45)',
  },
  {
    key: 'af7',
    name: 'AF7',
    label: 'Left Forehead (Anterior)',
    color: '#E8967A',
    glowColor: 'rgba(232, 150, 122, 0.45)',
  },
  {
    key: 'af8',
    name: 'AF8',
    label: 'Right Forehead (Anterior)',
    color: '#C4A35A',
    glowColor: 'rgba(196, 163, 90, 0.45)',
  },
  {
    key: 'tp10',
    name: 'TP10',
    label: 'Right Ear (Temporal)',
    color: '#7B68AE',
    glowColor: 'rgba(123, 104, 174, 0.45)',
  },
];

const BAND_CHANNELS: Array<{
  key: keyof BandPowers;
  name: string;
  range: string;
  freqCenter: number;
  stateDesc: string;
  color: string;
}> = [
  {
    key: 'delta',
    name: 'Delta',
    range: '0.5 – 4 Hz',
    freqCenter: 2.2,
    stateDesc: 'Restorative & Deep Rest',
    color: '#4A90D9',
  },
  {
    key: 'theta',
    name: 'Theta',
    range: '4 – 8 Hz',
    freqCenter: 6.0,
    stateDesc: 'Intuition & Deep Meditation',
    color: '#E8967A',
  },
  {
    key: 'alpha',
    name: 'Alpha',
    range: '8 – 12 Hz',
    freqCenter: 10.0,
    stateDesc: 'Calm Alertness (Surges Eyes-Closed)',
    color: '#7B68AE',
  },
  {
    key: 'smr',
    name: 'SMR',
    range: '12 – 15 Hz',
    freqCenter: 13.5,
    stateDesc: 'Motor Stillness & Sensorimotor Rhythm',
    color: '#5C8C46',
  },
  {
    key: 'beta',
    name: 'Beta',
    range: '15 – 30 Hz',
    freqCenter: 21.0,
    stateDesc: 'Active Thinking & Focus (Math / Processing)',
    color: '#C4A35A',
  },
  {
    key: 'gamma',
    name: 'Gamma',
    range: '30 – 45 Hz',
    freqCenter: 36.0,
    stateDesc: 'Multi-Modal Cognitive Binding',
    color: '#3A78C0',
  },
];

export const LiveBrainwaveCanvas: React.FC<LiveBrainwaveCanvasProps> = ({
  height = 460,
  initialMode = 'bands',
  allowModeSwitching = true,
  onBlinkDetected,
  onClenchDetected,
  isCalibratingEyesClosed = false,
  isCalibratingFocus = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<CanvasViewMode>(initialMode);
  const [scaleMultiplier, setScaleMultiplier] = useState<number>(1);
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

  const [peakAlphaHz, setPeakAlphaHz] = useState(10.0);

  const lastBlinkRef = useRef(0);
  const lastClenchRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);

  // Subscribe to real EEG updates
  useEffect(() => {
    eegEngine.start(50); // High-rate UI telemetry loop

    const unsubscribe = eegEngine.subscribe((data: EEGDataPoint) => {
      setChannelQuality({ ...data.channelQuality });
      if (data.bands) {
        setLatestBands({ ...data.bands });
      }

      const paf = eegEngine.getLatestPeakAlphaHz();
      if (paf > 0) {
        setPeakAlphaHz(paf);
      }

      const now = performance.now();

      // Real physical Blink Detection
      if (data.artifacts?.blink && now - lastBlinkRef.current > 1200) {
        lastBlinkRef.current = now;
        setActiveArtifact({
          type: 'blink',
          label: '⚡ Frontal Blink Artifact Detected (AF7 / AF8)',
          time: now,
        });
        onBlinkDetected?.();
      }

      // Real physical Jaw Clench EMG Detection
      if (data.artifacts?.clench && now - lastClenchRef.current > 1200) {
        lastClenchRef.current = now;
        setActiveArtifact({
          type: 'clench',
          label: '⚡ Temporalis EMG Clench Detected (TP9 / TP10)',
          time: now,
        });
        onClenchDetected?.();
      }
    });

    return () => unsubscribe();
  }, [onBlinkDetected, onClenchDetected]);

  // Main 60 FPS Canvas Render Loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const heightPx = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Warm Obsidian Backdrop
    ctx.fillStyle = '#141312';
    ctx.fillRect(0, 0, width, heightPx);

    // Grid Lines
    ctx.strokeStyle = 'rgba(232, 150, 122, 0.06)';
    ctx.lineWidth = 1;
    const gridStep = 40;
    for (let x = 0; x < width; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightPx);
      ctx.stroke();
    }

    phaseRef.current += 0.05;

    // ─────────────────────────────────────────────────────────────
    // MODE 1: ALL FREQUENCY BANDS (Delta, Theta, Alpha, SMR, Beta, Gamma)
    // ─────────────────────────────────────────────────────────────
    if (mode === 'bands') {
      const trackHeight = heightPx / BAND_CHANNELS.length;

      BAND_CHANNELS.forEach((band, idx) => {
        const centerY = trackHeight * idx + trackHeight / 2;
        const rawPower = latestBands[band.key] || 0;
        const amplitude = rawPower * scaleMultiplier * 14;

        const isHighlight =
          (band.key === 'alpha' && isCalibratingEyesClosed) ||
          (band.key === 'beta' && isCalibratingFocus);

        // Track divider
        ctx.strokeStyle = 'rgba(232, 150, 122, 0.09)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(130, centerY);
        ctx.lineTo(width - 90, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Left Header: Band Name & Frequency
        ctx.fillStyle = isHighlight ? '#FFFFFF' : band.color;
        ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(band.name.toUpperCase(), 16, centerY - 8);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '10px "JetBrains Mono", Consolas, monospace';
        ctx.fillText(band.range, 16, centerY + 8);

        // Right Header: Measured Power Readout
        ctx.fillStyle = isHighlight ? band.color : 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${rawPower.toFixed(2)} μV`, width - 16, centerY - 6);

        // Mini Power Meter Bar on Right
        const meterWidth = 60;
        const fillWidth = Math.min(meterWidth, Math.max(2, (rawPower / 4) * meterWidth));
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(width - 16 - meterWidth, centerY + 4, meterWidth, 4);
        ctx.fillStyle = band.color;
        ctx.fillRect(width - 16 - meterWidth, centerY + 4, fillWidth, 4);

        // Oscillating Waveform Trace
        const startX = 135;
        const endX = width - 90;
        const waveWidth = endX - startX;

        ctx.shadowColor = band.color;
        ctx.shadowBlur = isHighlight ? 12 : 5;
        ctx.strokeStyle = isHighlight ? '#FFFFFF' : band.color;
        ctx.lineWidth = isHighlight ? 2.4 : 1.8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        const steps = 140;
        for (let i = 0; i <= steps; i++) {
          const x = startX + (i / steps) * waveWidth;
          const freq = band.key === 'alpha' ? peakAlphaHz : band.freqCenter;
          const t = (i / steps) * (freq * 0.4) - phaseRef.current * (freq * 0.15);
          const y = centerY + Math.sin(t * Math.PI * 2) * Math.max(2, amplitude);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 2: RAW ELECTRODES (TP9, AF7, AF8, TP10 256Hz Streams)
    // ─────────────────────────────────────────────────────────────
    else if (mode === 'raw') {
      const trackHeight = heightPx / RAW_CHANNELS.length;

      RAW_CHANNELS.forEach((ch, idx) => {
        const centerY = trackHeight * idx + trackHeight / 2;
        const buffer = eegEngine.rawBuffers[ch.key] || [];

        // Divider
        ctx.strokeStyle = 'rgba(232, 150, 122, 0.08)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(90, centerY);
        ctx.lineTo(width - 70, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Contact quality dot
        const quality = channelQuality[ch.key];
        const qColor = quality === 'good' ? '#10B981' : quality === 'fair' ? '#F59E0B' : '#EF4444';
        ctx.fillStyle = qColor;
        ctx.beginPath();
        ctx.arc(16, centerY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Channel Label
        ctx.fillStyle = ch.color;
        ctx.font = 'bold 12px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch.name, 28, centerY - 8);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '10px "DM Sans", -apple-system, sans-serif';
        ctx.fillText(ch.label.split(' ')[0], 28, centerY + 8);

        // Voltage Value Right
        const lastVal = buffer.length > 0 ? buffer[buffer.length - 1] : 0;
        const uV = (lastVal - 2048) * 0.48828;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${uV >= 0 ? '+' : ''}${uV.toFixed(1)} μV`, width - 16, centerY);

        // Raw Voltage Wave
        if (buffer.length > 1) {
          const traceStartX = 90;
          const traceEndX = width - 75;
          const traceWidth = traceEndX - traceStartX;
          const samplesToDraw = Math.min(buffer.length, 256);
          const startIndex = buffer.length - samplesToDraw;

          ctx.shadowColor = ch.glowColor;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 1.8;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';

          ctx.beginPath();
          for (let i = 0; i < samplesToDraw; i++) {
            const sample = buffer[startIndex + i];
            const normalized = (sample - 2048) * 0.48828;
            const scale = (trackHeight / 110) * scaleMultiplier;
            const x = traceStartX + (i / (samplesToDraw - 1)) * traceWidth;
            const y = centerY - normalized * scale;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 3: SPECTRAL DENSITY LANDSCAPE (FFT 1–45 Hz)
    // ─────────────────────────────────────────────────────────────
    else if (mode === 'spectrum') {
      const spectrum = eegEngine.getLatestSpectrum();
      const margin = 40;
      const plotWidth = width - margin * 2;
      const plotHeight = heightPx - margin * 2;
      const bottomY = heightPx - margin;

      // Axis Lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, bottomY);
      ctx.lineTo(margin + plotWidth, bottomY);
      ctx.stroke();

      // Band Color Underlay Regions
      const regions = [
        { label: 'Delta', start: 0.5, end: 4, color: 'rgba(74, 144, 217, 0.12)' },
        { label: 'Theta', start: 4, end: 8, color: 'rgba(232, 150, 122, 0.12)' },
        { label: 'Alpha', start: 8, end: 12, color: 'rgba(123, 104, 174, 0.16)' },
        { label: 'SMR', start: 12, end: 15, color: 'rgba(92, 140, 70, 0.12)' },
        { label: 'Beta', start: 15, end: 30, color: 'rgba(196, 163, 90, 0.12)' },
        { label: 'Gamma', start: 30, end: 45, color: 'rgba(58, 120, 192, 0.12)' },
      ];

      regions.forEach((reg) => {
        const x1 = margin + (reg.start / 45) * plotWidth;
        const x2 = margin + (reg.end / 45) * plotWidth;
        ctx.fillStyle = reg.color;
        ctx.fillRect(x1, margin, x2 - x1, plotHeight);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '10px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(reg.label, (x1 + x2) / 2, margin + 14);
      });

      // Draw FFT Curve
      if (spectrum.length > 2) {
        ctx.strokeStyle = '#D16D4D';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = 'rgba(209, 109, 77, 0.5)';
        ctx.shadowBlur = 10;
        ctx.beginPath();

        spectrum.forEach((pt, i) => {
          const x = margin + Math.min(plotWidth, (pt.freq / 45) * plotWidth);
          const y = bottomY - Math.min(plotHeight - 20, pt.power * 24 * scaleMultiplier);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;

        // PAF (Peak Alpha Marker)
        const pafX = margin + (peakAlphaHz / 45) * plotWidth;
        ctx.strokeStyle = '#7B68AE';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pafX, margin);
        ctx.lineTo(pafX, bottomY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#7B68AE';
        ctx.font = 'bold 11px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`PAF: ${peakAlphaHz.toFixed(1)} Hz`, pafX, bottomY + 20);
      }
    }

    ctx.restore();

    animationFrameRef.current = requestAnimationFrame(renderCanvas);
  }, [mode, channelQuality, latestBands, peakAlphaHz, scaleMultiplier, isCalibratingEyesClosed, isCalibratingFocus]);

  // Handle Resize
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

  // Start Animation
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderCanvas);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderCanvas]);

  // Clear artifact badge
  useEffect(() => {
    if (!activeArtifact) return;
    const timeout = setTimeout(() => setActiveArtifact(null), 2400);
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
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Interactive Toolbar Header */}
      {allowModeSwitching && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(232, 150, 122, 0.15)',
            background: 'rgba(20, 19, 18, 0.95)',
            backdropFilter: 'blur(8px)',
            zIndex: 10,
          }}
        >
          {/* View Modes */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setMode('bands')}
              style={{
                background: mode === 'bands' ? 'var(--brand-primary, #D16D4D)' : 'rgba(255, 255, 255, 0.08)',
                color: mode === 'bands' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s',
              }}
            >
              <Waves size={13} />
              <span>All Brainwaves</span>
            </button>

            <button
              onClick={() => setMode('raw')}
              style={{
                background: mode === 'raw' ? 'var(--brand-primary, #D16D4D)' : 'rgba(255, 255, 255, 0.08)',
                color: mode === 'raw' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s',
              }}
            >
              <Activity size={13} />
              <span>4-Channel Raw</span>
            </button>

            <button
              onClick={() => setMode('spectrum')}
              style={{
                background: mode === 'spectrum' ? 'var(--brand-primary, #D16D4D)' : 'rgba(255, 255, 255, 0.08)',
                color: mode === 'spectrum' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '9999px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.2s',
              }}
            >
              <BarChart2 size={13} />
              <span>FFT Spectrum</span>
            </button>
          </div>

          {/* Scale Multiplier */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
              GAIN:
            </span>
            {[1, 2, 4].map((mult) => (
              <button
                key={mult}
                onClick={() => setScaleMultiplier(mult)}
                style={{
                  background: scaleMultiplier === mult ? 'rgba(232, 150, 122, 0.3)' : 'rgba(255, 255, 255, 0.06)',
                  color: scaleMultiplier === mult ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                  border: `1px solid ${scaleMultiplier === mult ? 'rgba(232, 150, 122, 0.5)' : 'transparent'}`,
                  borderRadius: '4px',
                  padding: '3px 7px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  cursor: 'pointer',
                }}
              >
                {mult}x
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Canvas Viewport */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px` }} />

      {/* Real-Time Biological Artifact Banner */}
      {activeArtifact && (
        <div
          style={{
            position: 'absolute',
            top: allowModeSwitching ? '52px' : '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background:
              activeArtifact.type === 'blink'
                ? 'rgba(232, 150, 122, 0.95)'
                : 'rgba(196, 163, 90, 0.95)',
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
            zIndex: 20,
          }}
        >
          {activeArtifact.label}
        </div>
      )}
    </div>
  );
};
