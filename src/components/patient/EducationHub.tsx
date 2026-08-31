import React, { useState, useEffect } from 'react';
import { audioEngine } from '../../services/audioEngine';
import { BookOpen, Activity, Brain, CheckCircle, HelpCircle, Volume2, ShieldCheck, ChevronRight, Zap, Heart, Eye, Lightbulb, Check, X, Target, Moon } from 'lucide-react';

// Quiz question data
const QUIZ_QUESTIONS = [
  {
    question: 'What do Alpha waves feel like?',
    options: ['Intense problem-solving', 'Calm alertness, like closing your eyes on a warm day', 'Deep sleep', 'Rapid mental calculations'],
    correctIndex: 1,
    explanation: 'Alpha waves (8-12 Hz) are the bridge between awake and subconscious — they increase when you close your eyes or feel relaxed but alert.',
  },
  {
    question: 'How does neurofeedback actually train your brain?',
    options: ['By sending electricity to your head', 'Through medication', 'By giving instant rewards when your brain enters the right state', 'By blocking certain brainwaves'],
    correctIndex: 2,
    explanation: 'Neurofeedback uses operant conditioning — your brain gets instant visual/audio rewards when it produces the target pattern, reinforcing those neural pathways over time.',
  },
  {
    question: 'What happens to focus in ADHD brains?',
    options: ['Too much Beta, not enough Alpha', 'Too much slow Theta relative to fast Beta', 'Gamma waves are overactive', 'All brainwaves shut down'],
    correctIndex: 1,
    explanation: 'ADHD is often linked to an elevated Theta/Beta ratio — too many slow "daydreaming" waves compared to fast "focus" waves in the frontal cortex.',
  },
];

// Relatable analogy cards for each brainwave band
const ANALOGIES = [
  { band: 'Delta', icon: Moon, analogy: 'Like being in deep, dreamless sleep — your body heals and resets', color: 'var(--chart-delta)' },
  { band: 'Theta', icon: Eye, analogy: 'Like daydreaming out a car window — creative, drifty, spacious', color: 'var(--chart-theta)' },
  { band: 'Alpha', icon: Heart, analogy: 'Like the calm after a warm shower — relaxed but aware', color: 'var(--chart-alpha)' },
  { band: 'SMR', icon: Target, analogy: 'Like focused physical poise — body still, mind sharp', color: 'var(--chart-smr)' },
  { band: 'Beta', icon: Lightbulb, analogy: 'Like engaging in active work — focused, structured thinking', color: 'var(--chart-beta)' },
  { band: 'Gamma', icon: Zap, analogy: 'Like a moment of insight — cognitive synthesis across regions', color: 'var(--chart-gamma)' },
];

export const EducationHub: React.FC = () => {
  const [activeBand, setActiveBand] = useState<'delta' | 'theta' | 'alpha' | 'smr' | 'beta' | 'gamma'>('alpha');
  const [waveTime, setWaveTime] = useState(0);
  const [quizStep, setQuizStep] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);
  const [expandedAnalogy, setExpandedAnalogy] = useState<number | null>(null);

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
      desc: 'The slowest brainwaves — like gentle ocean swells. They dominate during dreamless sleep when your body repairs cells, strengthens immunity, and consolidates deep memories.',
      color: 'var(--chart-delta)',
      freqVal: 2,
      brainRegion: 'Widespread during sleep',
    },
    theta: {
      name: 'Theta Waves',
      range: '4 – 8 Hz',
      state: 'Deep Meditation, Daydreaming & Twilight',
      desc: 'The "daydreaming" waves. When you lose yourself in a thought, zone out driving, or have creative breakthroughs — that\'s Theta. In ADHD, too much frontal Theta during the day makes it hard to focus.',
      color: 'var(--chart-theta)',
      freqVal: 6,
      brainRegion: 'Frontal & temporal lobes',
    },
    alpha: {
      name: 'Alpha Waves',
      range: '8 – 12 Hz',
      state: 'Calm Alertness & Mental Quiet',
      desc: 'Your brain\'s "idle mode" — relaxed but aware. Try closing your eyes right now — your Alpha waves just increased. Training Alpha helps with anxiety by teaching your brain to find this calm-alert sweet spot.',
      color: 'var(--chart-alpha)',
      freqVal: 10,
      brainRegion: 'Occipital (back of head)',
    },
    smr: {
      name: 'Sensorimotor Rhythm',
      range: '12 – 15 Hz',
      state: 'Physical Stillness & Focused Poise',
      desc: 'Like a cat watching a bird — your body is perfectly still while your mind is sharp. SMR training helps with impulse control and is commonly used for ADHD and motor control conditions.',
      color: 'var(--chart-smr)',
      freqVal: 13.5,
      brainRegion: 'Central sensorimotor strip',
    },
    beta: {
      name: 'Beta Waves',
      range: '15 – 30 Hz',
      state: 'Active Thinking & Problem Solving',
      desc: 'Your "working brain" frequency. Active during conversations, problem-solving, and focused work. Too much high Beta can feel like anxiety — too little can feel foggy.',
      color: 'var(--chart-beta)',
      freqVal: 20,
      brainRegion: 'Frontal cortex',
    },
    gamma: {
      name: 'Gamma Waves',
      range: '30 – 50 Hz',
      state: 'Peak Insight & Multi-Sensory Binding',
      desc: 'The fastest brainwaves — associated with "aha!" moments, peak performance, and experienced meditators. Gamma binds information from different brain areas into unified perception.',
      color: 'var(--chart-gamma)',
      freqVal: 38,
      brainRegion: 'Widespread cortical binding',
    },
  };

  const current = BAND_INFO[activeBand];

  // Play auditory demonstration
  const playTone = () => {
    audioEngine.playChime('breath-in');
  };

  // Generate live SVG waveform
  const points = Array.from({ length: 70 }, (_, i) => {
    const x = (i / 69) * 360 + 10;
    const y = 60 + Math.sin(i * (current.freqVal * 0.08) + waveTime * (current.freqVal * 0.4)) * 32;
    return `${x},${y}`;
  }).join(' ');

  const handleQuizAnswer = (answerIdx: number) => {
    setQuizAnswer(answerIdx);
    if (answerIdx === QUIZ_QUESTIONS[quizStep].correctIndex) {
      setQuizScore(s => s + 1);
    }
    setTimeout(() => {
      if (quizStep < QUIZ_QUESTIONS.length - 1) {
        setQuizStep(s => s + 1);
        setQuizAnswer(null);
      } else {
        setQuizComplete(true);
      }
    }, 1800);
  };

  const resetQuiz = () => {
    setQuizStep(0);
    setQuizAnswer(null);
    setQuizScore(0);
    setQuizComplete(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {/* Header */}
      <div>
        <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
          How It Works
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Understand your brain training in simple terms.
        </p>
      </div>

      {/* 1. "What Are Brainwaves?" — Relatable Analogy Cards */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <Lightbulb size={18} color="var(--brand-primary)" />
          <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
            What Are Brainwaves?
          </h2>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
          Your brain is always producing tiny electrical pulses. Different speeds create different mental states — just like how slow music calms you and fast music energizes you.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {ANALOGIES.map((a, idx) => (
            <div
              key={a.band}
              onClick={() => setExpandedAnalogy(expandedAnalogy === idx ? null : idx)}
              style={{
                background: expandedAnalogy === idx ? `${a.color}15` : 'var(--surface-patient-card)',
                border: expandedAnalogy === idx ? `1.5px solid ${a.color}` : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    backgroundColor: `${a.color}20`,
                    color: a.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <a.icon size={14} />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{a.band}</span>
              </div>
              {expandedAnalogy === idx && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4, marginTop: '2px' }}>
                  {a.analogy}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 2. Interactive Frequency Explorer */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Live Band Explorer
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
            <Volume2 size={15} /> Audio
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
            {current.freqVal} Hz
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
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            <Eye size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            Brain Region: {current.brainRegion}
          </div>
        </div>
      </div>

      {/* 3. Your Session Flow — Visual Timeline */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)', marginBottom: '16px' }}>
          What Happens in a Session
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {[
            { icon: Activity, label: 'Calibration', time: '~1 min', desc: 'We measure your baseline brainwave patterns', color: 'var(--chart-delta)' },
            { icon: Heart, label: 'Warm-up', time: '~2 min', desc: 'Gentle exercises ease your brain into training mode', color: 'var(--chart-alpha)' },
            { icon: Zap, label: 'Core Training', time: '~19 min', desc: 'Your brain gets real-time rewards for staying in the target zone', color: 'var(--brand-primary)' },
            { icon: Moon, label: 'Cool-down', time: '~2 min', desc: 'Gradual transition back to natural state', color: 'var(--chart-smr)' },
            { icon: CheckCircle, label: 'Summary', time: '~1 min', desc: 'Review your performance and log how you feel', color: 'var(--status-active)' },
          ].map((phase, idx, arr) => {
            const Icon = phase.icon;
            return (
              <div key={phase.label} style={{ display: 'flex', gap: '14px', position: 'relative' }}>
                {/* Timeline connector line */}
                {idx < arr.length - 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '15px',
                      top: '32px',
                      bottom: '-2px',
                      width: '2px',
                      background: 'var(--border-default)',
                    }}
                  />
                )}
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: `${phase.color}20`,
                    color: phase.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    zIndex: 1,
                  }}
                >
                  <Icon size={16} />
                </div>
                <div style={{ paddingBottom: idx < arr.length - 1 ? '20px' : '0', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{phase.label}</span>
                    <span className="font-mono" style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{phase.time}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{phase.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. How It Trains Your Brain */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)', marginBottom: '12px' }}>
          How Your Brain Learns
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
          Think of it like exercise for your brain — the same way your muscles get stronger with gym repetitions, your brain builds stronger pathways through feedback repetitions.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            {
              step: '01',
              title: 'Sensors Read Your Brainwaves',
              desc: 'Tiny sensors on your forehead detect your brain\'s electrical patterns — nothing goes into your head, it only reads what\'s already happening.',
            },
            {
              step: '02',
              title: 'You Get Instant Feedback',
              desc: 'When your brain enters the right state, good things happen — music plays clearer, your glider flies higher, or the video brightens. Your brain starts chasing that reward.',
            },
            {
              step: '03',
              title: 'Your Brain Gets Better Over Time',
              desc: 'With regular 25-minute sessions, your brain learns to enter these states more easily — even without the headband. Like riding a bike, it becomes automatic.',
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

      {/* 5. Quick Knowledge Check — Interactive Quiz */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <HelpCircle size={18} color="var(--brand-primary)" />
          <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
            Quick Knowledge Check
          </h2>
        </div>

        {!quizComplete ? (
          <>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
              Question {quizStep + 1} of {QUIZ_QUESTIONS.length}
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '14px', lineHeight: 1.4 }}>
              {QUIZ_QUESTIONS[quizStep].question}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {QUIZ_QUESTIONS[quizStep].options.map((opt, idx) => {
                const isSelected = quizAnswer === idx;
                const isCorrect = idx === QUIZ_QUESTIONS[quizStep].correctIndex;
                const showResult = quizAnswer !== null;
                return (
                  <button
                    key={idx}
                    onClick={() => quizAnswer === null && handleQuizAnswer(idx)}
                    disabled={quizAnswer !== null}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: showResult && isCorrect
                        ? '1.5px solid var(--status-active)'
                        : showResult && isSelected && !isCorrect
                        ? '1.5px solid var(--status-alert)'
                        : '1px solid var(--border-default)',
                      backgroundColor: showResult && isCorrect
                        ? 'var(--status-active-bg)'
                        : showResult && isSelected && !isCorrect
                        ? 'var(--status-alert-bg)'
                        : 'var(--surface-patient-card)',
                      textAlign: 'left',
                      fontSize: '13px',
                      color: 'var(--text-primary)',
                      cursor: quizAnswer === null ? 'pointer' : 'default',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    {showResult && isCorrect && <Check size={16} color="var(--status-active)" />}
                    {showResult && isSelected && !isCorrect && <X size={16} color="var(--status-alert)" />}
                    {opt}
                  </button>
                );
              })}
            </div>
            {quizAnswer !== null && (
              <div style={{
                marginTop: '12px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--brand-primary-subtle)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                lineHeight: 1.4,
              }}>
                <strong>💡 </strong>{QUIZ_QUESTIONS[quizStep].explanation}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>
              {quizScore === QUIZ_QUESTIONS.length ? '🎉' : quizScore >= 2 ? '👏' : '📚'}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {quizScore} / {QUIZ_QUESTIONS.length} Correct
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              {quizScore === QUIZ_QUESTIONS.length
                ? 'You really understand your brain!'
                : 'Keep exploring — understanding grows with each session.'}
            </div>
            <button
              onClick={resetQuiz}
              className="btn btn-secondary"
              style={{ fontSize: '13px', padding: '10px 24px' }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* 6. Headband & Sensor Guide */}
      <div className="card-patient" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <ShieldCheck size={20} color="var(--brand-primary)" />
          <h2 className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            Headband Placement Guide
          </h2>
        </div>

        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>• <strong>Forehead Sensors:</strong> Place the band flat about 1 inch above your eyebrows — make sure no hair is trapped underneath.</div>
          <div>• <strong>Ear Sensors:</strong> Hook snugly behind both ears — you should feel firm contact against the bone behind your ear.</div>
          <div>• <strong>Stay Still:</strong> Jaw clenching and squinting create noise. Relax your face and tongue during training.</div>
          <div>• <strong>Safe & Passive:</strong> The sensors only read your brain's natural electrical signals — nothing is sent into your head.</div>
        </div>
      </div>
    </div>
  );
};
