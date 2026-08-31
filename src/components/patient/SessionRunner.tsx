import React, { useEffect, useRef, useState } from 'react';
import { ClientProfile, EEGDataPoint, ExperienceType, SessionPhase, SessionRecord } from '../../types';
import { eegEngine } from '../../services/eegEngine';
import { AdaptiveDifficultyEngine, AdaptiveAdjustmentLog } from '../../services/adaptiveEngine';
import { audioEngine } from '../../services/audioEngine';
import { SkylineDriftCanvas } from '../experiences/SkylineDriftCanvas';
import { TidalGardenCanvas } from '../experiences/TidalGardenCanvas';
import { BreathWeaveCanvas } from '../experiences/BreathWeaveCanvas';
import { SignalSortGame } from '../experiences/SignalSortGame';
import { RhythmLockGame } from '../experiences/RhythmLockGame';
import { MediaModePlayer } from '../experiences/MediaModePlayer';
import { SoundscapePlayer } from '../experiences/SoundscapePlayer';
import { MandalaBreathing } from '../experiences/MandalaBreathing';
import { GenerativeWebXRCanvas } from '../experiences/GenerativeWebXRCanvas';
import { SpatialAudioMode } from '../experiences/SpatialAudioMode';
import { NarrativeTherapyMode } from '../experiences/NarrativeTherapyMode';
import { HeadsetFitModal } from './HeadsetFitModal';
import { Play, Pause, Wifi, Sparkles, Volume2, VolumeX, ShieldCheck, Activity, BookOpen, Target, BrainCircuit } from 'lucide-react';

const MODALITY_BRIEFING_DATA: Record<ExperienceType, { title: string; mechanism: string; benefit: string; instructions: string }> = {
  'skyline-drift': {
    title: 'Skyline Drift',
    mechanism: 'Uses SMR (12-15Hz) neurofeedback to control horizontal movement.',
    benefit: 'Trains the brain to sustain attention while maintaining physical relaxation, heavily prescribed for ADHD and motor control.',
    instructions: 'Keep your body perfectly still and maintain soft focus on the center. As your SMR increases, the path will straighten.',
  },
  'tidal-garden': {
    title: 'Tidal Garden',
    mechanism: 'Utilizes Alpha (8-12Hz) amplitude training to govern environmental growth.',
    benefit: 'Teaches the brain to rapidly decouple from stress and lower cortisol levels, treating general anxiety.',
    instructions: 'Relax your jaw and shoulders. Allow your mind to wander gently. The garden flourishes when you achieve deep relaxation.',
  },
  'breath-weave': {
    title: 'Breath Weave',
    mechanism: 'Combines slow-cortical potential (SCP) shifts with rhythmic visual pacing.',
    benefit: 'Synchronizes respiration with brainwave states, improving heart-rate variability (HRV) and vagal tone.',
    instructions: 'Breathe in time with the visual expansion and contraction. Let the colors guide your nervous system into equilibrium.',
  },
  'signal-sort': {
    title: 'Signal Sort',
    mechanism: 'Leverages Beta (15-20Hz) operant conditioning through discrete cognitive tasks.',
    benefit: 'Enhances executive function, working memory, and sharpens analytical focus.',
    instructions: 'Sort the incoming signals as quickly as possible. Your score increases when you maintain sharp, active concentration.',
  },
  'rhythm-lock': {
    title: 'Rhythm Lock',
    mechanism: 'Trains Theta-Beta ratio optimization through rhythmic timing.',
    benefit: 'Reduces impulsivity and improves timing circuits in the basal ganglia.',
    instructions: 'Tap or focus precisely on the beat. The game rewards calm anticipation rather than anxious, early reactions.',
  },
  'media-mode': {
    title: 'Media Mode',
    mechanism: 'Applies Alpha/Theta thresholding to control video opacity and volume.',
    benefit: 'Conditions the brain to maintain a relaxed, receptive state while engaging with external stimuli.',
    instructions: 'Watch the video. If your mind wanders or you become tense, the screen will dim. Relax to restore clarity.',
  },
  'soundscape-mode': {
    title: 'Soundscape Mode',
    mechanism: 'Uses multi-band frequency analysis to modulate binaural audio layers.',
    benefit: 'Promotes deep auditory processing and hemispheric synchronization.',
    instructions: 'Close your eyes. Listen to the layers of sound. The audio will harmonize as your brainwaves balance.',
  },
  'mandala': {
    title: 'Mandala Breathing',
    mechanism: 'Alpha (8-12Hz) and Theta (4-8Hz) coherence visually construct geometric patterns.',
    benefit: 'Facilitates transition into flow states and deep mindfulness practices.',
    instructions: 'Focus on the center of the mandala. Let your breath guide the geometry. The pattern completes as you achieve inner stillness.',
  },
  'immersive-3d': {
    title: 'Generative XR',
    mechanism: 'Translates real-time coherence metrics into dynamic 3D spatial particle systems.',
    benefit: 'Provides powerful, immediate visual biofeedback, accelerating the brain\'s operant conditioning loop.',
    instructions: 'Observe the 3D space. Your coherence score directly manipulates the gravity, color, and flow of the particles.',
  },
  'spatial-audio': {
    title: 'Spatial Audio',
    mechanism: 'Maps frontal lobe asymmetry to 3D audio panning and reverb.',
    benefit: 'Aids in emotional regulation and trauma processing by grounding the user in an immersive auditory environment.',
    instructions: 'Use headphones. Pay attention to where the sounds originate. Keep your emotional state neutral to center the audio.',
  },
  'narrative-story': {
    title: 'Narrative Therapy',
    mechanism: 'Advances narrative progression only when target EEG thresholds are sustained.',
    benefit: 'Enhances emotional resilience and cognitive reframing by rewarding regulated states with story resolution.',
    instructions: 'Follow the story. The narrative will pause if you become overly stressed or distracted. Breathe to continue the journey.',
  }
};

interface SessionRunnerProps {
  client: ClientProfile;
  selectedExperience: ExperienceType;
  onComplete: (summary: SessionRecord) => void;
  onCancel: () => void;
}

export const SessionRunner: React.FC<SessionRunnerProps> = ({
  client,
  selectedExperience,
  onComplete,
  onCancel,
}) => {
  const [phase, setPhase] = useState<SessionPhase>('calibration');
  const [eegData, setEegData] = useState<EEGDataPoint | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [isFitAccepted, setIsFitAccepted] = useState(eegEngine.isDemoMode);
  const [isSessionStarted, setIsSessionStarted] = useState(eegEngine.isDemoMode);
  const [showFitModal, setShowFitModal] = useState(false);
  const [muted, setMuted] = useState(false);
  const [adjustmentNotice, setAdjustmentNotice] = useState<AdaptiveAdjustmentLog | null>(null);

  // Timers (in seconds)
  // Standard duration: 25 mins total (60s calib, 120s warmup, 1140s training, 120s cooldown, 60s debrief)
  const sessionTotalDuration = 1500; // 25 minutes = 1500 seconds
  const [totalSecondsElapsed, setTotalSecondsElapsed] = useState(0);
  const [inZoneSeconds, setInZoneSeconds] = useState(0);
  const [inZoneMeasuredSeconds, setInZoneMeasuredSeconds] = useState(0);

  const adaptiveEngineRef = useRef<AdaptiveDifficultyEngine>(new AdaptiveDifficultyEngine(client.assignedProtocol));
  const timeSeriesRef = useRef<SessionRecord['timeSeries']>([]);
  const bandAccumulatorRef = useRef({ delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0, count: 0 });
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
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  const isPausedRef = useRef(isPaused);
  const phaseRef = useRef(phase);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // If in simulator demo mode, instantly ready the state
  useEffect(() => {
    if (eegEngine.isDemoMode) {
      setIsFitAccepted(true);
      setIsSessionStarted(true);
      setPhase('training');
    }
  }, []);

  const finishSession = React.useCallback(() => {
    const totalTrainTime = Math.max(1, inZoneMeasuredSeconds);
    const timeInZonePercent = Math.min(100, Math.round((inZoneSeconds / totalTrainTime) * 100));
    const acc = bandAccumulatorRef.current;
    const count = Math.max(1, acc.count);

    const bfAcc = brainflowAccRef.current;
    const summary: SessionRecord = {
      id: 'sess-' + Date.now(),
      patientId: client.id,
      patientName: client.name,
      clinicId: client.linkedClinicianCode || 'self-guided',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: Date.now(),
      protocol: client.assignedProtocol,
      experience: selectedExperience,
      durationSeconds: totalSecondsElapsed,
      timeInZonePercent,
      averageCoherence: coherenceAccumulatorRef.current.count > 0
        ? Math.round(coherenceAccumulatorRef.current.total / coherenceAccumulatorRef.current.count)
        : null,
      peakFocusScore: Math.min(99, Math.round(timeInZonePercent * 1.05 + 10)),
      averageBands: {
        delta: count > 0 ? Math.round((acc.delta / count) * 10) / 10 : 0,
        theta: count > 0 ? Math.round((acc.theta / count) * 10) / 10 : 0,
        alpha: count > 0 ? Math.round((acc.alpha / count) * 10) / 10 : 0,
        smr: count > 0 ? Math.round((acc.smr / count) * 10) / 10 : 0,
        beta: count > 0 ? Math.round((acc.beta / count) * 10) / 10 : 0,
        gamma: count > 0 ? Math.round((acc.gamma / count) * 10) / 10 : 0,
      },
      timeSeries: timeSeriesRef.current, // Real recorded data only — no fabricated fallbacks
      adaptiveAdjustmentsCount: adaptiveEngineRef.current.getAdjustmentsCount(),
      finalThreshold: adaptiveEngineRef.current.getCurrentThreshold(),
      averageTrainingScore: bfAcc.trainingCount > 0 ? Math.round(bfAcc.training / bfAcc.trainingCount) : null,
      averageMindfulness: bfAcc.mindfulnessCount > 0 ? Math.round(bfAcc.mindfulness / bfAcc.mindfulnessCount) : undefined,
      averageValence: bfAcc.valenceCount > 0 ? Math.round((bfAcc.valence / bfAcc.valenceCount) * 100) / 100 : undefined,
      averageArousal: bfAcc.arousalCount > 0 ? Math.round((bfAcc.arousal / bfAcc.arousalCount) * 100) / 100 : undefined,
    };

    audioEngine.playChime('complete');
    onComplete(summary);
  }, [client.assignedProtocol, client.id, client.name, inZoneMeasuredSeconds, inZoneSeconds, onComplete, selectedExperience, totalSecondsElapsed]);

  // Subscribe to high-frequency EEG data stream (10 Hz)
  useEffect(() => {
    eegEngine.setProtocol(client.assignedProtocol);
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe(data => {
      eegDataRef.current = data;
      setEegData(data);

      // The training score owns its own 24-window baseline. The app leaves
      // the other derived metrics raw unless a future view explicitly opts a
      // metric into the service's per-metric calibration.
      if (!isPausedRef.current && isFitAccepted && data.trainingMetric?.score != null) {
        const bfAcc = brainflowAccRef.current;
        bfAcc.training += data.trainingMetric.score;
        bfAcc.trainingCount += 1;
      }

      if (!isPausedRef.current && isFitAccepted && phaseRef.current !== 'calibration') {
        // Collect rolling band averages
        const acc = bandAccumulatorRef.current;
        acc.delta += data.bands.delta;
        acc.theta += data.bands.theta;
        acc.alpha += data.bands.alpha;
        acc.smr += data.bands.smr;
        acc.beta += data.bands.beta;
        acc.gamma += data.bands.gamma;
        acc.count += 1;
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
        if (phaseRef.current === 'training') {
          const result = adaptiveEngineRef.current.addSample(data.inZone);
          if (result.adjusted && result.log) {
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
      audioEngine.stopAll();
    };
  }, [client.assignedProtocol, isFitAccepted]);

  // Main session timer interval
  useEffect(() => {
    if (isPaused || !isSessionStarted) return;

    const interval = window.setInterval(() => {
      setTotalSecondsElapsed(prev => {
        const next = prev + 1;

        // Phase transitions (accelerated in demo mode)
        if (eegEngine.isDemoMode) {
          if (phaseRef.current === 'calibration') {
            setPhase('training');
          }
        } else {
          if (next >= 60 && phaseRef.current === 'calibration') {
            setPhase('warmup');
            audioEngine.playChime('success');
          } else if (next >= 180 && phaseRef.current === 'warmup') {
            setPhase('training');
          } else if (next >= 1320 && phaseRef.current === 'training') {
            setPhase('cooldown');
          } else if (next >= 1440 && phaseRef.current === 'cooldown') {
            setPhase('debrief');
          } else if (next >= sessionTotalDuration) {
            finishSession();
          }
        }

        // Periodic time-series capture every 10 seconds
        const currentData = eegDataRef.current;
        if (next % 10 === 0 && currentData) {
          timeSeriesRef.current.push({
            t: next,
            thetaBetaRatio: currentData.thetaBetaRatio,
            alpha: currentData.bands.alpha,
            smr: currentData.bands.smr,
            beta: currentData.bands.beta,
            inZone: currentData.inZone,
          });
        }

        return next;
      });

      const currentData = eegDataRef.current;
      // The live in-zone display should reflect every valid observation as
      // soon as a session begins. Calibration is real EEG data too; only an
      // unavailable protocol metric should keep this value indeterminate.
      if (currentData?.inZoneAvailable) {
        setInZoneMeasuredSeconds(seconds => seconds + 1);
        if (currentData.inZone) {
          setInZoneSeconds(seconds => seconds + 1);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [finishSession, isFitAccepted, isPaused, isSessionStarted, sessionTotalDuration]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audioEngine.setMuted(next);
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
    const res = await eegEngine.connectMuseAthenaBrainflow();
    setIsPairing(false);
    forceUpdate({});
    if (res.success) {
      setShowFitModal(true);
    }
  };

  const handleStartDemoMode = () => {
    eegEngine.isDemoMode = true;
    eegEngine.setSimulatedState('auto');
    setIsFitAccepted(true);
    setIsSessionStarted(true);
    setPhase('training');
    forceUpdate({});
  };

  // Connection Gate Screen
  if (!eegEngine.isHardwareConnected && !eegEngine.isDemoMode) {
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

          <button
            onClick={handleStartDemoMode}
            className="btn btn-secondary"
            style={{ padding: '12px', fontSize: '13px' }}
          >
            Try Demo Mode
          </button>

          <button
            onClick={onCancel}
            className="btn btn-ghost"
            style={{ padding: '10px', fontSize: '13px' }}
          >
            Cancel & Return to Dashboard
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)', fontSize: '11px' }}>
          <ShieldCheck size={14} />
          <span>Runs 100% in your browser. No server downloads required.</span>
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
        onClose={onCancel}
      />
    );
  }

  const remainingSeconds = Math.max(0, sessionTotalDuration - totalSecondsElapsed);
  const worstQuality = eegData?.signalQuality || 'good';
  const inZonePercent = inZoneMeasuredSeconds > 0
    ? Math.min(100, Math.round((inZoneSeconds / inZoneMeasuredSeconds) * 100))
    : null;

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
              padding: '32px',
              width: '100%',
              maxWidth: '400px',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'var(--brand-primary-subtle)', color: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BrainCircuit size={24} />
              </div>
              <h2 className="font-display" style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {MODALITY_BRIEFING_DATA[selectedExperience]?.title || 'Session Briefing'}
              </h2>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--brand-primary)', marginBottom: '4px', fontWeight: 500, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <Activity size={14} /> Mechanism
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                  {MODALITY_BRIEFING_DATA[selectedExperience]?.mechanism || 'Uses real-time EEG biofeedback.'}
                </p>
              </div>
              
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--brand-primary)', marginBottom: '4px', fontWeight: 500, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <BookOpen size={14} /> Clinical Benefit
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                  {MODALITY_BRIEFING_DATA[selectedExperience]?.benefit || 'Trains brain resilience.'}
                </p>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--brand-primary)', marginBottom: '4px', fontWeight: 500, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <Target size={14} /> Instructions
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                  {MODALITY_BRIEFING_DATA[selectedExperience]?.instructions || 'Follow the on-screen prompts.'}
                </p>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 600, marginTop: '32px' }}
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
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              Phase: <strong style={{ color: 'var(--text-primary)' }}>{phase}</strong> ({formatTime(totalSecondsElapsed)})
            </div>
            <div className="font-mono" style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {formatTime(remainingSeconds)} <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--text-tertiary)' }}>remaining</span>
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
          <Sparkles size={18} color="var(--brand-primary)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Adaptive Engine: Target {adjustmentNotice.direction}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{adjustmentNotice.reason}</div>
          </div>
        </div>
      )}

      {/* Main Experience Viewport */}
      <main style={{ flex: 1, minHeight: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative' }}>
          {selectedExperience === 'skyline-drift' && (
            <SkylineDriftCanvas eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'tidal-garden' && (
            <TidalGardenCanvas 
              eegData={eegData} 
              stage={client.tidalGardenState.stage} 
              growthPoints={client.tidalGardenState.growthPoints + Math.floor(inZoneSeconds * 10)} 
              inZonePercent={inZonePercent ?? undefined}
              isPaused={isPaused} 
            />
          )}
          {selectedExperience === 'breath-weave' && (
            <BreathWeaveCanvas eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'signal-sort' && (
            <SignalSortGame eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'rhythm-lock' && (
            <RhythmLockGame eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'media-mode' && (
            <MediaModePlayer eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'soundscape-mode' && (
            <SoundscapePlayer eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'mandala' && (
            <MandalaBreathing eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'immersive-3d' && (
            <GenerativeWebXRCanvas eegData={eegData} />
          )}
          {selectedExperience === 'spatial-audio' && (
            <SpatialAudioMode eegData={eegData} />
          )}
          {selectedExperience === 'narrative-story' && (
            <NarrativeTherapyMode eegData={eegData} />
          )}
        </div>

        {/* Live Monospace EEG Telemetry Panel */}
        <div
          className="card-patient-recessed"
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '8px 12px',
            flexShrink: 0,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Theta/Beta</div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {eegData?.thetaBetaRatioAvailable ? eegData.thetaBetaRatio.toFixed(2) : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Mindfulness</div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: '#7B68AE' }}>
              {eegData?.brainflowScores?.mindfulnessScore != null ? Math.round(eegData.brainflowScores.mindfulnessScore) : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>SMR (12-15Hz)</div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--chart-smr)' }}>
              {eegData?.bandAvailability.smr ? eegData.bands.smr.toFixed(1) + ' µV' : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>In-Zone %</div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {inZonePercent != null ? `${inZonePercent}%` : '--'}
            </div>
          </div>
        </div>

        {/* Valence / Arousal + Emotion Label */}
        {eegData?.brainflowScores?.emotionLabel && (
          <div
            className="card-patient-recessed"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: (eegData.brainflowScores.valence ?? 0) > 0 ? '#10B981' : '#F59E0B',
              }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                {eegData.brainflowScores.emotionLabel}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                V: <span className="font-mono" style={{ fontWeight: 600 }}>{(eegData.brainflowScores.valence ?? 0).toFixed(2)}</span>
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                A: <span className="font-mono" style={{ fontWeight: 600 }}>{(eegData.brainflowScores.arousal ?? 0).toFixed(2)}</span>
              </span>
            </div>
          </div>
        )}

        {/* 4-Channel Real-Time Mini Status Pills */}
        <div
          style={{
            background: 'var(--surface-patient-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>Sensors:</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { label: 'TP9 (L-Ear)', key: 'tp9' as const },
              { label: 'AF7 (L-Forehead)', key: 'af7' as const },
              { label: 'AF8 (R-Forehead)', key: 'af8' as const },
              { label: 'TP10 (R-Ear)', key: 'tp10' as const },
            ].map(item => {
              const st = eegData?.channelQuality[item.key] || 'good';
              const dotColor = st === 'good' ? '#10B981' : st === 'fair' ? '#F59E0B' : '#EF4444';
              return (
                <div
                  key={item.key}
                  onClick={() => setShowFitModal(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor }} />
                  <span>{item.label.split(' ')[0]}</span>
                </div>
              );
            })}
          </div>
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
          onClick={() => setIsPaused(!isPaused)}
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
            <h3 className="font-display" style={{ fontSize: '20px', marginBottom: '8px' }}>
              Complete Training Session?
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              You have trained for {formatTime(totalSecondsElapsed)} with {Math.floor(inZoneSeconds)}s in optimal neural zone.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={finishSession} className="btn btn-primary" style={{ width: '100%' }}>
                Yes, Save Progress & View Summary
              </button>
              <button onClick={() => setShowEndConfirm(false)} className="btn btn-ghost" style={{ width: '100%' }}>
                Continue Training
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
