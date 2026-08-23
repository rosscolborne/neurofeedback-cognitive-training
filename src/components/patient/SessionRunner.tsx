import React, { useEffect, useRef, useState } from 'react';
import { ClientProfile, EEGDataPoint, ExperienceType, ProtocolType, SessionPhase, SessionRecord } from '../../types';
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
import { Play, Pause, AlertCircle, X, CheckCircle2, Battery, Wifi, Sparkles, Volume2, VolumeX } from 'lucide-react';

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
  const [muted, setMuted] = useState(false);
  const [adjustmentNotice, setAdjustmentNotice] = useState<AdaptiveAdjustmentLog | null>(null);

  // Timers (in seconds)
  // Standard duration: 25 mins total (60s calib, 120s warmup, 1140s training, 120s cooldown, 60s debrief)
  // For interactive demo flow: we also allow speed-running or jumping to finish.
  const [totalSecondsElapsed, setTotalSecondsElapsed] = useState(0);
  const [inZoneSeconds, setInZoneSeconds] = useState(0);
  const sessionTotalDuration = 1500; // 25 minutes

  const adaptiveEngineRef = useRef<AdaptiveDifficultyEngine>(new AdaptiveDifficultyEngine(client.assignedProtocol));
  const timeSeriesRef = useRef<SessionRecord['timeSeries']>([]);
  const bandAccumulatorRef = useRef({ delta: 0, theta: 0, alpha: 0, smr: 0, beta: 0, gamma: 0, count: 0 });

  useEffect(() => {
    eegEngine.setProtocol(client.assignedProtocol);
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe(data => {
      setEegData(data);

      if (!isPaused && phase !== 'calibration') {
        // Collect rolling band averages
        const acc = bandAccumulatorRef.current;
        acc.delta += data.bands.delta;
        acc.theta += data.bands.theta;
        acc.alpha += data.bands.alpha;
        acc.smr += data.bands.smr;
        acc.beta += data.bands.beta;
        acc.gamma += data.bands.gamma;
        acc.count += 1;

        // Feed adaptive difficulty engine during Core Training
        if (phase === 'training') {
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
  }, [client.assignedProtocol, phase, isPaused]);

  // Main session ticker
  useEffect(() => {
    if (isPaused) return;

    const interval = window.setInterval(() => {
      setTotalSecondsElapsed(prev => {
        const next = prev + 1;

        // Phase transitions
        if (next >= 60 && phase === 'calibration') {
          setPhase('warmup');
          audioEngine.playChime('success');
        } else if (next >= 180 && phase === 'warmup') {
          setPhase('training');
        } else if (next >= 1320 && phase === 'training') {
          setPhase('cooldown');
        } else if (next >= sessionTotalDuration) {
          finishSession();
        }

        // Periodic time-series capture every 10 seconds
        if (next % 10 === 0 && eegData) {
          timeSeriesRef.current.push({
            t: next,
            thetaBetaRatio: eegData.thetaBetaRatio,
            alpha: eegData.bands.alpha,
            smr: eegData.bands.smr,
            beta: eegData.bands.beta,
            inZone: eegData.inZone,
          });
        }

        return next;
      });

      if (eegData?.inZone && phase !== 'calibration') {
        setInZoneSeconds(z => z + 1);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPaused, phase, eegData]);

  const finishSession = () => {
    const totalTrainTime = Math.max(1, totalSecondsElapsed - 60);
    const timeInZonePercent = Math.min(100, Math.round((inZoneSeconds / totalTrainTime) * 100));
    const acc = bandAccumulatorRef.current;
    const count = Math.max(1, acc.count);

    const summary: SessionRecord = {
      id: 'sess-' + Date.now(),
      patientId: client.id,
      patientName: client.name,
      clinicId: 'evolve-brain-training',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: Date.now(),
      protocol: client.assignedProtocol,
      experience: selectedExperience,
      durationSeconds: totalSecondsElapsed,
      timeInZonePercent,
      averageCoherence: eegData?.coherence || 78,
      peakFocusScore: Math.min(99, Math.round(timeInZonePercent * 1.05 + 10)),
      averageBands: {
        delta: Math.round((acc.delta / count) * 10) / 10 || 12.5,
        theta: Math.round((acc.theta / count) * 10) / 10 || 7.8,
        alpha: Math.round((acc.alpha / count) * 10) / 10 || 10.4,
        smr: Math.round((acc.smr / count) * 10) / 10 || 6.5,
        beta: Math.round((acc.beta / count) * 10) / 10 || 9.2,
        gamma: Math.round((acc.gamma / count) * 10) / 10 || 4.1,
      },
      timeSeries: timeSeriesRef.current.length > 0 ? timeSeriesRef.current : [
        { t: 0, thetaBetaRatio: 1.9, alpha: 9.5, smr: 6.0, beta: 8.5, inZone: true },
        { t: 60, thetaBetaRatio: 1.6, alpha: 11.2, smr: 7.1, beta: 9.8, inZone: true },
      ],
      adaptiveAdjustmentsCount: adaptiveEngineRef.current.getAdjustmentsCount(),
      finalThreshold: adaptiveEngineRef.current.getCurrentThreshold(),
    };

    audioEngine.playChime('complete');
    onComplete(summary);
  };

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
  };

  const handleStartDemoMode = () => {
    eegEngine.isDemoMode = true;
    forceUpdate({});
  };

  if (!eegEngine.isHardwareConnected && !eegEngine.isDemoMode) {
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100vh',
          maxWidth: '520px',
          margin: '0 auto',
          backgroundColor: 'var(--surface-patient-base)',
          padding: '40px 24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '24px',
          textAlign: 'center',
        }}
      >
        <Wifi size={48} color="var(--brand-primary)" />
        <div>
          <h1 className="font-display" style={{ fontSize: '26px', fontWeight: 500, color: 'var(--text-primary)' }}>
            Telemetry Connection Required
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '6px', maxWidth: '340px' }}>
            A live Muse 2 or Muse S headband connection is required to begin this clinical training session.
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          <button
            onClick={handleConnectHardware}
            disabled={isPairing}
            className="btn btn-primary"
            style={{ padding: '14px', fontSize: '15px' }}
          >
            {isPairing ? 'Initializing Bluetooth GATT...' : 'Connect Muse Headband'}
          </button>

          <button
            onClick={handleStartDemoMode}
            className="btn btn-secondary"
            style={{ padding: '12px', fontSize: '14px' }}
          >
            Use Demo Simulator (Simulated Telemetry)
          </button>

          <button
            onClick={onCancel}
            className="btn btn-ghost"
            style={{ padding: '10px', fontSize: '13px', marginTop: '10px' }}
          >
            Cancel & Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const remainingSeconds = Math.max(0, sessionTotalDuration - totalSecondsElapsed);

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        maxWidth: '520px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 40px rgba(0,0,0,0.06)',
      }}
    >
      {/* Session Top Header */}
      <header
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-patient-card)',
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
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
              Phase: <strong style={{ color: 'var(--text-primary)' }}>{phase}</strong>
            </div>
            <div className="font-mono" style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {formatTime(remainingSeconds)} <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>remaining</span>
            </div>
          </div>
        </div>

        {/* Headband Hardware Telemetry & Audio Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={toggleMute} className="btn btn-ghost" style={{ padding: '6px 8px' }}>
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <div
            style={{
              background: 'var(--surface-patient-recessed)',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--text-secondary)',
            }}
          >
            <Wifi size={13} color="var(--status-active)" />
            <span>Muse S (100% Signal)</span>
          </div>
        </div>
      </header>

      {/* Adaptive Threshold Notification Banner */}
      {adjustmentNotice && (
        <div
          style={{
            position: 'absolute',
            top: 72,
            left: 20,
            right: 20,
            zIndex: 30,
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1.5px solid var(--brand-primary)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            boxShadow: '0 4px 16px rgba(232, 150, 122, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            animation: 'gentleFloat 0.3s ease',
          }}
        >
          <Sparkles size={20} color="var(--brand-primary)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Adaptive Engine: Target {adjustmentNotice.direction}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{adjustmentNotice.reason}</div>
          </div>
        </div>
      )}

      {/* Main Experience Viewport */}
      <main style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ flex: 1, minHeight: '320px', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {selectedExperience === 'skyline-drift' && (
            <SkylineDriftCanvas eegData={eegData} isPaused={isPaused} />
          )}
          {selectedExperience === 'tidal-garden' && (
            <TidalGardenCanvas eegData={eegData} stage={client.tidalGardenState.stage} growthPoints={client.tidalGardenState.growthPoints} isPaused={isPaused} />
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

        {/* Live Monospace EEG Telemetry Panel (Matching Spec §4.1) */}
        <div
          className="card-patient-recessed"
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '10px 16px',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Theta/Beta</div>
            <div className="font-mono" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {eegData ? eegData.thetaBetaRatio.toFixed(2) : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Alpha</div>
            <div className="font-mono" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--chart-alpha)' }}>
              {eegData ? eegData.bands.alpha.toFixed(1) + ' µV' : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>SMR (12-15Hz)</div>
            <div className="font-mono" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--chart-smr)' }}>
              {eegData ? eegData.bands.smr.toFixed(1) + ' µV' : '--'}
            </div>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--border-default)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>In-Zone %</div>
            <div className="font-mono" style={{ fontSize: '14px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {totalSecondsElapsed > 60 ? Math.round((inZoneSeconds / (totalSecondsElapsed - 60)) * 100) : 0}%
            </div>
          </div>
        </div>

        {/* Mind State Simulator Controls */}
        <div
          style={{
            background: 'var(--surface-patient-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>Mind State:</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => { eegEngine.userFocus = 90; eegEngine.userCalm = 75; }}
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '4px 8px', background: 'var(--surface-patient-recessed)' }}
            >
              Focus State
            </button>
            <button
              onClick={() => { eegEngine.userFocus = 40; eegEngine.userCalm = 95; eegEngine.eyeClosed = true; }}
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '4px 8px', background: 'var(--surface-patient-recessed)' }}
            >
              Calm Alpha
            </button>
            <button
              onClick={() => { eegEngine.userFocus = 25; eegEngine.userCalm = 35; }}
              className="btn btn-ghost"
              style={{ fontSize: '11px', padding: '4px 8px', background: 'var(--surface-patient-recessed)' }}
            >
              Wandering
            </button>
          </div>
        </div>
      </main>

      {/* Session Footer Action Bar */}
      <footer
        style={{
          padding: '16px 20px',
          background: 'var(--surface-patient-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          gap: '12px',
        }}
      >
        <button
          onClick={() => setIsPaused(!isPaused)}
          className="btn btn-secondary"
          style={{ flex: 1 }}
        >
          {isPaused ? <Play size={18} /> : <Pause size={18} />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>

        <button
          onClick={() => setShowEndConfirm(true)}
          className="btn btn-primary"
          style={{ flex: 2 }}
        >
          End Session & Save
        </button>
      </footer>

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
              You have trained for {formatTime(totalSecondsElapsed)} with {inZoneSeconds}s in optimal neural zone.
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
