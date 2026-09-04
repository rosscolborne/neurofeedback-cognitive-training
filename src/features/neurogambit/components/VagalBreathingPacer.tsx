import React from 'react';
import { Heart, Activity, CheckCircle2 } from 'lucide-react';
import { BrainStateEvent } from '../types';

interface VagalBreathingPacerProps {
  elapsedSeconds: number;
  pacerPhase: 'inhale' | 'exhale';
  pacerProgress: number; // 0.0 to 1.0
  recoveryProgress: number; // 0.0 to 1.0 (1.5s consecutive hold)
  brainState: BrainStateEvent;
  minDuration?: number; // 6s
}

export const VagalBreathingPacer: React.FC<VagalBreathingPacerProps> = ({
  elapsedSeconds,
  pacerPhase,
  pacerProgress,
  recoveryProgress,
  brainState,
  minDuration = 6.0,
}) => {
  // Expansion scaling: Inhale expands from 0.7 to 1.25; Exhale contracts from 1.25 to 0.7
  const circleScale = pacerPhase === 'inhale'
    ? 0.75 + pacerProgress * 0.45
    : 1.2 - pacerProgress * 0.45;

  const isFloorPassed = elapsedSeconds >= minDuration;
  const isRecoveredNow = brainState.normalizedComposure >= 1.0 && !brainState.isClenching;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(26, 26, 26, 0.92)',
        backdropFilter: 'blur(10px)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        color: '#FFFFFF',
        borderRadius: '16px',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Heart size={20} color="#EF4444" />
        <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#E8967A', fontWeight: 700 }}>
          Autonomic Circuit Breaker
        </span>
      </div>

      <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 6px 0', color: '#FFFFFF' }}>
        Post-Blunder Resilience Reset
      </h3>
      <p style={{ fontSize: '13px', color: '#D1D5DB', maxWidth: '340px', lineHeight: 1.4, margin: '0 0 24px 0' }}>
        Down-regulate sympathetic high-beta arousal. Extended exhalation stimulates vagal tone to break tilt cascades.
      </p>

      {/* Breathing Pacer Circle */}
      <div
        style={{
          position: 'relative',
          width: '180px',
          height: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}
      >
        {/* Outer rhythmic pulsing ring */}
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            border: `2px dashed ${isRecoveredNow ? '#5C8C46' : '#7B68AE'}`,
            opacity: 0.4,
          }}
        />

        {/* Dynamic expanding / contracting sphere */}
        <div
          style={{
            width: '130px',
            height: '130px',
            borderRadius: '50%',
            background: isRecoveredNow
              ? 'radial-gradient(circle, #5C8C46 0%, #3B5E2C 100%)'
              : 'radial-gradient(circle, #E8967A 0%, #B85D3B 100%)',
            boxShadow: isRecoveredNow
              ? '0 0 35px rgba(92, 140, 70, 0.7)'
              : '0 0 35px rgba(232, 150, 122, 0.6)',
            transform: `scale(${circleScale})`,
            transition: 'transform 0.1s linear, background 0.4s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {pacerPhase === 'inhale' ? 'Inhale (4s)' : 'Exhale (6s)'}
          </span>
          <span style={{ fontSize: '11px', opacity: 0.9, marginTop: '2px' }}>
            {elapsedSeconds.toFixed(1)}s
          </span>
        </div>
      </div>

      {/* 1.5s Sustained Recovery Meter */}
      <div style={{ width: '100%', maxWidth: '300px', backgroundColor: 'rgba(255, 255, 255, 0.1)', padding: '12px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
          <span style={{ color: '#9CA3AF' }}>Alpha/Beta Recovery Hold (1.5s):</span>
          <span style={{ fontWeight: 700, color: isRecoveredNow ? '#10B981' : '#F59E0B' }}>
            {Math.round(recoveryProgress * 100)}%
          </span>
        </div>

        <div style={{ width: '100%', height: '8px', backgroundColor: 'rgba(255, 255, 255, 0.2)', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${recoveryProgress * 100}%`,
              height: '100%',
              backgroundColor: isRecoveredNow ? '#10B981' : '#E8967A',
              transition: 'width 0.1s ease',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '10px', color: '#9CA3AF' }}>
          <span>Floor: {Math.max(0, Math.ceil(minDuration - elapsedSeconds))}s remaining</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Activity size={10} color={isRecoveredNow ? '#10B981' : '#EF4444'} />
            Composure: {brainState.normalizedComposure.toFixed(2)}x
          </span>
        </div>
      </div>

      {isFloorPassed && recoveryProgress > 0.5 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10B981', fontSize: '12px', marginTop: '14px', fontWeight: 600 }}>
          <CheckCircle2 size={15} />
          <span>Autonomic recovery detected. Preparing to unlock...</span>
        </div>
      )}
    </div>
  );
};
