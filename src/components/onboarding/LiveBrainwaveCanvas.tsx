import React, { useEffect, useRef, useState, useCallback } from 'react';
import { eegEngine } from '../../services/eegEngine';
import { EEGDataPoint, MuseChannelQuality, BandPowers } from '../../types';
import { Activity, Waves, BarChart2 } from 'lucide-react';

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

/**
 * 2nd-order IIR Biquad Bandpass Filter for 256 Hz sampling rate.
 * Directly extracts genuine biological oscillations from raw electrode microvolts.
 */
function applyBandpassFilter(samples: number[], lowCut: number, highCut: number, sampleRate = 256): number[] {
  if (samples.length < 4) return samples;
  const centerFreq = (lowCut + highCut) / 2;
  const bandwidth = Math.max(1.0, highCut - lowCut);
  const omega = (2 * Math.PI * centerFreq) / sampleRate;
  const q = Math.max(0.5, centerFreq / bandwidth);
  const alpha = Math.sin(omega) / (2 * q);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(omega);
  const a2 = 1 - alpha;

  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return Array.from(out);
}

/**
 * Extracts clean AC microvolts from a channel buffer with zero DC skin offset.
 * Default windowSize is 768 samples (3.0s at 256 Hz) for calm, medical-grade sweep.
 */
function extractChannelAcSlice(channelKey: keyof MuseChannelQuality, windowSize = 768): number[] {
  const buf = eegEngine.rawBuffers[channelKey] || [];
  if (buf.length === 0) return [];
  const samplesToTake = Math.min(buf.length, windowSize);
  const rawSlice = buf.slice(buf.length - samplesToTake);

  let sum = 0;
  for (let i = 0; i < rawSlice.length; i++) sum += rawSlice[i];
  const mean = sum / rawSlice.length;
  // If mean > 150, values are 12-bit ADC integers (~700-3000), so scale deviation by 0.48828 uV/count
  const isRawAdc = Math.abs(mean) > 150;
  const scale = isRawAdc ? 0.48828 : 1.0;

  return rawSlice.map((v) => (v - mean) * scale);
}


const BAND_CHANNELS: Array<{
  key: keyof BandPowers;
  name: string;
  range: string;
  lowCut: number;
  highCut: number;
  freqCenter: number;
  stateDesc: string;
  color: string;
}> = [
  {
    key: 'delta',
    name: 'Delta',
    range: '0.5 – 4 Hz',
    lowCut: 0.5,
    highCut: 4.0,
    freqCenter: 2.2,
    stateDesc: 'Restorative & Deep Rest',
    color: '#4A90D9',
  },
  {
    key: 'theta',
    name: 'Theta',
    range: '4 – 8 Hz',
    lowCut: 4.0,
    highCut: 8.0,
    freqCenter: 6.0,
    stateDesc: 'Intuition & Deep Meditation',
    color: '#E8967A',
  },
  {
    key: 'alpha',
    name: 'Alpha',
    range: '8 – 12 Hz',
    lowCut: 8.0,
    highCut: 12.0,
    freqCenter: 10.0,
    stateDesc: 'Calm Alertness (Surges Eyes-Closed)',
    color: '#7B68AE',
  },
  {
    key: 'smr',
    name: 'SMR',
    range: '12 – 15 Hz',
    lowCut: 12.0,
    highCut: 15.0,
    freqCenter: 13.5,
    stateDesc: 'Motor Stillness & Sensorimotor Rhythm',
    color: '#5C8C46',
  },
  {
    key: 'beta',
    name: 'Beta',
    range: '15 – 30 Hz',
    lowCut: 15.0,
    highCut: 30.0,
    freqCenter: 21.0,
    stateDesc: 'Active Thinking & Focus (Math / Processing)',
    color: '#C4A35A',
  },
  {
    key: 'gamma',
    name: 'Gamma',
    range: '30 – 45 Hz',
    lowCut: 30.0,
    highCut: 45.0,
    freqCenter: 36.0,
    stateDesc: 'Multi-Modal Cognitive Binding',
    color: '#3A78C0',
  },
];

export const LiveBrainwaveCanvas: React.FC<LiveBrainwaveCanvasProps> = ({
  height = 460,
  initialMode = 'raw',
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
  const [timeWindowSec, setTimeWindowSec] = useState<number>(3); // 3.0s default calm, readable sweep

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

      // Silent biological blink detection for step progression
      if (data.artifacts?.blink && now - lastBlinkRef.current > 1200) {
        lastBlinkRef.current = now;
        onBlinkDetected?.();
      }

      // Silent biological jaw clench EMG detection for step progression
      if (data.artifacts?.clench && now - lastClenchRef.current > 1200) {
        lastClenchRef.current = now;
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

    const windowSize = Math.round(timeWindowSec * 256);

    // ─────────────────────────────────────────────────────────────
    // MODE 1: ALL FREQUENCY BANDS (Delta, Theta, Alpha, SMR, Beta, Gamma)
    // Real DSP Bandpass Decompositions (Zero Synthetic Sine Waves)
    // ─────────────────────────────────────────────────────────────
    if (mode === 'bands') {
      const trackHeight = heightPx / BAND_CHANNELS.length;

      // Extract physical AC signals across active electrodes
      const chSlices = RAW_CHANNELS.map((ch) => extractChannelAcSlice(ch.key, windowSize));
      const maxLen = Math.max(0, ...chSlices.map((s) => s.length));
      const compositeAc: number[] = new Array(maxLen).fill(0);

      if (maxLen > 0) {
        for (let i = 0; i < maxLen; i++) {
          let sum = 0;
          let count = 0;
          for (const slice of chSlices) {
            if (i < slice.length) {
              sum += slice[i];
              count++;
            }
          }
          compositeAc[i] = count > 0 ? sum / count : 0;
        }
      }

      BAND_CHANNELS.forEach((band, idx) => {
        const centerY = trackHeight * idx + trackHeight / 2;
        const rawPower = latestBands[band.key] || 0;

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

        // Real Filtered Biological Oscillations Trace (Pure DSP)
        const startX = 135;
        const endX = width - 90;
        const waveWidth = endX - startX;

        ctx.shadowColor = band.color;
        ctx.shadowBlur = isHighlight ? 12 : 5;
        ctx.strokeStyle = isHighlight ? '#FFFFFF' : band.color;
        ctx.lineWidth = isHighlight ? 2.4 : 1.8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Filter the raw composite electrode microvolts into this specific band
        const filtered = applyBandpassFilter(compositeAc, band.lowCut, band.highCut);
        const bandScale = (trackHeight / 45) * scaleMultiplier;
        const maxBandDeflection = trackHeight * 0.42;

        ctx.beginPath();
        if (filtered.length > 1) {
          for (let i = 0; i < filtered.length; i++) {
            const x = startX + (i / (filtered.length - 1)) * waveWidth;
            const clamped = Math.max(-maxBandDeflection, Math.min(maxBandDeflection, filtered[i] * bandScale));
            const y = centerY - clamped;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        } else {
          // Zero line if waiting for hardware packets
          ctx.moveTo(startX, centerY);
          ctx.lineTo(endX, centerY);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODE 2: RAW ELECTRODES (TP9, AF7, AF8, TP10 256Hz Streams)
    // True Biological Microvolt Oscilloscope (Centered with Zero DC Offset)
    // ─────────────────────────────────────────────────────────────
    else if (mode === 'raw') {
      const trackHeight = heightPx / RAW_CHANNELS.length;

      RAW_CHANNELS.forEach((ch, idx) => {
        const centerY = trackHeight * idx + trackHeight / 2;
        const acSlice = extractChannelAcSlice(ch.key, windowSize);

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

        // Voltage Value Right: Real instantaneous AC potential
        const lastVal = acSlice.length > 0 ? acSlice[acSlice.length - 1] : 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '11px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${lastVal >= 0 ? '+' : ''}${lastVal.toFixed(1)} μV`, width - 16, centerY);

        // Raw Voltage Wave: Physically bounded and centered in track
        if (acSlice.length > 1) {
          const traceStartX = 90;
          const traceEndX = width - 75;
          const traceWidth = traceEndX - traceStartX;

          ctx.shadowColor = ch.glowColor;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 1.8;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';

          const scale = (trackHeight / 85) * scaleMultiplier;
          const maxDeflection = trackHeight * 0.44;

          ctx.beginPath();
          for (let i = 0; i < acSlice.length; i++) {
            const acUv = acSlice[i];
            const clamped = Math.max(-maxDeflection, Math.min(maxDeflection, acUv * scale));
            const x = traceStartX + (i / (acSlice.length - 1)) * traceWidth;
            const y = centerY - clamped;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          // Zero line if waiting for packets
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.beginPath();
          ctx.moveTo(90, centerY);
          ctx.lineTo(width - 75, centerY);
          ctx.stroke();
        }
      });
    }


    // ─────────────────────────────────────────────────────────────
    // MODE 3: SPECTRAL DENSITY LANDSCAPE (FFT 1–45 Hz)
    // ─────────────────────────────────────────────────────────────
    else if (mode === 'spectrum') {
      let spectrum = eegEngine.getLatestSpectrum();
      if (spectrum.length <= 2) {
        spectrum = eegEngine.computeFftSpectrumOnDemand();
      }
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
        // Gradient area fill under curve
        const grad = ctx.createLinearGradient(0, margin, 0, bottomY);
        grad.addColorStop(0, 'rgba(209, 109, 77, 0.25)');
        grad.addColorStop(1, 'rgba(209, 109, 77, 0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        spectrum.forEach((pt, i) => {
          const x = margin + Math.min(plotWidth, (pt.freq / 45) * plotWidth);
          const y = bottomY - Math.min(plotHeight - 20, pt.power * 24 * scaleMultiplier);
          if (i === 0) {
            ctx.moveTo(x, bottomY);
            ctx.lineTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        const lastX = margin + Math.min(plotWidth, (spectrum[spectrum.length - 1].freq / 45) * plotWidth);
        ctx.lineTo(lastX, bottomY);
        ctx.closePath();
        ctx.fill();

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
        const paf = eegEngine.getLatestPeakAlphaHz() || peakAlphaHz || 10.0;
        const pafX = margin + (paf / 45) * plotWidth;
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
        ctx.fillText(`PAF: ${paf.toFixed(1)} Hz`, pafX, bottomY + 20);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = '12px "JetBrains Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting live EEG streaming to compute FFT spectrum...', margin + plotWidth / 2, margin + plotHeight / 2);
      }
    }

    ctx.restore();

    animationFrameRef.current = requestAnimationFrame(renderCanvas);
  }, [mode, channelQuality, latestBands, peakAlphaHz, scaleMultiplier, timeWindowSec, isCalibratingEyesClosed, isCalibratingFocus]);

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

          {/* Controls: Sweep Window & Scale Multiplier */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Sweep Duration */}
            {mode !== 'spectrum' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
                  SWEEP:
                </span>
                {[2, 3, 5].map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setTimeWindowSec(sec)}
                    style={{
                      background: timeWindowSec === sec ? 'rgba(232, 150, 122, 0.3)' : 'rgba(255, 255, 255, 0.06)',
                      color: timeWindowSec === sec ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)',
                      border: `1px solid ${timeWindowSec === sec ? 'rgba(232, 150, 122, 0.5)' : 'transparent'}`,
                      borderRadius: '4px',
                      padding: '3px 7px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono, monospace)',
                      cursor: 'pointer',
                    }}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            )}

            {/* Scale Multiplier */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
        </div>
      )}

      {/* Canvas Viewport */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: `${height}px` }} />
    </div>
  );
};
