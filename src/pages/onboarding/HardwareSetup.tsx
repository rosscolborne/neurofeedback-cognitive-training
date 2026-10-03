import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bluetooth, ChevronRight, AlertCircle, RefreshCw } from 'lucide-react';
import { eegEngine } from '../../services/eegEngine';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { MuseChannelQuality } from '../../types';

type SetupStep = 'pair' | 'fit';

interface HardwareSetupProps {
  /** Test-only entry seam; production always begins at hardware pairing. */
  initialStep?: SetupStep;
}

/**
 * Optional headset setup: pair a Muse, then check its fit. Nothing here is
 * needed to play, and nothing is calibrated or saved.
 */
export const HardwareSetup: React.FC<HardwareSetupProps> = ({ initialStep = 'pair' }) => {
  const navigate = useNavigate();
  // Replaces this step in history, so the browser's Back from Home never reopens setup.
  const leaveSetup = () => navigate('/', { replace: true });

  const [step, setStep] = useState<SetupStep>(initialStep);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [deviceName, setDeviceName] = useState('Muse Headband');

  // Electrode fit state
  const [channelQuality, setChannelQuality] = useState<MuseChannelQuality>({
    tp9: 'poor',
    af7: 'poor',
    af8: 'poor',
    tp10: 'poor',
  });

  // Follow the live fit assessment
  useEffect(() => {
    return eegEngine.subscribe((data) => {
      setChannelQuality({ ...data.channelQuality });
    });
  }, []);

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

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        backgroundColor: 'var(--surface-base, #F8F7F4)',
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
              Headset setup
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #8C8578)' }}>
              {step === 'pair' ? 'Optional' : `${deviceName} connected`}
            </div>
          </div>
        </div>

        <button
          onClick={leaveSetup}
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
              backgroundColor: 'var(--surface-card, #FFFFFF)',
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
              Adjust the headband until at least two sensors show green.
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
                    background: 'var(--surface-card, #FFFFFF)',
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

          <button
            onClick={leaveSetup}
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
            <span>Continue</span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
};
