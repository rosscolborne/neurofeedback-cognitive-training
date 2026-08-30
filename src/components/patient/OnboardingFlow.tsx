import React, { useState } from 'react';
import { ClientProfile, ProtocolType } from '../../types';
import { eegEngine } from '../../services/eegEngine';
import { HeadsetFitModal } from './HeadsetFitModal';
import { BrandLogo } from '../brand/BrandLogo';
import { ArrowRight, Check, Sparkles, Wifi, ShieldCheck, Target, Waves, Zap, Moon, Activity } from 'lucide-react';

interface OnboardingFlowProps {
  client: ClientProfile;
  onFinish: (updatedClient: Partial<ClientProfile>) => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ client, onFinish }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedGoal, setSelectedGoal] = useState<string>('focus');
  const [isPairing, setIsPairing] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [pairedDeviceName, setPairedDeviceName] = useState<string | null>(null);
  const [showFitModal, setShowFitModal] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const handlePairHeadband = async () => {
    setIsPairing(true);
    setPairingError(null);
    const res = await eegEngine.connectMuseBluetooth();
    setIsPairing(false);
    if (res.success) {
      setIsPaired(true);
      setPairedDeviceName(res.deviceName || 'Muse Headband (4-Ch Active)');
      setShowFitModal(true);
    } else {
      setPairingError('Bluetooth pairing failed or was cancelled. Please try again.');
    }
  };

  const handleComplete = () => {
    let assignedProtocol: ProtocolType = 'theta-beta-ratio';
    if (selectedGoal === 'calm') assignedProtocol = 'alpha-enhancement';
    if (selectedGoal === 'sleep') assignedProtocol = 'beta-downtraining';
    if (selectedGoal === 'performance') assignedProtocol = 'smr-enhancement';

    onFinish({
      assignedProtocol,
    });
  };

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100dvh',
        maxWidth: '480px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Step Indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: step === 1 ? '0' : '20px' }}>
        {[1, 2, 3].map(s => (
          <div
            key={s}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: s === step ? 'var(--brand-primary)' : 'var(--border-default)',
              transition: 'all 0.2s ease',
            }}
          />
        ))}
      </div>

      {/* Step 1: Welcome & Overview (Properly Centered) */}
      {step === 1 && (
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            margin: 'auto 0',
            animation: 'fadeIn 0.4s ease-out',
          }}
        >
          <div style={{ margin: '8px 0' }}>
            <BrandLogo size={104} variant="terracotta" glow />
          </div>

          <h1
            className="font-display"
            style={{ fontSize: '30px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.25, margin: 0 }}
          >
            Welcome to your<br />brain training journey
          </h1>

          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '320px', lineHeight: 1.55, margin: 0 }}>
            Personalized neurofeedback sessions to help you focus, relax, and perform at your best using real-time EEG biofeedback.
          </p>

          <button
            onClick={() => setStep(2)}
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '16px',
              fontSize: '16px',
              marginTop: '12px',
              boxShadow: '0 4px 18px rgba(209, 109, 77, 0.25)',
            }}
          >
            Get Started <ArrowRight size={18} />
          </button>
        </div>
      )}

      {/* Step 2: Clinical Goal Selection */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2 className="font-display" style={{ fontSize: '26px', color: 'var(--text-primary)' }}>
              What is your primary training intention?
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              This helps us personalize your training protocol.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { id: 'focus', title: 'ADHD & Focus Enhancement', desc: 'Downregulate theta waves, sharpen executive attention & impulse control', icon: Target },
              { id: 'calm', title: 'Anxiety Relief & Emotional Calm', desc: 'Upregulate alpha waves to enter serene, grounded mental stillness', icon: Waves },
              { id: 'performance', title: 'Sensorimotor (SMR) Peak Poise', desc: 'Still body, active mind training for high-demand cognitive tasks', icon: Zap },
              { id: 'sleep', title: 'Stress Reduction & Deep Rest', desc: 'Downtrain high-frequency beta tension before evening wind-down', icon: Moon },
            ].map(goal => {
              const Icon = goal.icon;
              return (
                <div
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal.id)}
                  className="card-patient"
                  style={{
                    cursor: 'pointer',
                    border: selectedGoal === goal.id ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                    backgroundColor: selectedGoal === goal.id ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-card)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '16px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: selectedGoal === goal.id ? 'var(--brand-primary)' : 'var(--surface-patient-recessed)',
                      color: selectedGoal === goal.id ? '#FFFFFF' : 'var(--brand-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{goal.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{goal.desc}</div>
                  </div>
                  {selectedGoal === goal.id && <Check size={20} color="var(--brand-primary)" />}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setStep(3)}
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '16px', marginTop: '10px' }}
          >
            Continue <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Step 3: Headband Pairing & Baseline */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'center' }}>
          <div>
            <h2 className="font-display" style={{ fontSize: '26px', color: 'var(--text-primary)' }}>
              Pair EEG Headband
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Connect your Muse 2, Muse S, or run high-precision biological simulation.
            </p>
          </div>

          <div
            className="card-patient"
            style={{
              padding: '32px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                backgroundColor: isPaired ? 'var(--status-active-bg)' : 'var(--surface-patient-recessed)',
                color: isPaired ? 'var(--status-active)' : 'var(--brand-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isPaired ? <Check size={36} /> : <Wifi size={36} />}
            </div>

            <div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isPaired ? pairedDeviceName : 'Ready to Connect'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {isPaired ? 'Headset connected and signal verified' : 'Place headband snugly across your forehead.'}
              </div>
            </div>

            {!isPaired ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', marginTop: '8px' }}>
                <button
                  onClick={handlePairHeadband}
                  disabled={isPairing}
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                >
                  {isPairing ? 'Connecting...' : 'Connect Muse Headband'}
                </button>
                {pairingError && (
                  <div style={{ fontSize: '13px', color: '#D32F2F', textAlign: 'center' }}>
                    {pairingError}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowFitModal(true)}
                className="btn btn-secondary"
                style={{ marginTop: '8px', fontSize: '13px' }}
              >
                <Activity size={15} color="#10B981" />
                Check Sensor Contact
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
            <ShieldCheck size={14} />
            <span>Clinical HIPAA & GDPR Compliant Telemetry</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
            <button
              onClick={handleComplete}
              className="btn btn-primary"
              style={{ width: '100%', padding: '16px', fontSize: '16px' }}
            >
              Enter Patient Portal
            </button>
            
            {!isPaired && (
              <button
                onClick={handleComplete}
                className="btn btn-ghost"
                style={{ width: '100%', fontSize: '14px' }}
              >
                Continue without Headband (Audio-Only Mode)
              </button>
            )}
          </div>
        </div>
      )}

      {showFitModal && (
        <HeadsetFitModal
          onConfirmReady={() => setShowFitModal(false)}
          onClose={() => setShowFitModal(false)}
        />
      )}
    </div>
  );
};
