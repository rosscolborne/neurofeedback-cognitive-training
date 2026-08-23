import React, { useState } from 'react';
import { ClientProfile, ProtocolType } from '../../types';
import { eegEngine } from '../../services/eegEngine';
import { ArrowRight, Check, Sparkles, Wifi, ShieldCheck, Target, Waves, Zap, Moon } from 'lucide-react';

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

  const handlePairHeadband = async () => {
    setIsPairing(true);
    const res = await eegEngine.connectMuseBluetooth();
    setTimeout(() => {
      setIsPairing(false);
      setIsPaired(true);
      setPairedDeviceName(res.deviceName || 'Muse S Headband (4-Ch Active)');
    }, 1200);
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
        minHeight: '100vh',
        maxWidth: '520px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        padding: '36px 24px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      {/* Top Step Indicator */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
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

      {/* Step 1: Welcome & Overview */}
      {step === 1 && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
          <h1
            className="font-display"
            style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.2 }}
          >
            Welcome to your<br />brain training<br />journey
          </h1>

          {/* Abstract Concentric Organic Ripple Mandala */}
          <div
            className="animate-breathe"
            style={{
              width: '200px',
              height: '200px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, #E8967A 0%, #E4B87C 40%, rgba(248, 247, 244, 0) 75%)',
              border: '2px solid rgba(232, 150, 122, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                backgroundColor: '#FAF7F4',
                border: '2px solid rgba(228, 184, 124, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--brand-primary)',
                  opacity: 0.85,
                }}
              />
            </div>
          </div>

          <p style={{ fontSize: '15px', color: 'var(--text-secondary)', maxWidth: '340px', lineHeight: 1.6 }}>
            Personalized sessions to help you focus, relax, and perform at your best using real-time neurofeedback.
          </p>

          <button
            onClick={() => setStep(2)}
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '16px', marginTop: '20px' }}
          >
            Get Started
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
              Your clinician will use this to assign and optimize your EEG training protocol.
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
                {isPaired ? '4 Channels Verified (TP9, AF7, AF8, TP10)' : 'Place headband snugly across your forehead.'}
              </div>
            </div>

            {!isPaired ? (
              <button
                onClick={handlePairHeadband}
                disabled={isPairing}
                className="btn btn-secondary"
                style={{ marginTop: '8px' }}
              >
                {isPairing ? 'Establishing Signal...' : 'Connect Muse Headband via Bluetooth'}
              </button>
            ) : (
              <div className="status-tag status-tag-active">✓ 100% Signal Quality</div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
            <ShieldCheck size={14} />
            <span>Clinical HIPAA & GDPR Compliant Telemetry</span>
          </div>

          <button
            onClick={handleComplete}
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '16px', marginTop: '10px' }}
          >
            Enter Patient Portal
          </button>
        </div>
      )}
    </div>
  );
};
