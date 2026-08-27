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
import { HeadsetFitModal } from './HeadsetFitModal';
import { Play, Pause, Wifi, Sparkles, Volume2, VolumeX, ShieldCheck, Activity } from 'lucide-react';

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
  const [isFitAccepted, setIsFitAccepted] = useState(false);
  const [showFitModal, setShowFitModal] = useState(false);
  const [muted, setMuted] = useState(false);
  const [adjustmentNotice, setAdjustmentNotice] = useState<AdaptiveAdjustmentLog | null>(null);

  // Timers (in seconds)
  // Standard duration: 25 mins total (60s calib, 120s warmup, 1140s training, 120s cooldown, 60s debrief)
  const sessionTotalDuration = 1500; // 25 minutes = 1500 seconds
  const [totalSecondsElapsed, setTotalSecondsElapsed] = useState(0);
  const [inZoneSeconds, setInZoneSeconds] = useState(0);

  const adaptiveEngineRef = useRef<AdaptiveDifficultyEngine>(new AdaptiveDifficultyEngine(client.assignedProtocol));
  const timeSeriesRef = useRef<SessionRecord['timeSeries']>([]);
  const bandAccumulatorRef = useRef({ delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0, count: 0 });
  const brainflowAccRef = useRef({ mindfulness: 0, valence: 0, arousal: 0, training: 0, count: 0 });
  const eegDataRef = useRef<EEGDataPoint | null>(null);
  const isPausedRef = useRef(isPaused);
  const phaseRef = useRef(phase);
  const cleanSignalSecondsRef = useRef(0);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const finishSession = React.useCallback(() => {
    const totalTrainTime = Math.max(1, totalSecondsElapsed - 60);
    const timeInZonePercent = Math.min(100, Math.round((inZoneSeconds / totalTrainTime) * 100));
    const acc = bandAccumulatorRef.current;
    const count = Math.max(1, acc.count);

    const bfAcc = brainflowAccRef.current;
    const bfCount = Math.max(1, bfAcc.count);

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
      averageCoherence: eegDataRef.current?.coherence || 0,
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
      averageTrainingScore: bfAcc.count > 0 ? Math.round(bfAcc.training / bfCount) : undefined,
      averageMindfulness: bfAcc.count > 0 ? Math.round(bfAcc.mindfulness / bfCount) : undefined,
      averageValence: bfAcc.count > 0 ? Math.round((bfAcc.valence / bfCount) * 100) / 100 : undefined,
      averageArousal: bfAcc.count > 0 ? Math.round((bfAcc.arousal / bfCount) * 100) / 100 : undefined,
    };

    audioEngine.playChime('complete');
    onComplete(summary);
  }, [client.assignedProtocol, client.id, client.name, inZoneSeconds, onComplete, selectedExperience, totalSecondsElapsed]);

  // Subscribe to high-frequency EEG data stream (10 Hz)
  useEffect(() => {
    eegEngine.setProtocol(client.assignedProtocol);
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe(data => {
      eegDataRef.current = data;
      setEegData(data);

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

        // Accumulate brainflow service metrics
        if (data.brainflowScores) {
          const bfAcc = brainflowAccRef.current;
          if (data.brainflowScores.mindfulnessScore != null) bfAcc.mindfulness += data.brainflowScores.mindfulnessScore;
          if (data.brainflowScores.valence != null) bfAcc.valence += data.brainflowScores.valence;
          if (data.brainflowScores.arousal != null) bfAcc.arousal += data.brainflowScores.arousal;
          if (data.trainingMetric?.score != null) bfAcc.training += data.trainingMetric.score;
          bfAcc.count += 1;
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

  // Main session timer interval: strictly starts ONLY after user clicks "Accept Current Fit"
  useEffect(() => {
    if (isPaused || !isFitAccepted) return;

    const interval = window.setInterval(() => {
      setTotalSecondsElapsed(prev => {
        const next = prev + 1;

        // Phase transitions
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

      // Clean Signal Multiplier logic
      const currentData = eegDataRef.current;
      if (currentData) {
        const hasArtifact = currentData.artifacts.blink || currentData.artifacts.clench || currentData.signalQuality === 'poor' || currentData.signalQuality === 'disconnected';
        if (!hasArtifact) {
          cleanSignalSecondsRef.current += 1;
        } else {
          cleanSignalSecondsRef.current = 0;
        }
      }

      if (currentData?.inZone && phaseRef.current !== 'calibration') {
        setInZoneSeconds(z => z + (cleanSignalSecondsRef.current > 30 ? 1.5 : 1));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [finishSession, isFitAccepted, isPaused, sessionTotalDuration]);

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
    const res = await eegEngine.connectMuseBluetooth();
    setIsPairing(false);
    forceUpdate({});
    if (res.success) {
      setShowFitModal(true);
    }
  };

  const handleStartDemoMode = () => {
    eegEngine.isDemoMode = true;
    setIsFitAccepted(true);
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
            Pair your Muse 2 or Muse S headband via Web Bluetooth to stream real 4-channel EEG (TP9, AF7, AF8, TP10).
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <button
            onClick={handleConnectHardware}
            disabled={isPairing}
            className="btn btn-primary"
            style={{ padding: '14px', fontSize: '14px' }}
          >
            {isPairing ? 'Opening Bluetooth Pairing...' : 'Pair Muse via Web Bluetooth (Zero Install)'}
          </button>

          <button
            onClick={handleStartDemoMode}
            className="btn btn-secondary"
            style={{ padding: '12px', fontSize: '13px' }}
          >
            Preview with Simulated Telemetry
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
  const inZonePercent = totalSecondsElapsed > 60 ? Math.min(100, Math.round((inZoneSeconds / (totalSecondsElapsed - 60)) * 100)) : 0;

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
              inZonePercent={inZonePercent}
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
              {eegData ? eegData.thetaBetaRatio.toFixed(2) : '--'}
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
              {eegData ? eegData.bands.smr.toFixed(1) + ' µV' : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>In-Zone %</div>
            <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {inZonePercent}%
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
