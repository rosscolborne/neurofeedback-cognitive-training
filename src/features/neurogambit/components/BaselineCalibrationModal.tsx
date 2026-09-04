import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EEGDataPoint } from '../../../types';
import { NeuroGambitBaseline } from '../types';
import { Brain, ShieldCheck } from 'lucide-react';

interface BaselineCalibrationModalProps {
  eegData: EEGDataPoint | null;
  onBaselineReady: (baseline: NeuroGambitBaseline) => void;
  onSkip: () => void;
}

export const BaselineCalibrationModal: React.FC<BaselineCalibrationModalProps> = ({
  eegData,
  onBaselineReady,
  onSkip,
}) => {
  const durationSeconds = 15;
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [cleanSampleCount, setCleanSampleCount] = useState(0);

  const samplesRef = useRef<{ theta: number[]; beta: number[]; alpha: number[] }>({
    theta: [],
    beta: [],
    alpha: [],
  });

  useEffect(() => {
    if (eegData && !eegData.artifacts?.clench) {
      samplesRef.current.theta.push(eegData.bands.theta);
      samplesRef.current.beta.push(eegData.bands.beta);
      samplesRef.current.alpha.push(eegData.bands.alpha);
      setCleanSampleCount(samplesRef.current.theta.length);
    }
  }, [eegData]);

  const finishCalibration = useCallback(() => {
    const s = samplesRef.current;
    const calcMeanStd = (arr: number[], fallbackMean: number) => {
      if (arr.length < 5) return { mean: fallbackMean, std: 1.2 };
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
      const std = Math.sqrt(variance);
      return { mean: Number(mean.toFixed(2)), std: Math.max(0.6, Number(std.toFixed(2))) };
    };

    const thetaStat = calcMeanStd(s.theta, 6.5);
    const betaStat = calcMeanStd(s.beta, 5.0);
    const alphaStat = calcMeanStd(s.alpha, 7.0);

    const baseline: NeuroGambitBaseline = {
      thetaMean: thetaStat.mean,
      thetaStd: thetaStat.std,
      highBetaMean: betaStat.mean,
      highBetaStd: betaStat.std,
      alphaMean: alphaStat.mean,
      alphaStd: alphaStat.std,
      calibratedAt: Date.now(),
      isReady: true,
    };

    onBaselineReady(baseline);
  }, [onBaselineReady]);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setSecondsElapsed(elapsed);

      if (elapsed >= durationSeconds) {
        clearInterval(interval);
        finishCalibration();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [finishCalibration]);

  const progress = Math.min(1.0, secondsElapsed / durationSeconds);
  const remaining = Math.max(0, Math.ceil(durationSeconds - secondsElapsed));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(26, 26, 26, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
          borderRadius: '20px',
          padding: '28px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: 'var(--brand-primary-subtle, #FDF0EB)',
            color: 'var(--brand-primary, #E8967A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Brain size={28} />
        </div>

        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0', color: 'var(--text-primary, #1A1A1A)' }}>
            15s Neural Baseline Calibration
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary, #6B6560)', margin: 0, lineHeight: 1.5 }}>
            Sit upright with eyes gently open. Calibrating personal resting theta, beta, and alpha to customize your Time-Dilation Clock and Tilt recovery gates.
          </p>
        </div>

        {/* Circular Progress Display */}
        <div style={{ position: 'relative', width: '120px', height: '120px', margin: '8px 0' }}>
          <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-subtle, #F2F1EE)" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="var(--brand-primary, #E8967A)"
              strokeWidth="8"
              strokeDasharray={2 * Math.PI * 50}
              strokeDashoffset={2 * Math.PI * 50 * (1 - progress)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.1s linear' }}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>{remaining}s</span>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Remaining</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <ShieldCheck size={16} color="#10B981" />
          <span>Artifact-filtered resting snapshot ({cleanSampleCount} clean frames)</span>
        </div>

        <button
          onClick={onSkip}
          className="btn btn-ghost"
          style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}
        >
          Use Standard Baseline (Skip)
        </button>
      </div>
    </div>
  );
};
