import React, { useState, useMemo } from 'react';
import { EEGDataPoint } from '../../types';
import { NeuroGambitTrack, NeuroGambitBaseline, NGIScore } from './types';
import { toBrainStateEvent, createDefaultBaseline } from './services/eegAdapter';
import { useNeuroGambitEngine } from './hooks/useNeuroGambitEngine';
import { useVagalRecoveryGate } from './hooks/useVagalRecoveryGate';
import { ChessboardView } from './components/ChessboardView';
import { PeripheralAmbientGlow } from './components/PeripheralAmbientGlow';
import { TimeDilationClock } from './components/TimeDilationClock';
import { VagalBreathingPacer } from './components/VagalBreathingPacer';
import { BaselineCalibrationModal } from './components/BaselineCalibrationModal';
import { SessionSummaryModal } from './components/SessionSummaryModal';
import { Crown, Zap, Shield, RotateCcw, Activity } from 'lucide-react';

interface NeuroGambitContainerProps {
  eegData: EEGDataPoint | null;
  onComplete?: (summary: any) => void;
  isPaused?: boolean;
}

export const NeuroGambitContainer: React.FC<NeuroGambitContainerProps> = ({
  eegData,
  onComplete,
}) => {
  const [selectedTrack, setSelectedTrack] = useState<NeuroGambitTrack>('composed-tactics');
  const [baseline, setBaseline] = useState<NeuroGambitBaseline | null>(null);
  const [showCalibration, setShowCalibration] = useState<boolean>(true);
  const [completedSummary, setCompletedSummary] = useState<NGIScore | null>(null);

  // Convert raw EEG data point to clean BrainStateEvent
  const brainState = useMemo(() => {
    return toBrainStateEvent(eegData, baseline);
  }, [eegData, baseline]);

  // Main Chess FSM Engine
  const {
    activePuzzle,
    puzzleIndex,
    totalPuzzles,
    chess,
    selectedSquare,
    legalMoves,
    chargeState,
    isBoardLockedForBreaker,
    clockSecondsRemaining,
    clockRate,
    feedbackBanner,
    handleSquareClick,
    cancelCharge,
    handleCircuitBreakerUnlock,
    finishSession,
  } = useNeuroGambitEngine({
    track: selectedTrack,
    brainState,
    onSessionComplete: (score) => {
      setCompletedSummary(score);
      if (onComplete) {
        onComplete(score);
      }
    },
  });

  // Dynamic Vagal Circuit Breaker for Track B
  const {
    elapsedSeconds,
    pacerPhase,
    pacerProgress,
    recoveryProgress,
    startCircuitBreaker,
    resetCircuitBreaker,
  } = useVagalRecoveryGate(brainState, {
    onUnlock: (latency) => {
      handleCircuitBreakerUnlock(latency);
    },
  });

  // Start circuit breaker when engine locks board for Track B
  React.useEffect(() => {
    if (isBoardLockedForBreaker) {
      startCircuitBreaker();
    } else {
      resetCircuitBreaker();
    }
  }, [isBoardLockedForBreaker, startCircuitBreaker, resetCircuitBreaker]);

  const handleTrackChange = (newTrack: NeuroGambitTrack) => {
    if (newTrack !== selectedTrack) {
      cancelCharge();
      setSelectedTrack(newTrack);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--surface-patient-base, #F8F7F4)',
        padding: '12px 16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
        gap: '12px',
        position: 'relative',
      }}
    >
      {/* 15s Baseline Calibration Modal */}
      {showCalibration && (
        <BaselineCalibrationModal
          eegData={eegData}
          onBaselineReady={(calibrated) => {
            setBaseline(calibrated);
            setShowCalibration(false);
          }}
          onSkip={() => {
            setBaseline(createDefaultBaseline());
            setShowCalibration(false);
          }}
        />
      )}

      {/* End of Session Summary Modal */}
      {completedSummary && (
        <SessionSummaryModal
          score={completedSummary}
          track={selectedTrack}
          onRestart={() => setCompletedSummary(null)}
          onFinish={() => {
            if (onComplete) onComplete(completedSummary);
          }}
        />
      )}

      {/* Top Header: Track Selector & Live Neuro Telemetry */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {/* Track Pills */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--surface-patient-recessed, #F2F1EE)',
            padding: '3px',
            borderRadius: '10px',
            gap: '2px',
          }}
        >
          <button
            onClick={() => handleTrackChange('composed-tactics')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: selectedTrack === 'composed-tactics' ? 'var(--surface-patient-card, #FFFFFF)' : 'transparent',
              color: selectedTrack === 'composed-tactics' ? 'var(--brand-primary, #E8967A)' : 'var(--text-secondary, #6B6560)',
              boxShadow: selectedTrack === 'composed-tactics' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <Crown size={14} />
            <span>Track A: Composed Tactics</span>
          </button>

          <button
            onClick={() => handleTrackChange('tilt-crucible')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: selectedTrack === 'tilt-crucible' ? 'var(--surface-patient-card, #FFFFFF)' : 'transparent',
              color: selectedTrack === 'tilt-crucible' ? '#7B68AE' : 'var(--text-secondary, #6B6560)',
              boxShadow: selectedTrack === 'tilt-crucible' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            <Shield size={14} />
            <span>Track B: Tilt Crucible</span>
          </button>
        </div>

        {/* Live Muse Telemetry Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '6px',
              backgroundColor: brainState.normalizedComposure >= 1.0 ? 'rgba(92, 140, 70, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: brainState.normalizedComposure >= 1.0 ? '#5C8C46' : '#EF4444',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            <Activity size={12} />
            <span>Composure: {brainState.normalizedComposure.toFixed(2)}x</span>
          </div>

          <button
            onClick={() => setShowCalibration(true)}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--border-default)',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RotateCcw size={10} />
            <span>Calibrate</span>
          </button>
        </div>
      </div>

      {/* Clock and Puzzle Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <TimeDilationClock
          secondsRemaining={clockSecondsRemaining}
          clockRate={clockRate}
          totalSeconds={120}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
          <div>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Puzzle {puzzleIndex + 1} of {totalPuzzles}:
            </span>{' '}
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {activePuzzle.title} ({activePuzzle.theme})
            </span>
          </div>

          <button
            onClick={() => finishSession()}
            style={{
              fontSize: '11px',
              color: 'var(--brand-primary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Complete Session
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: feedbackBanner.type === 'error' ? '#FEE2E2' : feedbackBanner.type === 'success' ? '#ECFDF5' : '#FEF3C7',
            color: feedbackBanner.type === 'error' ? '#B91C1C' : feedbackBanner.type === 'success' ? '#047857' : '#92400E',
            border: `1px solid ${feedbackBanner.type === 'error' ? '#EF4444' : feedbackBanner.type === 'success' ? '#10B981' : '#F59E0B'}`,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <span>{feedbackBanner.text}</span>
        </div>
      )}

      {/* Primary Chessboard with Peripheral Glow */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <PeripheralAmbientGlow
          normalizedComposure={brainState.normalizedComposure}
          isClenching={brainState.isClenching}
        >
          <div style={{ position: 'relative' }}>
            <ChessboardView
              chess={chess}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              chargeState={chargeState}
              isComposed={brainState.normalizedComposure >= 0.9}
              onSquareClick={handleSquareClick}
              orientation={activePuzzle.playerColor}
            />

            {/* Overlaid Dynamic Vagal Circuit Breaker during Track B shock event */}
            {isBoardLockedForBreaker && (
              <VagalBreathingPacer
                elapsedSeconds={elapsedSeconds}
                pacerPhase={pacerPhase}
                pacerProgress={pacerProgress}
                recoveryProgress={recoveryProgress}
                brainState={brainState}
                minDuration={6.0}
              />
            )}
          </div>
        </PeripheralAmbientGlow>
      </div>

      {/* Bottom Educational / Tactical Instructions */}
      <div
        style={{
          padding: '8px 12px',
          backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
          borderRadius: '10px',
          border: '1px solid var(--border-default)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Zap size={14} color="var(--brand-primary)" />
        <span>
          {selectedTrack === 'composed-tactics'
            ? 'Move 1 requires a 1.2s Composure Hold to verify candidate moves. Subsequent plies execute instantly.'
            : 'When a sudden blunder occurs, breathe in cadence with the 4s/6s pacer. Board unlocks once composure recovers.'}
        </span>
      </div>
    </div>
  );
};
