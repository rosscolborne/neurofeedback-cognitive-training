import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { EEGDataPoint, IndividualBaselineModel } from '../../types';
import { eegEngine } from '../../services/eegEngine';
import { storageEngine } from '../../services/storageEngine';
import { getCalibrationDisplayState, timestampToMillis } from '../../services/dataMappers';
import { useAuth } from '../../contexts/AuthContext';
import { NeuroGambitTrack, NeuroGambitBaseline, NGIScore } from './types';
import { toBrainStateEvent, createDefaultBaseline, getNeuroGambitBaseline } from './services/eegAdapter';
import { useNeuroGambitEngine } from './hooks/useNeuroGambitEngine';
import { useVagalRecoveryGate } from './hooks/useVagalRecoveryGate';
import { ChessboardView } from './components/ChessboardView';
import { PeripheralAmbientGlow } from './components/PeripheralAmbientGlow';
import { TimeDilationClock } from './components/TimeDilationClock';
import { VagalBreathingPacer } from './components/VagalBreathingPacer';
import { BaselineCalibrationModal } from './components/BaselineCalibrationModal';
import { SessionSummaryModal } from './components/SessionSummaryModal';
import { Crown, Zap, Shield, RotateCcw, Activity, Info } from 'lucide-react';

interface NeuroGambitContainerProps {
  eegData: EEGDataPoint | null;
  onComplete?: (summary: any) => void;
  isPaused?: boolean;
  isDemoSession?: boolean;
  patientId: string;
  savedBaselineModel?: IndividualBaselineModel;
  onBaselinePersisted: (model: IndividualBaselineModel) => void;
}

export const NeuroGambitContainer: React.FC<NeuroGambitContainerProps> = ({
  eegData,
  onComplete,
  isDemoSession = false,
  patientId,
  savedBaselineModel,
  onBaselinePersisted,
}) => {
  const { user, role } = useAuth();
  const identity = `${user?.uid ?? 'signed-out'}:${role ?? 'no-role'}:${patientId}:${isDemoSession ? 'demo-session' : 'measured-session'}`;
  const identityRef = useRef(identity);
  useLayoutEffect(() => { identityRef.current = identity; }, [identity]);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [selectedTrack, setSelectedTrack] = useState<NeuroGambitTrack>('composed-tactics');
  const [showHowTo, setShowHowTo] = useState(false);
  const [sessionBaseline, setSessionBaseline] = useState<{ identity: string; value: NeuroGambitBaseline } | null>(null);
  const [calibrationPrompt, setCalibrationPrompt] = useState<{ identity: string; open: boolean } | null>(null);
  const [completedSummary, setCompletedSummary] = useState<NGIScore | null>(null);
  const [expiryPulse, setExpiryPulse] = useState(0);
  const savedModelExpired = getCalibrationDisplayState(savedBaselineModel).status === 'expired';
  const savedBaseline = useMemo(() => isDemoSession || savedModelExpired ? null : getNeuroGambitBaseline(savedBaselineModel), [isDemoSession, savedBaselineModel, savedModelExpired]);
  const baseline = sessionBaseline?.identity === identity ? sessionBaseline.value : savedBaseline;
  const showCalibration = calibrationPrompt?.identity === identity ? calibrationPrompt.open : !baseline;

  useEffect(() => {
    if (isDemoSession || savedBaselineModel?.expiresAt == null) return;
    let expiresAt: number | null = null;
    try { expiresAt = timestampToMillis(savedBaselineModel.expiresAt); } catch { /* Invalid persisted timestamp. */ }
    if (expiresAt == null) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      if (eegEngine.individualBaselineModel === savedBaselineModel) eegEngine.individualBaselineModel = null;
      // Expiry may cross after render but before this effect runs. Wake the
      // mounted view once; a render that already saw expiry needs no pulse.
      if (!savedModelExpired) setExpiryPulse((current) => current + 1);
      return;
    }
    const timeout = setTimeout(() => {
      if (eegEngine.individualBaselineModel === savedBaselineModel) eegEngine.individualBaselineModel = null;
      setExpiryPulse((current) => current + 1);
    }, Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timeout);
  }, [expiryPulse, isDemoSession, savedBaselineModel, savedModelExpired]);

  const handleBaselineReady = useCallback(async (calibrated: NeuroGambitBaseline, model: IndividualBaselineModel) => {
    if (isDemoSession) {
      setSessionBaseline({ identity, value: calibrated });
      setCalibrationPrompt({ identity, open: false });
      return;
    }
    if (!user || role !== 'patient') throw new Error('Sign in as a patient before saving this calibration.');
    const requestIdentity = identity;
    const client = await storageEngine.getExistingCurrentClient(user);
    if (!mountedRef.current || identityRef.current !== requestIdentity) throw new Error('The account changed before calibration could be saved.');
    if (!client || client.id !== patientId) throw new Error('Your patient profile is unavailable.');
    await storageEngine.saveIndividualBaselineModel(client.id, model);
    if (!mountedRef.current || identityRef.current !== requestIdentity) throw new Error('The account changed before calibration could be applied.');
    eegEngine.individualBaselineModel = model;
    onBaselinePersisted(model);
    setSessionBaseline({ identity, value: calibrated });
    setCalibrationPrompt({ identity, open: false });
  }, [identity, isDemoSession, onBaselinePersisted, patientId, role, user]);

  const handleSkipCalibration = useCallback(() => {
    setSessionBaseline({ identity, value: createDefaultBaseline() });
    setCalibrationPrompt({ identity, open: false });
  }, [identity]);

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
        gap: '10px',
        position: 'relative',
      }}
    >
      {/* 15s Baseline Calibration Modal */}
      {showCalibration && (
        <BaselineCalibrationModal
          key={identity}
          eegData={eegData}
          onBaselineReady={handleBaselineReady}
          onSkip={handleSkipCalibration}
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

      {/* Track selector: one full-width segmented control that stays on one line on phones. */}
      <div role="group" aria-label="Training track" className="ng-tracks">
        {([
          { id: 'composed-tactics' as const, label: 'Composed Tactics', full: 'Track A: Composed Tactics', Icon: Crown, color: 'var(--brand-primary, #E8967A)' },
          { id: 'tilt-crucible' as const, label: 'Tilt Crucible', full: 'Track B: Tilt Crucible', Icon: Shield, color: '#7B68AE' },
        ]).map(({ id, label, full, Icon, color }) => {
          const active = selectedTrack === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-label={full}
              onClick={() => handleTrackChange(id)}
              style={{
                backgroundColor: active ? 'var(--surface-patient-card, #FFFFFF)' : 'transparent',
                color: active ? color : 'var(--text-secondary, #6B6560)',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <TimeDilationClock
        secondsRemaining={clockSecondsRemaining}
        clockRate={clockRate}
        totalSeconds={120}
      />

      {/* Current puzzle and composure: the state the player needs before looking at the board. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '0 2px' }}>
        <div style={{ minWidth: 0, fontSize: '12px', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${activePuzzle.title} (${activePuzzle.theme})`}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Puzzle {puzzleIndex + 1}/{totalPuzzles}</span>
          <span style={{ color: 'var(--text-secondary)' }}> · {activePuzzle.title}</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
            padding: '4px 9px',
            borderRadius: '999px',
            backgroundColor: brainState.normalizedComposure >= 1.0 ? 'rgba(92, 140, 70, 0.14)' : 'rgba(239, 68, 68, 0.12)',
            color: brainState.normalizedComposure >= 1.0 ? '#4E7A3B' : '#B91C1C',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          <Activity size={12} aria-hidden="true" />
          <span>Composure {brainState.normalizedComposure.toFixed(2)}×</span>
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
      {/* Size the board to the space left under the HUD so the bottom ranks are never clipped. */}
      <div style={{ flex: '1 1 0', minHeight: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', containerType: 'size' }}>
        <PeripheralAmbientGlow
          normalizedComposure={brainState.normalizedComposure}
          isClenching={brainState.isClenching}
        >
          <div style={{ position: 'relative', width: 'min(calc(100cqw - 6px), calc(100cqh - 6px), 460px)' }}>
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

      {/* Secondary controls sit below the board so they never compete with it. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0 4px' }}>
        <div style={{ display: 'flex', gap: '0' }}>
          <button type="button" className="ng-quiet-action" onClick={() => setCalibrationPrompt({ identity, open: true })}>
            <RotateCcw size={13} aria-hidden="true" />
            Calibrate
          </button>
          <button type="button" className="ng-quiet-action" aria-expanded={showHowTo} onClick={() => setShowHowTo((open) => !open)}>
            <Info size={13} aria-hidden="true" />
            How to play
          </button>
        </div>
        <button type="button" className="ng-quiet-action" style={{ color: 'var(--brand-primary)' }} onClick={() => finishSession()}>
          Complete Session
        </button>
      </div>

      {showHowTo && (
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
            borderRadius: '10px',
            border: '1px solid var(--border-default)',
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <Zap size={14} color="var(--brand-primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            {selectedTrack === 'composed-tactics'
              ? 'Hold your first move for 1.2 seconds while staying composed to confirm it. Later moves play instantly.'
              : 'After a sudden blunder, breathe with the 4s in / 6s out pacer. The board unlocks once your composure recovers.'}
          </span>
        </div>
      )}
    </div>
  );
};
