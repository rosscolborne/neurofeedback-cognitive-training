import React, { useEffect, useRef, useState } from 'react';
import { ClientProfile, EEGDataPoint, ExperienceType, IndividualBaselineModel, SessionPhase, SessionRecord } from '../../types';
import { eegEngine } from '../../services/eegEngine';
import {
  AdaptiveDifficultyEngine,
  AdaptiveAdjustmentLog,
  accumulateVerifiedBands,
  advanceSessionClock,
  assessSessionCompletionReadiness,
  createSessionCompletionId,
  createVerifiedBandAccumulator,
  getCompletedSessionDuration,
  resolveProtocolRuntime,
  summarizeVerifiedBands,
} from '../../services/adaptiveEngine';
import { audioEngine } from '../../services/audioEngine';
import { calculateRecentInZonePercent, type InZoneObservation } from '../../services/inZoneMetric';
import { describeActiveReward, describeBrainFlowScore } from './trainingTelemetry';
import { NeuroGambitExperience } from '../experiences/NeuroGambitExperience';
import { HeadsetFitModal } from './HeadsetFitModal';
import { Play, Pause, Wifi, Volume2, VolumeX, Activity, Brain } from 'lucide-react';
import { EXPERIENCE_CATALOGUE } from './experienceCatalogue';

const MODALITY_BRIEFING_DATA: Record<ExperienceType, { title: string; mechanism: string; benefit: string; instructions: string }> = {
  'neuro-gambit': {
    title: 'NeuroGambit',
    mechanism: 'Tracks Frontal Midline Theta (AF7/AF8) for deep calculation, down-trains Frontal High-Beta under clock stress, and conditions Temporoparietal Alpha (TP9/TP10) for post-blunder recovery.',
    benefit: 'Eliminates impulsive blitz blunders, halts post-blunder tilt cascades, and trains deep tactical stamina under tournament clock pressure.',
    instructions: 'Hold your candidate piece for 1.2s to commit the move. Stay calm under clock pressure to slow the timer. When blundering, use the 4s/6s pacer to reset your baseline.',
  }
};

const DEMO_STATES = [
  { id: 'focus', label: 'Focus' },
  { id: 'drift', label: 'Drift' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'calm', label: 'Calm' },
] as const;

type DemoState = (typeof DEMO_STATES)[number]['id'];
const RECENT_IN_ZONE_WINDOW_SECONDS = 10;

/** Keeps each frequency range whole, so a narrow telemetry cell breaks "BETA / (13–30 Hz)", never "BETA (13–30 / Hz)". */
function telemetryLabel(label: string | undefined): React.ReactNode {
  const open = label?.indexOf(' (') ?? -1;
  if (!label || open < 0) return label;
  return <>{label.slice(0, open)} {label.slice(open + 1).split(' / ').map((range, index) => (
    <React.Fragment key={index}>{index > 0 && ' / '}<span className="session-telemetry-group">{range}</span></React.Fragment>
  ))}</>;
}
const HARDWARE_SOURCE_MAX_AGE_MS = 2_000;
interface SessionRunnerProps {
  client: ClientProfile;
  onBaselinePersisted?: (model: IndividualBaselineModel) => void;
  selectedExperience: ExperienceType;
  onComplete: (summary: SessionRecord) => Promise<void>;
  onCancel: () => void;
}

export const SessionRunner: React.FC<SessionRunnerProps> = ({
  client,
  onBaselinePersisted,
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
  const [phase, setPhase] = useState<SessionPhase>('calibration');
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
  const [adjustmentNotice, setAdjustmentNotice] = useState<AdaptiveAdjustmentLog | null>(null);
  const [demoState, setDemoState] = useState<DemoState | null>(
    eegEngine.demoState === 'auto' ? null : eegEngine.demoState,
  );
  const runtimeResolution = React.useMemo(() => resolveProtocolRuntime(client), [client]);
  const runtimeConfig = runtimeResolution.ok ? runtimeResolution.config : null;
  const activeReward = runtimeConfig ? describeActiveReward(runtimeConfig, eegData) : null;
  const mindfulness = describeBrainFlowScore(eegData, 'mindfulnessScore', isDemoSession);
  const restfulness = describeBrainFlowScore(eegData, 'restfulnessScore', isDemoSession);
  // Scores exist only from BrainFlow analysis (or simulated in Demo); a permanently empty slot adds noise.
  const showScore = (value: string) => isDemoSession || value !== 'Unavailable';

  // Timers (in seconds)
  const sessionTotalDuration = runtimeConfig?.durationSeconds ?? 0;
  const [totalSecondsElapsed, setTotalSecondsElapsed] = useState(0);
  const totalSecondsElapsedRef = useRef(0);
  const [inZoneSeconds, setInZoneSeconds] = useState(0);
  const inZoneSecondsRef = useRef(0);
  const inZoneMeasuredSecondsRef = useRef(0);

  const [adaptiveEngine] = useState<AdaptiveDifficultyEngine | null>(() => runtimeConfig
    ? new AdaptiveDifficultyEngine(runtimeConfig.protocol, runtimeConfig.initialThreshold, runtimeConfig)
    : null);
  const timeSeriesRef = useRef<SessionRecord['timeSeries']>([]);
  const bandAccumulatorRef = useRef(createVerifiedBandAccumulator());
  const coherenceAccumulatorRef = useRef({ total: 0, count: 0 });
  const brainflowAccRef = useRef({
    mindfulness: 0,
    mindfulnessCount: 0,
    valence: 0,
    valenceCount: 0,
    arousal: 0,
    arousalCount: 0,
    training: 0,
    trainingCount: 0,
  });
  const peakTrainingScoreRef = useRef<number | null>(null);
  const lastAccumulatedSourceSequenceRef = useRef(0);
  const lastCoveredSourceSequenceRef = useRef(0);
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  const inZoneObservationsRef = useRef<InZoneObservation[]>([]);
  const [recentInZonePercent, setRecentInZonePercent] = useState<number | null>(null);
  const isPausedRef = useRef(isPaused);
  const phaseRef = useRef(phase);

  useEffect(() => {
    isPausedRef.current = isPaused;
    if (isPaused) {
      // A pause is not measured training time. Start a fresh trailing window
      // on resume so the preceding state cannot span the pause.
      inZoneObservationsRef.current = [];
      setRecentInZonePercent(null);
    }
  }, [isPaused]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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
    if (!runtimeConfig || !adaptiveEngine) {
      setSaveError('A valid training protocol is required before this session can be saved.');
      return;
    }

    const completedDuration = getCompletedSessionDuration(completedDurationSeconds, totalSecondsElapsedRef.current);
    const completedInZoneSeconds = Math.max(0, Math.min(inZoneSecondsRef.current, completedDuration, runtimeConfig.durationSeconds));
    const completedMeasuredSeconds = inZoneMeasuredSecondsRef.current;
    const sourceState = eegEngine.getHardwareSourceState();
    const readiness = assessSessionCompletionReadiness({
      isDemo: isDemoSession,
      elapsedSeconds: completedDuration,
      verifiedSeconds: completedMeasuredSeconds,
      verifiedBandSamples: bandAccumulatorRef.current.sampleCount,
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

    const totalTrainTime = Math.max(1, completedMeasuredSeconds);
    const timeInZonePercent = completedMeasuredSeconds > 0
      ? Math.min(100, Math.round((inZoneSecondsRef.current / totalTrainTime) * 100)) : 0;
    const bandSummary = summarizeVerifiedBands(bandAccumulatorRef.current);

    const bfAcc = brainflowAccRef.current;
    const summary: SessionRecord = {
      id: completionIdentity.id,
      patientId: client.id,
      patientName: client.name,
      clinicId: 'self-guided',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: Date.now(),
      protocol: runtimeConfig.protocol,
      experience: selectedExperience,
      durationSeconds: completedDuration,
      timeInZonePercent,
      inZoneSeconds: completedInZoneSeconds,
      configuredDurationSeconds: runtimeConfig.durationSeconds,
      averageCoherence: coherenceAccumulatorRef.current.count > 0
        ? Math.round(coherenceAccumulatorRef.current.total / coherenceAccumulatorRef.current.count)
        : null,
      peakFocusScore: peakTrainingScoreRef.current == null
        ? undefined
        : Math.round(peakTrainingScoreRef.current),
      averageBands: bandSummary.bands,
      timeSeries: timeSeriesRef.current, // Real recorded data only — no fabricated fallbacks
      adaptiveAdjustmentsCount: adaptiveEngine.getAdjustmentsCount(),
      finalThreshold: adaptiveEngine.getCurrentThreshold(),
      isDemo: isDemoSession,
      averageTrainingScore: bfAcc.trainingCount > 0 ? Math.round(bfAcc.training / bfAcc.trainingCount) : null,
      averageMindfulness: bfAcc.mindfulnessCount > 0 ? Math.round(bfAcc.mindfulness / bfAcc.mindfulnessCount) : undefined,
      averageValence: bfAcc.valenceCount > 0 ? Math.round((bfAcc.valence / bfAcc.valenceCount) * 100) / 100 : undefined,
      averageArousal: bfAcc.arousalCount > 0 ? Math.round((bfAcc.arousal / bfAcc.arousalCount) * 100) / 100 : undefined,
      metricProvenance: bandSummary.provenance
        ? { averageBands: bandSummary.provenance }
        : undefined,
    };

    // Freeze evidence before invoking storage. An ambiguous save response must
    // retry the identical record and the clock must not change its XP.
    completedSummaryRef.current = summary;
    setIsSessionCompleted(true);
    setShowEndConfirm(true);
    await persistSummary(summary);
  }, [adaptiveEngine, client, completionIdentity, isDemoSession, isSavingSession, onComplete, runtimeConfig, selectedExperience]);

  // Subscribe to high-frequency EEG data stream (10 Hz)
  useEffect(() => {
    if (!runtimeConfig) return;
    eegEngine.configureProtocol(runtimeConfig);
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe(data => {
      eegDataRef.current = data;
      setEegData(data);
      const sourceState = eegEngine.getHardwareSourceState();
      const hasNewHardwareSourceFrame = isDemoSession || sourceState.sequence > lastAccumulatedSourceSequenceRef.current;
      if (!isDemoSession && hasNewHardwareSourceFrame) {
        lastAccumulatedSourceSequenceRef.current = sourceState.sequence;
      }

      // Recent in-zone is a live trailing metric. Calibration observations are
      // valid EEG feedback too, so begin its window as soon as fit is accepted
      // rather than holding the display and experience feedback for one minute.
      if (!isPausedRef.current && (isFitAccepted || eegEngine.isHardwareConnected || isDemoSession)) {
        const observations = inZoneObservationsRef.current;
        observations.push({
          timestamp: data.timestamp,
          inZone: data.inZone,
          available: data.inZoneAvailable,
        });
        const oldestTimestamp = data.timestamp - (RECENT_IN_ZONE_WINDOW_SECONDS + 5) * 1_000;
        while (observations.length > 1 && observations[1].timestamp < oldestTimestamp) {
          observations.shift();
        }
        setRecentInZonePercent(
          calculateRecentInZonePercent(observations, data.timestamp, RECENT_IN_ZONE_WINDOW_SECONDS).percent,
        );
      }

      // The training score owns its own 24-window baseline. The app leaves
      // the other derived metrics raw unless a future view explicitly opts a
      // metric into the service's per-metric calibration.
      if (!isPausedRef.current && isFitAccepted && data.trainingMetric?.score != null) {
        const bfAcc = brainflowAccRef.current;
        bfAcc.training += data.trainingMetric.score;
        bfAcc.trainingCount += 1;
        peakTrainingScoreRef.current = Math.max(peakTrainingScoreRef.current ?? data.trainingMetric.score, data.trainingMetric.score);
      }

      if (!isPausedRef.current && isFitAccepted && phaseRef.current !== 'calibration' && hasNewHardwareSourceFrame) {
        // Collect rolling band averages
        accumulateVerifiedBands(
          bandAccumulatorRef.current,
          data.bands,
          data.bandAvailability,
          eegEngine.getBandPowerProvenance(),
        );
        if (data.coherenceAvailable && data.coherence != null) {
          coherenceAccumulatorRef.current.total += data.coherence;
          coherenceAccumulatorRef.current.count += 1;
        }
        // Accumulate brainflow service metrics
        if (data.brainflowScores) {
          const bfAcc = brainflowAccRef.current;
          if (data.brainflowScores.mindfulnessScore != null) {
            bfAcc.mindfulness += data.brainflowScores.mindfulnessScore;
            bfAcc.mindfulnessCount += 1;
          }
          if (data.brainflowScores.valence != null) {
            bfAcc.valence += data.brainflowScores.valence;
            bfAcc.valenceCount += 1;
          }
          if (data.brainflowScores.arousal != null) {
            bfAcc.arousal += data.brainflowScores.arousal;
            bfAcc.arousalCount += 1;
          }
        }

        // Feed adaptive difficulty engine during Core Training
        if (phaseRef.current === 'training' && data.inZoneAvailable) {
          const result = adaptiveEngine?.addSample(data.inZone);
          if (result?.adjusted && result.log) {
            eegEngine.setThreshold(result.log.newThreshold);
            setAdjustmentNotice(result.log);
            setTimeout(() => setAdjustmentNotice(null), 5000);
          }
        }
      }
    });

    return () => {
      unsubscribe();
      eegEngine.stop();
    };
  }, [adaptiveEngine, isDemoSession, isFitAccepted, runtimeConfig]);

  // Main session timer interval
  useEffect(() => {
    if (isPaused || !isSessionStarted || !runtimeConfig || isSessionCompleted) return;

    const interval = window.setInterval(() => {
      if (completedSummaryRef.current) return;
      const currentData = eegDataRef.current;
      const bandProvenance = eegEngine.getBandPowerProvenance();
      const sourceState = eegEngine.getHardwareSourceState();
      const sourceAdvanced = sourceState.sequence > lastCoveredSourceSequenceRef.current;
      const sourceFresh = sourceState.sequence > 0
        && sourceAdvanced
        && Date.now() - sourceState.lastFrameAtMs <= HARDWARE_SOURCE_MAX_AGE_MS;
      const hasVerifiedHardwareFrame = Boolean(
        currentData?.inZoneAvailable
        && currentData.signalQuality !== 'disconnected'
        && bandProvenance
        && sourceFresh
        && (Object.keys(bandAccumulatorRef.current.sums) as Array<keyof typeof bandAccumulatorRef.current.sums>)
          .every((band) => currentData.bandAvailability[band] && Number.isFinite(currentData.bands[band])),
      );
      if (!isDemoSession && (!eegEngine.isHardwareConnected || !hasVerifiedHardwareFrame)) {
        setAcquisitionError(
          eegEngine.isHardwareConnected
            ? 'Verified EEG is unavailable. Training is paused until a valid signal returns.'
            : 'Your headset disconnected. Training is paused and cannot be saved until it reconnects.',
        );
        setIsPaused(true);
        return;
      }
      if (!isDemoSession) lastCoveredSourceSequenceRef.current = sourceState.sequence;

      const tick = advanceSessionClock(totalSecondsElapsedRef.current, sessionTotalDuration, isDemoSession);
      totalSecondsElapsedRef.current = tick.elapsed;
      setTotalSecondsElapsed(tick.elapsed);
      if (tick.phase !== 'complete' && tick.phase !== phaseRef.current) {
        if (tick.phase === 'warmup') audioEngine.playChime('success');
        setPhase(tick.phase);
      }

      // Periodic time-series capture every 10 seconds
      if (tick.elapsed % 10 === 0 && currentData && (isDemoSession || hasVerifiedHardwareFrame)) {
        timeSeriesRef.current.push({
          t: tick.elapsed,
          thetaBetaRatio: currentData.thetaBetaRatio,
          alpha: currentData.bands.alpha,
          smr: currentData.bands.smr,
          beta: currentData.bands.beta,
          inZone: currentData.inZone,
        });
      }

      // The live in-zone display should reflect every valid observation as
      // soon as a session begins. Calibration is real EEG data too; only an
      // unavailable protocol metric should keep this value indeterminate.
      if (currentData?.inZoneAvailable) {
        inZoneMeasuredSecondsRef.current += 1;
        if (currentData.inZone) {
          inZoneSecondsRef.current += 1;
          setInZoneSeconds(inZoneSecondsRef.current);
        }
      }
      // Read the final tick from refs after counting it; state updates are asynchronous.
      if (tick.phase === 'complete') void finishSession(tick.elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [finishSession, isDemoSession, isFitAccepted, isPaused, isSessionCompleted, isSessionStarted, runtimeConfig, sessionTotalDuration]);

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
    if (!runtimeConfig) return;
    eegEngine.configureProtocol(runtimeConfig);
    eegEngine.isDemoMode = true;
    setIsDemoSession(true);
    eegEngine.setSimulatedState('auto');
    setDemoState(null);
    setIsFitAccepted(true);
    setIsSessionStarted(true);
    setPhase('training');
    forceUpdate({});
  };

  const toggleSessionPause = () => {
    if (!isPaused) {
      setIsPaused(true);
      return;
    }
    if (!isDemoSession) {
      const currentData = eegDataRef.current;
      const provenance = eegEngine.getBandPowerProvenance();
      const sourceState = eegEngine.getHardwareSourceState();
      const hasVerifiedSignal = Boolean(
        eegEngine.isHardwareConnected
        && currentData?.inZoneAvailable
        && currentData.signalQuality !== 'disconnected'
        && provenance
        && sourceState.sequence > lastCoveredSourceSequenceRef.current
        && Date.now() - sourceState.lastFrameAtMs <= HARDWARE_SOURCE_MAX_AGE_MS
        && (Object.keys(bandAccumulatorRef.current.sums) as Array<keyof typeof bandAccumulatorRef.current.sums>)
          .every((band) => currentData.bandAvailability[band] && Number.isFinite(currentData.bands[band])),
      );
      if (!hasVerifiedSignal) {
        setAcquisitionError('Verified EEG is still unavailable. Check headset fit and connection before resuming.');
        return;
      }
    }
    setAcquisitionError(null);
    setIsPaused(false);
  };

  if (!runtimeResolution.ok) {
    return (
      <div style={{ padding: '32px', maxWidth: '520px', margin: '0 auto', textAlign: 'center' }} role="alert">
        <h1 style={{ fontSize: '22px' }}>Protocol unavailable</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
          Your training settings can’t be used right now. Choose a protocol again in your training setup.
        </p>
        <button className="btn btn-primary" onClick={cancelSession}>Return to dashboard</button>
      </div>
    );
  }

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
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: eegData?.inZone ? 'var(--status-active)' : 'var(--status-paused)',
              boxShadow: eegData?.inZone ? '0 0 8px var(--status-active)' : 'none',
            }}
          />
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              {phase}
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

      {/* Adaptive Threshold Notification Banner */}
      {adjustmentNotice && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 16,
            right: 16,
            zIndex: 30,
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1.5px solid var(--brand-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            boxShadow: '0 4px 16px rgba(232, 150, 122, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'gentleFloat 0.3s ease',
          }}
        >
          <Brain size={18} color="var(--brand-primary)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Target adjusted
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {adjustmentNotice.direction === 'tightened' ? 'A little more challenging now.' : adjustmentNotice.direction === 'eased' ? 'A little easier now.' : 'Holding steady.'}
            </div>
          </div>
        </div>
      )}

      {/* Main Experience Viewport */}
      <main style={{ flex: 1, minHeight: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative' }}>
          {selectedExperience === 'neuro-gambit' && (
            <NeuroGambitExperience eegData={eegData} isPaused={isPaused} isDemoSession={isDemoSession} patientId={client.id} savedBaselineModel={client.individualBaselineModel} onBaselinePersisted={onBaselinePersisted ?? (() => {})} />
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

        {/* Live feedback values: the active reward measurement and recent time in zone. */}
        <div
          className="card-patient-recessed session-telemetry"
          style={{ padding: '8px 6px', flexShrink: 0 }}
        >
          <div>
            <div className="session-telemetry-label">{telemetryLabel(activeReward?.label)}</div>
            <div className="session-telemetry-value font-mono">{activeReward?.value}</div>
            {activeReward?.value !== 'Unavailable' && eegData?.inZoneAvailable && (
              <div className="session-telemetry-note">{eegData.inZone ? 'In zone now' : 'Out of zone now'}</div>
            )}
          </div>
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
          <div>
            <div className="session-telemetry-label">In zone · <span className="session-telemetry-group">last {RECENT_IN_ZONE_WINDOW_SECONDS}s</span></div>
            <div className="session-telemetry-value font-mono" style={{ color: 'var(--brand-primary)' }}>
              {recentInZonePercent != null ? `${recentInZonePercent}%` : (eegData?.inZoneAvailable ? (eegData.inZone ? '100%' : '0%') : '--')}
            </div>
          </div>
        </div>

        {/* Current state and headset signal in one quiet row; opens the fit check. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '0 4px', flexShrink: 0, minHeight: '32px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0, fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {eegData?.brainflowScores?.emotionLabel && (
              <>
                <span aria-hidden="true" style={{ width: '7px', height: '7px', flexShrink: 0, borderRadius: '50%', background: (eegData.brainflowScores.valence ?? 0) > 0 ? '#10B981' : '#F59E0B' }} />
                <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{eegData.brainflowScores.emotionLabel}</span>
              </>
            )}
          </span>
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
              You trained for {formatSpokenDuration(totalSecondsElapsed)}, {formatSpokenDuration(Math.floor(inZoneSeconds))} of it in your target zone.
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
