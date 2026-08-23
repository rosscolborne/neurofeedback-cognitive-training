import React, { useState } from 'react';
import { ClientProfile, ExperienceType } from '../../types';
import { Play, Flame, ChevronRight, Mountain, Waves, Wind, Target, Music, Tv, Headphones, Sparkles, BookOpen } from 'lucide-react';

interface HomeScreenProps {
  client: ClientProfile;
  onStartSession: (exp: ExperienceType) => void;
  onNavigateTab: (tab: 'home' | 'sessions' | 'education' | 'progress' | 'profile') => void;
}

const EXPERIENCES_META: Record<ExperienceType, { name: string; icon: React.FC<{ size?: number }>; desc: string; tag: string }> = {
  'skyline-drift': { name: 'Skyline Drift', icon: Mountain, desc: 'Sustained focus glider flight over procedural alpine biomes', tag: 'Focus' },
  'tidal-garden': { name: 'Tidal Garden', icon: Waves, desc: 'Zero-failure persistent marine garden powered by Alpha calm', tag: 'Calm' },
  'breath-weave': { name: 'Breath Weave', icon: Wind, desc: 'Harmonic loom tapestry synchronized with box/4-7-8 breathing', tag: 'Breathing' },
  'signal-sort': { name: 'Signal Sort', icon: Target, desc: 'SMR stillness gate & cognitive interference filter task', tag: 'Stillness' },
  'rhythm-lock': { name: 'Rhythm Lock', icon: Music, desc: 'Generative polyrhythmic music visualizer with layered synth feedback', tag: 'Focus' },
  'media-mode': { name: 'Media Mode', icon: Tv, desc: 'Watch streaming video with real-time neuro-luminosity modulation', tag: 'Universal' },
  'soundscape-mode': { name: 'Soundscape Mode', icon: Headphones, desc: 'Audio-only binaural & nature soundscapes for eyes-closed training', tag: 'Audio' },
  'mandala': { name: 'Mandala Breathing', icon: Sparkles, desc: 'Calm concentric breathing mandala with live µV telemetry', tag: 'Calm' },
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  client,
  onStartSession,
  onNavigateTab,
}) => {
  const [selectedExp, setSelectedExp] = useState<ExperienceType>(client.allowedExperiences[0] || 'skyline-drift');

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIndex = new Date().getDay();

  const ActiveIcon = EXPERIENCES_META[selectedExp].icon;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* Greeting Header */}
      <div>
        <h1
          className="font-display"
          style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15 }}
        >
          Good morning,<br />{client.name.split(' ')[0]}.
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Assigned Protocol: <strong style={{ color: 'var(--text-primary)' }}>{client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</strong>
        </p>
      </div>

      {/* Today's Prescribed Session Card */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Prescribed Training Session
            </div>
            <div className="font-display" style={{ fontSize: '22px', color: 'var(--text-primary)', marginTop: '2px' }}>
              {EXPERIENCES_META[selectedExp].name}
            </div>
          </div>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--brand-primary-subtle)',
              color: 'var(--brand-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActiveIcon size={22} />
          </div>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {EXPERIENCES_META[selectedExp].desc}
        </p>

        {/* Experience Selector Pills */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
          {client.allowedExperiences.map(exp => {
            const Icon = EXPERIENCES_META[exp].icon;
            return (
              <button
                key={exp}
                onClick={() => setSelectedExp(exp)}
                style={{
                  background: selectedExp === exp ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-recessed)',
                  border: selectedExp === exp ? '1.5px solid var(--brand-primary)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: selectedExp === exp ? 'var(--brand-primary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Icon size={14} /> {EXPERIENCES_META[exp].name}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onStartSession(selectedExp)}
          className="btn btn-primary"
          style={{ width: '100%', padding: '16px', fontSize: '16px' }}
        >
          <Play size={18} fill="currentColor" /> Begin 25-Min Session
        </button>
      </div>

      {/* Your Progress & Weekly Streak */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Training Consistency
            </div>
            <div className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
              {client.currentStreak}-Day Active Streak
            </div>
          </div>
          <div
            style={{
              background: 'var(--status-paused-bg)',
              color: 'var(--status-paused)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Flame size={14} /> {client.streakFreezeRemaining} Grace Day Available
          </div>
        </div>

        {/* 7-Day Dot Indicator Grid */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          {daysOfWeek.map((day, idx) => {
            const isCompleted = idx <= todayIndex;
            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: isCompleted ? 'var(--status-paused)' : 'var(--surface-patient-recessed)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {isCompleted ? '✓' : ''}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{day}</span>
              </div>
            );
          })}
        </div>

        {/* Brain Capacity Trend Sparkline */}
        <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Brain Capacity Index</span>
            <span className="font-mono" style={{ fontSize: '15px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {client.brainCapacityScore} / 100
            </span>
          </div>

          <div style={{ width: '100%', height: '45px', overflow: 'hidden' }}>
            <svg viewBox="0 0 300 40" style={{ width: '100%', height: '100%' }}>
              <path
                d="M 10 32 Q 60 28, 100 24 T 180 18 T 240 12 T 290 8"
                fill="none"
                stroke="var(--brand-primary)"
                strokeWidth="2.5"
              />
              <path
                d="M 10 32 Q 60 28, 100 24 T 180 18 T 240 12 T 290 8 L 290 40 L 10 40 Z"
                fill="var(--brand-primary-subtle)"
                opacity="0.6"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Education Hub Banner */}
      <div
        onClick={() => onNavigateTab('education')}
        className="card-patient"
        style={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--status-completed-bg)',
              color: 'var(--status-completed)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Neurofeedback Science Hub
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Explore how brainwave biofeedback shapes neuroplasticity
            </div>
          </div>
        </div>
        <ChevronRight size={18} color="var(--text-tertiary)" />
      </div>
    </div>
  );
};
