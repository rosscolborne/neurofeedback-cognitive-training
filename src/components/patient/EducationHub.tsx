import React, { useState, useEffect } from 'react';
import { audioEngine } from '../../services/audioEngine';
import { BookOpen, Activity, Sparkles, Brain, CheckCircle, HelpCircle, Volume2, ShieldCheck, ChevronRight } from 'lucide-react';

export const EducationHub: React.FC = () => {
  const [activeBand, setActiveBand] = useState<'delta' | 'theta' | 'alpha' | 'smr' | 'beta' | 'gamma'>('alpha');
  const [waveTime, setWaveTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setWaveTime(t => t + 0.08);
    }, 40);
    return () => clearInterval(interval);
  }, []);

  const BAND_INFO = {
    delta: {
      name: 'Delta Waves',
      range: '0.5 – 4 Hz',
      state: 'Deep Restorative Sleep & Somatic Healing',
      desc: 'The slowest, highest-amplitude brainwaves. Prominent during dreamless sleep, cellular restoration, and deep unconscious states.',
      color: 'var(--chart-delta)',
      freqVal: 2,
    },
    theta: {
      name: 'Theta Waves',
      range: '4 – 8 Hz',
      state: 'Deep Meditation, Daydreaming & Twilight',
      desc: 'Associated with intuition, creative imagery, and memory consolidation. In ADHD, excessive daytime frontal theta correlates with inattention.',
      color: 'var(--chart-theta)',
      freqVal: 6,
    },
    alpha: {
      name: 'Alpha Waves',
      range: '8 – 12 Hz',
      state: 'Calm Alertness, Mental Quiet & Grounding',
      desc: 'The bridge between conscious and subconscious. Increases when you close your eyes or relax. Key training target for anxiety alleviation.',
      color: 'var(--chart-alpha)',
      freqVal: 10,
    },
    smr: {
      name: 'Sensorimotor Rhythm (SMR)',
      range: '12 – 15 Hz',
      state: 'Physical Stillness & Focused Poise',
      desc: 'Originates from the sensorimotor cortex. Elevated when the body is physically still while the mind remains acutely alert and attentive.',
      color: 'var(--chart-smr)',
      freqVal: 13.5,
    },
    beta: {
      name: 'Beta Waves',
      range: '15 – 30 Hz',
      state: 'Active Cognition, Problem Solving & Focus',
      desc: 'Fast, low-amplitude oscillations required for logical thinking, executive decision-making, and conversational engagement.',
      color: 'var(--chart-beta)',
      freqVal: 20,
    },
    gamma: {
      name: 'Gamma Waves',
      range: '30 – 50 Hz',
      state: 'Simultaneous Multi-Sensory Information Binding',
      desc: 'The fastest frequency band. Reflects high-level neural synchrony, insight moments, and peak cognitive integration.',
      color: 'var(--chart-gamma)',
      freqVal: 38,
    },
  };

  const current = BAND_INFO[activeBand];

  // Play auditory demonstration of the frequency tone
  const playTone = () => {
    audioEngine.playChime('breath-in');
  };

  // Generate live SVG waveform based on selected frequency
  const points = Array.from({ length: 70 }, (_, i) => {
    const x = (i / 69) * 360 + 10;
    const y = 60 + Math.sin(i * (current.freqVal * 0.08) + waveTime * (current.freqVal * 0.4)) * 32;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {/* Header */}
      <div>
        <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
          Neurofeedback Science Hub
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Understand how brainwave biofeedback shapes neuroplasticity and cognitive function.
        </p>
      </div>

      {/* 1. Interactive Frequency Explorer */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Interactive Band Explorer
            </div>
            <div className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
              {current.name} ({current.range})
            </div>
          </div>
          <button
            onClick={playTone}
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '6px 10px', gap: '4px' }}
          >
            <Volume2 size={15} /> Audio Cue
          </button>
        </div>

        {/* Live Frequency Waveform Visualizer */}
        <div
          style={{
            width: '100%',
            height: '120px',
            backgroundColor: 'var(--surface-patient-recessed)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            marginBottom: '16px',
            position: 'relative',
          }}
        >
          <svg viewBox="0 0 380 120" style={{ width: '100%', height: '100%' }}>
            <line x1="10" y1="60" x2="370" y2="60" stroke="var(--border-default)" strokeWidth="1" strokeDasharray="3 3" />
            <polyline
              fill="none"
              stroke={current.color}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              right: 12,
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
            }}
          >
            {current.freqVal} Hz Oscillation
          </div>
        </div>

        {/* Band Selector Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
          {(['delta', 'theta', 'alpha', 'smr', 'beta', 'gamma'] as const).map(b => (
            <button
              key={b}
              onClick={() => setActiveBand(b)}
              style={{
                padding: '8px',
                borderRadius: 'var(--radius-sm)',
                border: activeBand === b ? '1.5px solid var(--brand-primary)' : '1px solid var(--border-default)',
                backgroundColor: activeBand === b ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-card)',
                color: activeBand === b ? 'var(--brand-primary)' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                transition: 'all 0.15s ease',
              }}
            >
              {b}
            </button>
          ))}
        </div>

        <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          <strong>Mental State:</strong> {current.state}<br />
          <span style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'inline-block' }}>
            {current.desc}
          </span>
        </div>
      </div>

      {/* 2. How Neurofeedback Operant Conditioning Works */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)', marginBottom: '12px' }}>
          The Neuroplastic Feedback Loop
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
          Your brain learns through immediate rewards—the same way athletes refine muscle coordination through repetition.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            {
              step: '01',
              title: 'Sensors Measure Electrical Oscillations',
              desc: 'Microvolt sensors on your forehead detect micro-second brainwave patterns with zero electrical output to your head.',
            },
            {
              step: '02',
              title: 'Adaptive Reward Signal Fires',
              desc: 'When your brain enters your target focus or calm zone, the app responds: music clears, glider climbs, or video brightens.',
            },
            {
              step: '03',
              title: 'Synaptic Reinforcement (Neuroplasticity)',
              desc: 'Through consistent 25-minute sessions, your brain builds stronger neural pathways to trigger that optimal state automatically during daily tasks.',
            },
          ].map(item => (
            <div
              key={item.step}
              style={{
                display: 'flex',
                gap: '14px',
                padding: '12px',
                background: 'var(--surface-patient-recessed)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  paddingTop: '2px',
                }}
              >
                {item.step}
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Headband Fit & Sensor Troubleshooting */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <ShieldCheck size={20} color="var(--brand-primary)" />
          <h2 className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            Electrode Placement & Artifact Prevention
          </h2>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>• <strong>Forehead Sensors (AF7, AF8):</strong> Ensure the band rests flat ~1 inch above your eyebrows, free of hair strands.</div>
          <div>• <strong>Ear Hook Sensors (TP9, TP10):</strong> Hook behind both ears with firm skin contact against the mastoid bone.</div>
          <div>• <strong>Facial Muscle Stillness:</strong> Jaw clenching or squinting creates EMG muscle noise. Relax your jaw and tongue during training.</div>
        </div>
      </div>
    </div>
  );
};
