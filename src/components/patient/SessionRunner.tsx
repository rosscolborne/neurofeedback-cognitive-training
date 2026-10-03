import React, { useEffect, useRef, useState } from 'react';
import { ClientProfile, EEGDataPoint, ExperienceType, SessionRecord } from '../../types';
import { eegEngine, type DemoState } from '../../services/eegEngine';
import {
  NEUROGAMBIT_SESSION_SECONDS,
  advanceSessionClock,
  assessSessionCompletionReadiness,
  createSessionCompletionId,
  getCompletedSessionDuration,
} from '../../services/trainingSession';
import { audioEngine } from '../../services/audioEngine';
import { describeBrainFlowScore } from './trainingTelemetry';
import { NeuroGambitExperience } from '../experiences/NeuroGambitExperience';
import { HeadsetFitModal } from './HeadsetFitModal';
import { Play, Pause, Wifi, Volume2, VolumeX, Activity, Brain } from 'lucide-react';
import { EXPERIENCE_CATALOGUE } from './experienceCatalogue';

const MODALITY_BRIEFING_DATA: Record<ExperienceType, { title: string; instructions: string }> = {
  'neuro-gambit': {
    title: 'NeuroGambit',
    instructions: 'Hold your candidate piece for 1.2s to commit the move. Stay calm under clock pressure to slow the timer. When blundering, use the 4s/6s pacer to reset your composure.',
  }
};

const DEMO_STATES = [
  { id: 'focus', label: 'Focus' },
  { id: 'drift', label: 'Drift' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'calm', label: 'Calm' },
] as const satisfies ReadonlyArray<{ id: Exclude<DemoState, 'auto'>; label: string }>;

type DemoPreset = (typeof DEMO_STATES)[number]['id'];
const HARDWARE_SOURCE_MAX_AGE_MS = 2_000;

interface SessionRunnerProps {
  client: ClientProfile;
  selectedExperience: ExperienceType;
  onComplete: (summary: SessionRecord) => Promise<void>;
  onCancel: () => void;
}

export const resolveSessionCareProvenance = (client: ClientProfile): Pick<SessionRecord, 'clinicId' | 'clinicianId'> => {
  const clinicianId = client.clinicianId || client.linkedClinicianCode || undefined;
  return {
    // Legacy linked profiles can lack clinicId. Keep that provenance explicitly
    // unavailable instead of misclassifying a clinician-linked session as self-guided.
    clinicId: client.clinicId || (clinicianId ? '' : 'self-guided'),
    clinicianId,
  };
};

/** A headset frame counts as measured time only while new data is arriving from a connected headset. */
const hasLiveHeadsetFrame = (data: EEGDataPoint | null, lastCoveredSequence: number): boolean => {
  const sourceState = eegEngine.getHardwareSourceState();
  return Boolean(
    eegEngine.isHardwareConnected
    && data
    && data.signalQuality !== 'disconnected'
    && sourceState.sequence > lastCoveredSequence
    && Date.now() - sourceState.lastFrameAtMs <= HARDWARE_SOURCE_MAX_AGE_MS,
  );
};

export const SessionRunner: React.FC<SessionRunnerProps> = ({
  client,
  selectedExperience,
  onComplete,
  onCancel,
}) => {
  const [isDemoSession, setIsDemoSession] = useState(() => {
    // Patient Demo mode is owned by this mounted runner only. Never inherit the
    // singleton engine flag from a previous completed/cancelled session.
    eegEngine.isDemoMode = false;
    return false;
  });
  const [completionIdentity] = useState<{ id: string | null; error: string | null }>(() => {
    try {
      return { id: createSessionCompletionId(), error: null };
    } catch (error) {
      return {
        id: null,
        error: error instanceof Error ? error.message : 'Secure session completion IDs are unavailable.',
      };
    }
  });
  const [eegData, setEegData] = useState<EEGDataPoint | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);
  const completedSummaryRef = useRef<SessionRecord | null>(null);
  const savePendingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [acquisitionError, setAcquisitionError] = useState<string | null>(null);
  const [isFitAccepted, setIsFitAccepted] = useState(false);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [showFitModal, setShowFitModal] = useState(false);
  const [muted, setMuted] = useState(false);
  const [demoState, setDemoState] = useState<DemoPreset | null>(
    eegEngine.demoState === 'auto' ? null : eegEngine.demoState,
  );
  const mindfulness = describeBrainFlowScore(eegData, 'mindfulnessScore', isDemoSession);
  const restfulness = describeBrainFlowScore(eegData, 'restfulnessScore', isDemoSession);
  // Scores exist only from BrainFlow analysis (or simulated in Demo); a permanently empty slot adds noise.
  const showScore = (value: string) => isDemoSession || value !== 'Unavailable';

  // Timers (in seconds)
  const sessionTotalDuration = NEUROGAMBIT_SESSION_SECONDS;
  const [totalSecondsElapsed, setTotalSecondsElapsed] = useState(0);
  const totalSecondsElapsedRef = useRef(0);
  const measuredSecondsRef = useRef(0);

  const mindfulnessAccRef = useRef({ total: 0, count: 0 });
  const lastAccumulatedSourceSequenceRef = useRef(0);
  const lastCoveredSourceSequenceRef = useRef(0);
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  const isPausedRef = useRef(isPaused);
  const isSessionStartedRef = useRef(isSessionStarted);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    isSessionStartedRef.current = isSessionStarted;
  }, [isSessionStarted]);

  useEffect(() => {
    return () => {
      eegEngine.isDemoMode = false;
    };
  }, []);

  const cancelSession = React.useCallback(() => {
    eegEngine.isDemoMode = false;
    setIsDemoSession(false);
    onCancel();
  }, [onCancel]);

  const finishSession = React.useCallback(async (completedDurationSeconds?: number) => {
    if (isSavingSession || savePendingRef.current) return;
    setSaveError(null);
    const persistSummary = async (summary: SessionRecord) => {
      savePendingRef.current = true;
      setIsSavingSession(true);
      try {
        await onComplete(summary);
        eegEngine.isDemoMode = false;
        setIsDemoSession(false);
        audioEngine.playChime('complete');
      } catch (error) {
        console.error('Failed to save completed session:', error);
        setSaveError("We couldn't confirm this session was saved. Retry with the same session or check History after returning.");
        savePendingRef.current = false;
        setIsSavingSession(false);
      }
    };
    if (completedSummaryRef.current) {
      await persistSummary(completedSummaryRef.current);
      return;
    }

    const completedDuration = getCompletedSessionDuration(completedDurationSeconds, totalSecondsElapsedRef.current);
    const sourceState = eegEngine.getHardwareSourceState();
    const readiness = assessSessionCompletionReadiness({
      isDemo: isDemoSession,
      elapsedSeconds: completedDuration,
      measuredSeconds: measuredSecondsRef.current,
      hardwareConnected: eegEngine.isHardwareConnected,
      sourceFresh: isDemoSession || (
        sourceState.sequence > 0
        && Date.now() - sourceState.lastFrameAtMs <= HARDWARE_SOURCE_MAX_AGE_MS
      ),
    });
    if (!readiness.ok) {
      setSaveError(readiness.error);
      setAcquisitionError(readiness.error);
      setIsPaused(true);
      return;
    }
    if (!completionIdentity.id) {
      setSaveError(completionIdentity.error ?? 'This session cannot be saved securely.');
      return;
    }

    const careProvenance = resolveSessionCareProvenance(client);
    const mindfulnessAcc = mindfulnessAccRef.current;
    const summary: SessionRecord = {
      id: completionIdentity.id,
      patientId: client.id,
      patientName: client.name,
      ...careProvenance,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: Date.now(),
      experience: selectedExperience,
      durationSeconds: completedDuration,
      configuredDurationSeconds: sessionTotalDuration,
      isDemo: isDemoSession,
      // BrainFlow mindfulness only (simulated in Demo, which isDemo records).
      averageMindfulness: mindfulnessAcc.count > 0 ? Math.round(mindfulnessAcc.total / mindfulnessAcc.count) : undefined,
    };

    // Freeze evidence before invoking storage. An ambiguous save response must
    // retry the identical record.
    completedSummaryRef.current = summary;
    setIsSessionCompleted(true);
    setShowEndConfirm(true);
    await persistSummary(summary);
  }, [client, completionIdentity, isDemoSession, isSavingSession, onComplete, selectedExperience, sessionTotalDuration]);

  // Subscribe to the EEG stream (10 Hz)
  useEffect(() => {
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe(data => {
      eegDataRef.current = data;
      setEegData(data);
      const sourceState = eegEngine.getHardwareSourceState();
      const hasNewHardwareSourceFrame = isDemoSession || sourceState.sequence > lastAccumulatedSourceSequenceRef.current;
      if (!isDemoSession && hasNewHardwareSourceFrame) {
        lastAccumulatedSourceSequenceRef.current = sourceState.sequence;
      }

      // Average mindfulness over the session itself (not the fit check or
      // briefing before Begin Training), from new frames only
      const scores = data.brainflowScores;
      if (!isPausedRef.current && isSessionStartedRef.current && hasNewHardwareSourceFrame
        && scores?.method === (isDemoSession ? 'demo' : 'brainflow')
        && scores.mindfulnessScore != null && Number.isFinite(scores.mindfulnessScore)) {
        mindfulnessAccRef.current.total += scores.mindfulnessScore;
        mindfulnessAccRef.current.count += 1;
      }
    });

    return () => {
      unsubscribe();
      eegEngine.stop();
    };
  }, [isDemoSession]);

  // Main session timer interval
  useEffect(() => {
    if (isPaused || !isSessionStarted || isSessionCompleted) return;

    const interval = window.setInterval(() => {
      if (completedSummaryRef.current) return;
      const currentData = eegDataRef.current;
      const liveHeadsetFrame = hasLiveHeadsetFrame(currentData, lastCoveredSourceSequenceRef.current);
      if (!isDemoSession && !liveHeadsetFrame) {
        setAcquisitionError(
          eegEngine.isHardwareConnected
            ? 'Headset data has stopped. The session is paused until it returns.'
            : 'Your headset disconnected. The session is paused and cannot be saved until it reconnects.',
        );
        setIsPaused(true);
        return;
      }
      if (!isDemoSession) {
        lastCoveredSourceSequenceRef.current = eegEngine.getHardwareSourceState().sequence;
        measuredSecondsRef.current += 1;
      }

      const tick = advanceSessionClock(totalSecondsElapsedRef.current, sessionTotalDuration);
      totalSecondsElapsedRef.current = tick.elapsed;
      setTotalSecondsElapsed(tick.elapsed);
      // Read the final tick from refs after counting it; state updates are asynchronous.
      if (tick.complete) void finishSession(tick.elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [finishSession, isDemoSession, isPaused, isSessionCompleted, isSessionStarted, sessionTotalDuration]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioEngine.setMuted(next);
  };

  // Durations in a sentence read as words ("4 min 12 s"); the countdown keeps the m:ss clock format.
  const formatSpokenDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m === 0 ? `${s} s` : s === 0 ? `${m} min` : `${m} min ${s} s`;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const [isPairing, setIsPairing] = useState(false);
  const [, forceUpdate] = useState({});

  const handleConnectHardware = async () => {
    setIsPairing(true);
    const res = await eegEngine.connectMuseBluetooth();
    setIsPairing(false);
    forceUpdate({});
    if (res.success) {
      setShowFitModal(true);
    }
  };

  const handleStartDemoMode = () => {
    eegEngine.isDemoMode = true;
    setIsDemoSession(true);
    eegEngine.setSimulatedState('auto');
    setDemoState(null);
    setIsFitAccepted(true);
    setIsSessionStarted(true);
    forceUpdate({});
  };

  const toggleSessionPause = () => {
    if (!isPaused) {
      setIsPaused(true);
      return;
    }
    if (!isDemoSession && !hasLiveHeadsetFrame(eegDataRef.current, lastCoveredSourceSequenceRef.current)) {
      setAcquisitionError('Headset data is still unavailable. Check headset fit and connection before resuming.');
      return;
    }
    setAcquisitionError(null);
    setIsPaused(false);
  };

  if (completionIdentity.error) {
    return (
      <div style={{ padding: '32px', maxWidth: '520px', margin: '0 auto', textAlign: 'center' }} role="alert">
        <h1 style={{ fontSize: '22px' }}>Session unavailable</h1>
        <p>{completionIdentity.error}</p>
        <button className="btn btn-primary" onClick={cancelSession}>Return to dashboard</button>
      </div>
    );
  }

  // Connection Gate Screen
  if (!eegEngine.isHardwareConnected && !isDemoSession && !isSessionCompleted) {
    return (
      <div
        style={{
          width: '100%',
          height: '100vh',
          maxHeight: '100vh',
          maxWidth: '520px',
          margin: '0 auto',
          backgroundColor: 'var(--surface-patient-base)',
          padding: '24px',
          paddingTop: 'max(32px, env(safe-area-inset-top, 32px))',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '20px',
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: 'var(--brand-primary-subtle)',
            color: 'var(--brand-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Wifi size={36} />
        </div>

        <div>
          <h1 className="font-display" style={{ fontSize: '24px', fontWeight: 500, color: 'var(--text-primary)' }}>
            Connect Muse Headband
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px', maxWidth: '340px', lineHeight: 1.5 }}>
            Connect your Muse headband to begin real-time training.
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <button
            onClick={handleConnectHardware}
            disabled={isPairing}
            className="btn btn-primary"
            style={{ padding: '14px', fontSize: '14px' }}
          >
            {isPairing ? 'Connecting...' : 'Connect Muse Headband'}
          </button>

          {!isSessionStarted && (
            <button
              onClick={handleStartDemoMode}
              className="btn btn-secondary"
              style={{ padding: '12px', fontSize: '13px' }}
            >
              Try Demo Mode
            </button>
          )}

          {isSessionStarted && (
            <div role="alert" style={{ color: '#B91C1C', fontSize: '13px', lineHeight: 1.5 }}>
              Headset connection lost. Your session is paused — reconnect the headband to continue.
            </div>
          )}

          <button
            onClick={cancelSession}
            className="btn btn-ghost"
            style={{ padding: '10px', fontSize: '13px' }}
          >
            Cancel & Return to Dashboard
          </button>
        </div>

      </div>
    );
  }

  // Pre-session fit confirmation prompt if connected but not yet accepted
  if (eegEngine.isHardwareConnected && !isFitAccepted) {
    return (
      <HeadsetFitModal
        onConfirmReady={() => {
          setIsFitAccepted(true);
          setShowFitModal(false);
        }}
        onClose={cancelSession}
      />
    );
  }

  const remainingSeconds = Math.max(0, sessionTotalDuration - totalSecondsElapsed);
  const worstQuality = eegData?.signalQuality || 'good';

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        maxHeight: '100vh',
        maxWidth: '520px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 40px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Pre-Session Briefing Overlay */}
      {isFitAccepted && !isSessionStarted && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-patient-card)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.1)',
              padding: '28px 24px',
              width: '100%',
              maxWidth: '400px',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'var(--brand-primary-subtle)', color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Brain size={22} aria-hidden="true" />
              </div>
              <h2 className="font-display" style={{ fontSize: '24px', fontWeight: 400, lineHeight: 1.2, color: 'var(--text-primary)' }}>
                {EXPERIENCE_CATALOGUE[selectedExperience]?.name ?? 'Your session'}
              </h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.6, margin: 0 }}>
              {MODALITY_BRIEFING_DATA[selectedExperience]?.instructions || 'Follow the on-screen prompts.'}
            </p>

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '15px', fontSize: '16px', fontWeight: 600, marginTop: '28px' }}
              onClick={() => setIsSessionStarted(true)}
            >
              Begin Training
            </button>
          </div>
        </div>
      )}

      {/* Session Top Header */}
      <header
        style={{
          padding: '12px 18px',
          paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-patient-card)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {isPaused ? 'Paused' : 'Session'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', lineHeight: 1.1 }}>
              <span className="font-mono" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatTime(remainingSeconds)}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>left</span>
            </div>
          </div>
        </div>

        {/* Headband Hardware Telemetry & Audio Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={toggleMute} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          
          {/* Signal Quality & Headset Fit Button */}
          <button
            onClick={() => setShowFitModal(true)}
            style={{
              background: worstQuality === 'poor' ? '#FEE2E2' : worstQuality === 'fair' ? '#FEF3C7' : 'var(--surface-patient-recessed)',
              border: `1px solid ${worstQuality === 'poor' ? '#EF4444' : worstQuality === 'fair' ? '#F59E0B' : 'var(--border-subtle)'}`,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: worstQuality === 'poor' ? '#B91C1C' : worstQuality === 'fair' ? '#92400E' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            <Activity size={12} color={worstQuality === 'poor' ? '#EF4444' : worstQuality === 'fair' ? '#F59E0B' : '#10B981'} />
            <span>{eegEngine.isHardwareConnected ? (eegEngine.deviceName || 'Muse S') : 'Simulator'}</span>
          </button>
        </div>
      </header>

      {acquisitionError && (
        <div role="alert" style={{ padding: '8px 14px', color: '#B91C1C', background: '#FEE2E2', fontSize: '12px', lineHeight: 1.4 }}>
          {acquisitionError}
        </div>
      )}

      {/* Main Experience Viewport */}
      <main style={{ flex: 1, minHeight: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative' }}>
          {selectedExperience === 'neuro-gambit' && (
            <NeuroGambitExperience eegData={eegData} isPaused={isPaused} />
          )}
        </div>

        {isDemoSession && (
          <section
            aria-label="Demo state controls"
            className="card-patient-recessed"
            style={{ padding: '8px 10px', flexShrink: 0 }}
          >
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px' }}>
              Demo state
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
              {DEMO_STATES.map((state) => {
                const isActive = demoState === state.id;
                return (
                  <button
                    key={state.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      eegEngine.setSimulatedState(state.id);
                      setDemoState(state.id);
                    }}
                    style={{
                      border: `1px solid ${isActive ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--brand-primary)' : 'var(--surface-patient-card)',
                      color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                      padding: '7px 4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {state.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Live mindfulness and restfulness, when BrainFlow (or Demo Mode) provides them. */}
        {(showScore(mindfulness) || showScore(restfulness)) && (
          <div
            className="card-patient-recessed session-telemetry"
            style={{ padding: '8px 6px', flexShrink: 0 }}
          >
            {showScore(mindfulness) && (
              <div>
                <div className="session-telemetry-label">Mindfulness</div>
                <div className="session-telemetry-value font-mono">{mindfulness}</div>
                {isDemoSession && <div className="session-telemetry-note">Simulated</div>}
              </div>
            )}
            {showScore(restfulness) && (
              <div>
                <div className="session-telemetry-label">Restfulness</div>
                <div className="session-telemetry-value font-mono">{restfulness}</div>
                {isDemoSession && <div className="session-telemetry-note">Simulated</div>}
              </div>
            )}
          </div>
        )}

        {/* Headset signal in one quiet row; opens the fit check. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', padding: '0 4px', flexShrink: 0, minHeight: '32px' }}>
          <button
            type="button"
            onClick={() => setShowFitModal(true)}
            aria-label={`Headset signal: ${worstQuality}. Check headset fit`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '32px', padding: '4px 8px', border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            Signal
            <span aria-hidden="true" style={{ display: 'flex', gap: '3px' }}>
              {(['tp9', 'af7', 'af8', 'tp10'] as const).map((key) => {
                const quality = eegData?.channelQuality[key] || 'good';
                return <span key={key} style={{ width: '6px', height: '6px', borderRadius: '50%', background: quality === 'good' ? '#10B981' : quality === 'fair' ? '#F59E0B' : '#EF4444' }} />;
              })}
            </span>
          </button>
        </div>
      </main>

      {/* Session Footer Action Bar */}
      <footer
        style={{
          padding: '12px 18px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          background: 'var(--surface-patient-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        <button
          onClick={toggleSessionPause}
          className="btn btn-secondary"
          style={{ flex: 1, padding: '10px' }}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button
          onClick={() => setShowEndConfirm(true)}
          className="btn btn-primary"
          style={{ flex: 2, padding: '10px' }}
        >
          End Session & Save
        </button>
      </footer>

      {/* 4-Channel Headset Fit Modal */}
      {showFitModal && (
        <HeadsetFitModal
          onConfirmReady={() => {
            setIsFitAccepted(true);
            setShowFitModal(false);
          }}
          onClose={() => setShowFitModal(false)}
        />
      )}

      {/* End Session Confirmation Modal */}
      {showEndConfirm && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            background: 'rgba(26, 26, 26, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            className="card-patient"
            style={{
              width: '100%',
              maxWidth: '380px',
              backgroundColor: '#FFFFFF',
              borderRadius: 'var(--radius-lg)',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <h3 className="font-display" style={{ fontSize: '22px', fontWeight: 400, marginBottom: '8px' }}>
              End this session?
            </h3>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: '20px' }}>
              You trained for {formatSpokenDuration(totalSecondsElapsed)}.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => void finishSession()}
                disabled={isSavingSession}
                className="btn btn-primary"
                style={{ width: '100%', opacity: isSavingSession ? 0.7 : 1 }}
              >
                {isSavingSession ? 'Saving Session...' : 'Save & View Summary'}
              </button>
              {!isSessionCompleted && (
                <button
                  onClick={() => setShowEndConfirm(false)}
                  disabled={isSavingSession}
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                >
                  Continue Training
                </button>
              )}
              <button
                onClick={cancelSession}
                disabled={isSavingSession}
                className="btn btn-ghost"
                style={{ width: '100%', color: '#D32F2F' }}
              >
                {isSessionCompleted ? 'Return to Dashboard' : 'Exit Without Saving'}
              </button>
              {saveError && (
                <div
                  role="alert"
                  style={{
                    color: '#D32F2F',
                    background: '#FF4C4C15',
                    border: '1px solid rgba(211, 47, 47, 0.2)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    fontSize: '13px',
                    lineHeight: 1.4,
                  }}
                >
                  {saveError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
