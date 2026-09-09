import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bluetooth, CheckCircle2, ChevronRight, Eye, Sparkles, Brain, AlertCircle, RefreshCw, Zap, Compass } from 'lucide-react';
import { eegEngine } from '../../services/eegEngine';
import { audioEngine } from '../../services/audioEngine';
import { storageEngine } from '../../services/storageEngine';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { LiveBrainwaveCanvas } from '../../components/onboarding/LiveBrainwaveCanvas';
import { NeuralImprintCard } from '../../components/onboarding/NeuralImprintCard';
import { MuseChannelQuality, BandPowers } from '../../types';

type StudioStep = 'pair' | 'fit' | 'playground' | 'alpha-calibrate' | 'focus-calibrate' | 'reveal';

export const HardwareSetup: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [step, setStep] = useState<StudioStep>('pair');
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [deviceName, setDeviceName] = useState('Muse Headband');
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  // Electrode fit state
  const [channelQuality, setChannelQuality] = useState<MuseChannelQuality>({
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  });

  // Real-time live bands
  const [liveBands, setLiveBands] = useState<BandPowers>({
    delta: 0,
    theta: 0,
    alpha: 0,
    smr: 0,
    beta: 0,
    gamma: 0,
  });

  // Physical actions tested in playground
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [clenchDetected, setClenchDetected] = useState(false);
  const [eyesClosedSurgeSeen, setEyesClosedSurgeSeen] = useState(false);
  const [focusBetaSpikeSeen, setFocusBetaSpikeSeen] = useState(false);

  // Calibration Tracking (strictly accumulating real measured samples)
  const [countdown, setCountdown] = useState(20);
  const restingThetaSamplesRef = useRef<number[]>([]);
  const restingAlphaSamplesRef = useRef<number[]>([]);
  const restingBetaSamplesRef = useRef<number[]>([]);
  const eyesClosedAlphaSamplesRef = useRef<number[]>([]);
  const focusBetaSamplesRef = useRef<number[]>([]);
  const [savingBaseline, setSavingBaseline] = useState(false);

  // Final Measured Metrics (no mock defaults)
  const [finalMetrics, setFinalMetrics] = useState<{
    alphaPeakHz: number;
    alphaReactivityPercent: number;
    cognitiveDynamicRange: number;
    signalPurityPercent: number;
  }>({
    alphaPeakHz: 10.0,
    alphaReactivityPercent: 0,
    cognitiveDynamicRange: 1.0,
    signalPurityPercent: 100,
  });

  // Subscribe to real EEG updates
  useEffect(() => {
    const unsubscribe = eegEngine.subscribe((data) => {
      setChannelQuality({ ...data.channelQuality });
      if (data.bands) {
        setLiveBands({ ...data.bands });
      }
      if (data.batteryLevel !== undefined) {
        setBatteryLevel(data.batteryLevel);
      }

      // Track resting baseline during playground
      if (step === 'playground' && data.bands) {
        if (data.bands.theta > 0) restingThetaSamplesRef.current.push(data.bands.theta);
        if (data.bands.alpha > 0) restingAlphaSamplesRef.current.push(data.bands.alpha);
        if (data.bands.beta > 0) restingBetaSamplesRef.current.push(data.bands.beta);

        // Keep last 60 samples (~3 seconds)
        if (restingThetaSamplesRef.current.length > 60) restingThetaSamplesRef.current.shift();
        if (restingAlphaSamplesRef.current.length > 60) restingAlphaSamplesRef.current.shift();
        if (restingBetaSamplesRef.current.length > 60) restingBetaSamplesRef.current.shift();

        // Check if alpha surged during eyes-closed in playground
        const currentRestingAlpha =
          restingAlphaSamplesRef.current.length > 0
            ? restingAlphaSamplesRef.current.reduce((a, b) => a + b, 0) / restingAlphaSamplesRef.current.length
            : 0;

        if (currentRestingAlpha > 0 && data.bands.alpha > currentRestingAlpha * 1.35) {
          setEyesClosedSurgeSeen(true);
        }

        // Check if beta spiked during mental focus
        const currentRestingBeta =
          restingBetaSamplesRef.current.length > 0
            ? restingBetaSamplesRef.current.reduce((a, b) => a + b, 0) / restingBetaSamplesRef.current.length
            : 0;

        if (currentRestingBeta > 0 && data.bands.beta > currentRestingBeta * 1.35) {
          setFocusBetaSpikeSeen(true);
        }
      }
    });

    return () => unsubscribe();
  }, [step]);

  // Connect Physical Muse Headband
  const handleConnectHardware = async () => {
    setConnecting(true);
    setConnectionError('');
    try {
      const res = await eegEngine.connectMuseBluetooth();
      if (res.success) {
        setDeviceName(res.deviceName || 'Muse Athena');
        eegEngine.start(50);
        setStep('fit');
      } else {
        setConnectionError(
          res.error || 'Bluetooth connection failed. Ensure your headband is powered on and within range.'
        );
      }
    } catch (err: any) {
      setConnectionError(
        err.message || 'Connection failed. Please ensure Web Bluetooth / Bluetooth permissions are enabled.'
      );
    } finally {
      setConnecting(false);
    }
  };

  const goodChannelsCount = Object.values(channelQuality).filter((q) => q === 'good').length;

  // Advance from Fit check to Interactive Playground
  const handleProceedToPlayground = () => {
    setStep('playground');
  };

  // Proof Callback Handlers
  const handleBlinkDetected = useCallback(() => {
    if (!blinkDetected) {
      setBlinkDetected(true);
      try {
        audioEngine.playChime('success');
      } catch (e) {}
    }
  }, [blinkDetected]);

  const handleClenchDetected = useCallback(() => {
    if (!clenchDetected) {
      setClenchDetected(true);
      try {
        audioEngine.playChime('success');
      } catch (e) {}
    }
  }, [clenchDetected]);

  // Start Guided Baseline Calibration (from Playground)
  const handleStartCalibration = () => {
    setStep('alpha-calibrate');
    setCountdown(20);
    eyesClosedAlphaSamplesRef.current = [];
    focusBetaSamplesRef.current = [];
    try {
      audioEngine.playMeditativeIntroChime?.();
    } catch (e) {}
  };

  // 1. Eyes-Closed Alpha Calibration Loop (20s)
  useEffect(() => {
    if (step !== 'alpha-calibrate') return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        const bands = eegEngine.getLatestBands();
        if (bands && bands.alpha > 0) {
          eyesClosedAlphaSamplesRef.current.push(bands.alpha);
        }

        if (prev <= 1) {
          clearInterval(interval);
          setStep('focus-calibrate');
          setCountdown(10);
          try {
            audioEngine.playChime('breath-out');
          } catch (e) {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // 2. Cognitive Focus Calibration Loop (10s)
  useEffect(() => {
    if (step !== 'focus-calibrate') return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        const bands = eegEngine.getLatestBands();
        if (bands && bands.beta > 0) {
          focusBetaSamplesRef.current.push(bands.beta);
        }

        if (prev <= 1) {
          clearInterval(interval);
          computeAuthenticMetricsAndReveal();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // Calculate Authentic Metrics from Real EEG Buffers
  const computeAuthenticMetricsAndReveal = () => {
    // 1. Real Peak Alpha Frequency (PAF) directly from the FFT peak bin
    const realPaf = eegEngine.getLatestPeakAlphaHz() || 10.0;

    // 2. Real Alpha Reactivity (Eyes Closed Alpha vs Resting Eyes Open Alpha)
    const avgRestingAlpha =
      restingAlphaSamplesRef.current.length > 0
        ? restingAlphaSamplesRef.current.reduce((a, b) => a + b, 0) / restingAlphaSamplesRef.current.length
        : 1.0;

    const avgEyesClosedAlpha =
      eyesClosedAlphaSamplesRef.current.length > 0
        ? eyesClosedAlphaSamplesRef.current.reduce((a, b) => a + b, 0) / eyesClosedAlphaSamplesRef.current.length
        : avgRestingAlpha;

    const measuredReactivity =
      avgRestingAlpha > 0 ? Math.round(((avgEyesClosedAlpha - avgRestingAlpha) / avgRestingAlpha) * 100) : 0;

    // 3. Real Cognitive Dynamic Range (Focus Beta vs Resting Beta)
    const avgRestingBeta =
      restingBetaSamplesRef.current.length > 0
        ? restingBetaSamplesRef.current.reduce((a, b) => a + b, 0) / restingBetaSamplesRef.current.length
        : 1.0;

    const avgFocusBeta =
      focusBetaSamplesRef.current.length > 0
        ? focusBetaSamplesRef.current.reduce((a, b) => a + b, 0) / focusBetaSamplesRef.current.length
        : avgRestingBeta;

    const measuredDynamicRange =
      avgRestingBeta > 0 ? parseFloat((avgFocusBeta / avgRestingBeta).toFixed(1)) : 1.0;

    // 4. Real Signal Purity (True measured percentage, no fake floors)
    const goodCount = Object.values(channelQuality).filter((q) => q === 'good').length;
    const measuredPurity = Math.round((goodCount / 4) * 100);

    setFinalMetrics({
      alphaPeakHz: realPaf,
      alphaReactivityPercent: measuredReactivity,
      cognitiveDynamicRange: Math.max(0.5, measuredDynamicRange),
      signalPurityPercent: Math.max(0, Math.min(100, measuredPurity)),
    });

    try {
      audioEngine.playChime('complete');
    } catch (e) {}

    setStep('reveal');
  };

  // Save Baseline to Profile & Continue
  const handleSaveNeuralImprint = async () => {
    setSavingBaseline(true);
    try {
      const getStats = (arr: number[]) => {
        if (arr.length === 0) return { mean: 0, std: 0.1 };
        const m = arr.reduce((a, b) => a + b, 0) / arr.length;
        const variance = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / arr.length;
        return { mean: Number(m.toFixed(2)), std: Math.max(0.1, Number(Math.sqrt(variance).toFixed(2))) };
      };

      const thetaStats = getStats(restingThetaSamplesRef.current);
      const alphaStats = getStats(
        eyesClosedAlphaSamplesRef.current.length > 0
          ? eyesClosedAlphaSamplesRef.current
          : restingAlphaSamplesRef.current
      );
      const betaStats = getStats(
        focusBetaSamplesRef.current.length > 0
          ? focusBetaSamplesRef.current
          : restingBetaSamplesRef.current
      );

      // Compute authentic 1/f spectral slope from live spectrum
      const spectrum = eegEngine.getLatestSpectrum();
      let slope = 1.0;
      if (spectrum.length >= 8) {
        const validPoints = spectrum
          .filter((pt) => pt.freq >= 2 && pt.freq <= 35 && pt.power > 0)
          .map((pt) => ({ x: Math.log(pt.freq), y: Math.log(pt.power) }));
        if (validPoints.length > 4) {
          const n = validPoints.length;
          const sumX = validPoints.reduce((s, p) => s + p.x, 0);
          const sumY = validPoints.reduce((s, p) => s + p.y, 0);
          const sumXY = validPoints.reduce((s, p) => s + p.x * p.y, 0);
          const sumXX = validPoints.reduce((s, p) => s + p.x * p.x, 0);
          const calcSlope = (n * sumXY - sumX * sumY) / Math.max(1e-6, n * sumXX - sumX * sumX);
          slope = Math.min(2.5, Math.max(0.5, Math.abs(calcSlope)));
        }
      }

      eegEngine.individualBaselineModel = {
        alphaPeakHz: finalMetrics.alphaPeakHz,
        oneOverFSlope: Number(slope.toFixed(2)),
        lastCalibratedAt: new Date().toISOString(),
        thetaMean: thetaStats.mean,
        thetaStd: thetaStats.std,
        betaMean: betaStats.mean,
        betaStd: betaStats.std,
        alphaMean: alphaStats.mean,
        alphaStd: alphaStats.std,
      };

      if (user) {
        const client = await storageEngine.getCurrentClient(user);
        if (client) {
          const updated = {
            ...client,
            individualBaselineModel: eegEngine.individualBaselineModel,
            status: 'active' as const,
          };
          await storageEngine.saveClient(updated);
        }
      }

      navigate('/');
    } catch (err) {
      console.warn('Error saving baseline model:', err);
      navigate('/');
    } finally {
      setSavingBaseline(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        backgroundColor: 'var(--surface-patient-base, #F8F7F4)',
        color: 'var(--text-primary, #1A1A1A)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'calc(20px + env(safe-area-inset-top, 0px)) 16px calc(28px + env(safe-area-inset-bottom, 0px))',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          width: '100%',
          maxWidth: '640px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BrandLogo size={30} variant="terracotta" />
          <div>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary, #6B6560)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              Waveable Live Telemetry
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
              {step === 'pair' ? 'Physical Pairing' : `${deviceName} • Live Hardware Stream`}
            </div>
          </div>
        </div>

        {step !== 'reveal' && (
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary, #8C8578)',
              fontSize: '13px',
              cursor: 'pointer',
              padding: '6px 10px',
            }}
          >
            Skip to Dashboard
          </button>
        )}
      </header>

      {/* ─────────────────────────────────────────────────────────────
          STEP 1: PHYSICAL BLUETOOTH PAIRING
          ───────────────────────────────────────────────────────────── */}
      {step === 'pair' && (
        <div
          style={{
            width: '100%',
            maxWidth: '440px',
            margin: 'auto 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: 'var(--surface-patient-card, #FFFFFF)',
              border: '1px solid var(--border-default, #E8E6E1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '20px',
              boxShadow: '0 8px 24px rgba(209, 109, 77, 0.12)',
            }}
          >
            <Bluetooth size={38} color="var(--brand-primary, #D16D4D)" />
          </div>

          <h1
            className="font-display"
            style={{
              fontSize: '30px',
              fontWeight: 400,
              lineHeight: 1.25,
              color: 'var(--text-primary, #1A1A1A)',
              margin: '0 0 10px',
            }}
          >
            Connect your Muse Headband
          </h1>

          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary, #6B6560)',
              lineHeight: 1.55,
              maxWidth: '360px',
              margin: '0 0 28px',
            }}
          >
            Power on your Muse 2 or Muse S headband and position it comfortably around your forehead and behind both ears.
          </p>

          {connectionError && (
            <div
              style={{
                background: '#FDF0F0',
                border: '1px solid #F3CECE',
                color: '#C46060',
                padding: '12px 16px',
                borderRadius: 'var(--radius-md, 12px)',
                fontSize: '13px',
                lineHeight: 1.45,
                marginBottom: '20px',
                textAlign: 'left',
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}
            >
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>{connectionError}</div>
            </div>
          )}

          <button
            onClick={handleConnectHardware}
            disabled={connecting}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '16px',
              borderRadius: 'var(--radius-xl, 20px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              backgroundColor: 'var(--brand-primary, #D16D4D)',
              color: '#FFFFFF',
              border: 'none',
              cursor: connecting ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
            }}
          >
            {connecting ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Searching for Muse Headband...</span>
              </>
            ) : (
              <>
                <span>Pair Muse Headband</span>
                <ChevronRight size={18} />
              </>
            )}
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 2: SENSOR CONTACT FIT
          ───────────────────────────────────────────────────────────── */}
      {step === 'fit' && (
        <div
          style={{
            width: '100%',
            maxWidth: '640px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h2 className="font-display" style={{ fontSize: '26px', fontWeight: 400, margin: '0 0 4px' }}>
              Check Electrode Contact
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary, #6B6560)' }}>
              Watch the physical scalp sensors seat against your skin in real time.
            </p>
          </div>

          {/* 4 Sensor Quality Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {[
              { id: 'tp9', name: 'TP9', desc: 'Left Ear' },
              { id: 'af7', name: 'AF7', desc: 'Left Brow' },
              { id: 'af8', name: 'AF8', desc: 'Right Brow' },
              { id: 'tp10', name: 'TP10', desc: 'Right Ear' },
            ].map((sensor) => {
              const q = channelQuality[sensor.id as keyof MuseChannelQuality];
              const isGood = q === 'good';
              const isFair = q === 'fair';
              return (
                <div
                  key={sensor.id}
                  style={{
                    background: 'var(--surface-patient-card, #FFFFFF)',
                    border: `1px solid ${isGood ? '#10B981' : isFair ? '#F59E0B' : 'var(--border-default, #E8E6E1)'}`,
                    borderRadius: 'var(--radius-md, 12px)',
                    padding: '10px 6px',
                    textAlign: 'center',
                    transition: 'all 0.3s ease',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      margin: '0 auto 4px',
                      backgroundColor: isGood ? '#10B981' : isFair ? '#F59E0B' : '#EF4444',
                    }}
                  />
                  <div style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>
                    {sensor.name}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)' }}>{sensor.desc}</div>
                </div>
              );
            })}
          </div>

          <LiveBrainwaveCanvas height={340} initialMode="raw" allowModeSwitching={true} />

          <button
            onClick={handleProceedToPlayground}
            disabled={goodChannelsCount < 2}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '16px',
              borderRadius: 'var(--radius-xl, 20px)',
              backgroundColor: 'var(--brand-primary, #D16D4D)',
              color: '#FFFFFF',
              border: 'none',
              cursor: goodChannelsCount < 2 ? 'not-allowed' : 'pointer',
              opacity: goodChannelsCount < 2 ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
            }}
          >
            <span>Proceed to Live Wave Visualizer</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 3: INTERACTIVE BRAINWAVE PLAYGROUND (Play Around & See Wave Impact)
          ───────────────────────────────────────────────────────────── */}
      {step === 'playground' && (
        <div
          style={{
            width: '100%',
            maxWidth: '640px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <h2 className="font-display" style={{ fontSize: '26px', fontWeight: 400, margin: '0 0 4px' }}>
              Live Brainwave Studio
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary, #6B6560)' }}>
              Interact with your living brainwaves. Try the physical tests below to see instant biometric response.
            </p>
          </div>

          {/* Interactive Action Prompt Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
            }}
          >
            {/* Action 1: Blink */}
            <div
              style={{
                background: blinkDetected ? '#F0FDF4' : 'var(--surface-patient-card, #FFFFFF)',
                border: `1px solid ${blinkDetected ? '#86EFAC' : 'var(--border-default, #E8E6E1)'}`,
                borderRadius: 'var(--radius-md, 10px)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
              }}
            >
              {blinkDetected ? <CheckCircle2 size={16} color="#10B981" /> : <Eye size={16} color="#E8967A" />}
              <div>
                <div style={{ fontWeight: 600 }}>1. Blink Firmly</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)' }}>
                  {blinkDetected ? 'Frontal spike verified' : 'Spikes AF7/AF8'}
                </div>
              </div>
            </div>

            {/* Action 2: Jaw Clench */}
            <div
              style={{
                background: clenchDetected ? '#F0FDF4' : 'var(--surface-patient-card, #FFFFFF)',
                border: `1px solid ${clenchDetected ? '#86EFAC' : 'var(--border-default, #E8E6E1)'}`,
                borderRadius: 'var(--radius-md, 10px)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
              }}
            >
              {clenchDetected ? <CheckCircle2 size={16} color="#10B981" /> : <Sparkles size={16} color="#C4A35A" />}
              <div>
                <div style={{ fontWeight: 600 }}>2. Clench Teeth</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)' }}>
                  {clenchDetected ? 'EMG noise verified' : 'Spikes TP9/TP10'}
                </div>
              </div>
            </div>

            {/* Action 3: Close Eyes (Alpha) */}
            <div
              style={{
                background: eyesClosedSurgeSeen ? '#F5F3FF' : 'var(--surface-patient-card, #FFFFFF)',
                border: `1px solid ${eyesClosedSurgeSeen ? '#DDD6FE' : 'var(--border-default, #E8E6E1)'}`,
                borderRadius: 'var(--radius-md, 10px)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
              }}
            >
              {eyesClosedSurgeSeen ? <CheckCircle2 size={16} color="#7B68AE" /> : <Compass size={16} color="#7B68AE" />}
              <div>
                <div style={{ fontWeight: 600 }}>3. Close Eyes & Breathe</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)' }}>
                  {eyesClosedSurgeSeen ? 'Alpha surge verified (+35%)' : 'Watch Alpha swell'}
                </div>
              </div>
            </div>

            {/* Action 4: Mental Math (Beta) */}
            <div
              style={{
                background: focusBetaSpikeSeen ? '#FEFCE8' : 'var(--surface-patient-card, #FFFFFF)',
                border: `1px solid ${focusBetaSpikeSeen ? '#FEF08A' : 'var(--border-default, #E8E6E1)'}`,
                borderRadius: 'var(--radius-md, 10px)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
              }}
            >
              {focusBetaSpikeSeen ? <CheckCircle2 size={16} color="#CA8A04" /> : <Brain size={16} color="#C4A35A" />}
              <div>
                <div style={{ fontWeight: 600 }}>4. Multiply 17 × 14</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary, #8C8578)' }}>
                  {focusBetaSpikeSeen ? 'Beta activation verified' : 'Watch Beta ripple'}
                </div>
              </div>
            </div>
          </div>

          {/* Full Interactive Live Multi-Mode Canvas */}
          <LiveBrainwaveCanvas
            height={380}
            initialMode="raw"
            allowModeSwitching={true}
            onBlinkDetected={handleBlinkDetected}
            onClenchDetected={handleClenchDetected}
          />

          {/* Calibrate Baseline CTA */}
          <button
            onClick={handleStartCalibration}
            className="btn btn-primary"
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '16px',
              borderRadius: 'var(--radius-xl, 20px)',
              backgroundColor: 'var(--brand-primary, #D16D4D)',
              color: '#FFFFFF',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
              marginTop: '4px',
            }}
          >
            <span>Record My Baseline & Create Imprint</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 4: EYES-CLOSED ALPHA CALIBRATION (20s)
          ───────────────────────────────────────────────────────────── */}
      {step === 'alpha-calibrate' && (
        <div
          style={{
            width: '100%',
            maxWidth: '640px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'fadeIn 0.4s ease-out',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '9999px',
                background: 'rgba(123, 104, 174, 0.12)',
                color: '#7B68AE',
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                marginBottom: '8px',
              }}
            >
              <Eye size={14} /> STAGE 1: INTRINSIC ALPHA RHYTHM
            </div>
            <h2 className="font-display" style={{ fontSize: '28px', fontWeight: 400, margin: '0 0 6px' }}>
              Close your eyes and breathe naturally
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary, #6B6560)' }}>
              Measuring real temporal alpha power and peak frequency ({countdown}s remaining)
            </p>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--border-default, #E8E6E1)',
              borderRadius: '9999px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${((20 - countdown) / 20) * 100}%`,
                height: '100%',
                backgroundColor: '#7B68AE',
                transition: 'width 1s linear',
              }}
            />
          </div>

          <LiveBrainwaveCanvas
            height={360}
            initialMode="bands"
            allowModeSwitching={true}
            isCalibratingEyesClosed={true}
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 5: COGNITIVE FOCUS CALIBRATION (10s)
          ───────────────────────────────────────────────────────────── */}
      {step === 'focus-calibrate' && (
        <div
          style={{
            width: '100%',
            maxWidth: '640px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'fadeIn 0.4s ease-out',
            textAlign: 'center',
          }}
        >
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                borderRadius: '9999px',
                background: 'rgba(196, 163, 90, 0.15)',
                color: '#C4A35A',
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                marginBottom: '8px',
              }}
            >
              <Brain size={14} /> STAGE 2: FOCUS DYNAMIC RANGE
            </div>
            <h2 className="font-display" style={{ fontSize: '28px', fontWeight: 400, margin: '0 0 6px' }}>
              Count backward from 50 by 3s
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary, #6B6560)' }}>
              50... 47... 44... ({countdown}s remaining)
            </p>
          </div>

          {/* Progress Bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--border-default, #E8E6E1)',
              borderRadius: '9999px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${((10 - countdown) / 10) * 100}%`,
                height: '100%',
                backgroundColor: '#C4A35A',
                transition: 'width 1s linear',
              }}
            />
          </div>

          <LiveBrainwaveCanvas
            height={360}
            initialMode="bands"
            allowModeSwitching={true}
            isCalibratingFocus={true}
          />
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STEP 6: REVEAL NEURAL IMPRINT CARD (Real Measured Stats)
          ───────────────────────────────────────────────────────────── */}
      {step === 'reveal' && (
        <NeuralImprintCard
          alphaPeakHz={finalMetrics.alphaPeakHz}
          alphaReactivityPercent={finalMetrics.alphaReactivityPercent}
          cognitiveDynamicRange={finalMetrics.cognitiveDynamicRange}
          signalPurityPercent={finalMetrics.signalPurityPercent}
          patientName={user?.displayName?.split(' ')[0] || 'Patient'}
          deviceName={deviceName}
          onSave={handleSaveNeuralImprint}
          saving={savingBaseline}
        />
      )}
    </div>
  );
};
