import React, { useState, useRef, useEffect } from 'react';
import { ClientProfile, ExperienceType } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { Play, ChevronRight, Mountain, Waves, Wind, Target, Music, Tv, Headphones, Box, CircleDot, BookOpen, ChevronRight as ScrollHint } from 'lucide-react';

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
  'mandala': { name: 'Mandala Breathing', icon: CircleDot, desc: 'Calm concentric breathing mandala with live µV telemetry', tag: 'Calm' },
  'immersive-3d': { name: 'Generative XR', icon: Box, desc: 'Subtle atmospheric WebXR experience', tag: 'VR' },
  'generative-music': { name: 'Generative Music', icon: Music, desc: 'Brain-state-driven melody, synthesis & rhythm — your EEG creates the music', tag: 'Music' },
  'narrative-story': { name: 'Contemplative Reading', icon: BookOpen, desc: 'Calm mindfulness reflections guided by neurofeedback therapy', tag: 'Reading' },
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  client,
  onStartSession,
  onNavigateTab,
}) => {
  const [selectedExp, setSelectedExp] = useState<ExperienceType>(client.allowedExperiences[0] || 'skyline-drift');
  const [showScrollHint, setShowScrollHint] = useState(true);
  const [completedDays, setCompletedDays] = useState<Set<number>>(new Set());
  const pillsRef = useRef<HTMLDivElement>(null);

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIndex = new Date().getDay();

  useEffect(() => {
    let isMounted = true;
    storageEngine.getSessions(client.id).then((sessions) => {
      if (!isMounted) return;
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);

      const days = new Set<number>();
      for (const session of sessions) {
        const sessionDate = new Date(session.timestamp);
        if (sessionDate >= weekStart && sessionDate <= now) {
          days.add(sessionDate.getDay());
        }
      }
      setCompletedDays(days);
    });
    return () => {
      isMounted = false;
    };
  }, [client.id]);

  const ActiveIcon = EXPERIENCES_META[selectedExp].icon;

  // Hide scroll hint once user scrolls the pills
  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (el.scrollLeft > 20) setShowScrollHint(false);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Check if pills overflow (need scroll hint)
  useEffect(() => {
    const el = pillsRef.current;
    if (el && el.scrollWidth <= el.clientWidth) {
      setShowScrollHint(false);
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* Greeting Header */}
      <div>
        <h1
          className="font-display"
          style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15 }}
        >
          {getGreeting()}{client.name ? ',' : '.'}<br />{client.name ? `${client.name.split(' ')[0]}.` : ''}
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Protocol: <strong style={{ color: 'var(--text-primary)' }}>{client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</strong>
        </p>
      </div>

      {/* Today's Prescribed Session Card */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Training Session
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

        {/* Experience Selector Pills — scrollable with fade hint */}
        <div style={{ position: 'relative' }}>
          <div
            ref={pillsRef}
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '4px',
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
            }}
          >
            {client.allowedExperiences.map(exp => {
              const Icon = EXPERIENCES_META[exp].icon;
              return (
                <button
                  key={exp}
                  onClick={(e) => {
                    setSelectedExp(exp);
                    (e.currentTarget as HTMLButtonElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                  }}
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
                    scrollSnapAlign: 'start',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={14} /> {EXPERIENCES_META[exp].name}
                </button>
              );
            })}
          </div>
          {/* Right fade gradient to hint scrollability */}
          {showScrollHint && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: '4px',
                width: '48px',
                background: 'linear-gradient(to right, transparent, var(--surface-patient-card))',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: '4px',
              }}
            >
              <ChevronRight size={16} color="var(--text-tertiary)" style={{ opacity: 0.7 }} />
            </div>
          )}
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
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Training Consistency
          </div>
          <div className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: '2px' }}>
            {client.currentStreak > 0 ? `${client.currentStreak}-Day Active Streak` : 'Build Your Streak'}
          </div>
        </div>

        {/* Grace Day Badge — own row with spacing */}
        {client.streakFreezeRemaining > 0 && (
          <div
            style={{
              background: 'var(--status-paused-bg)',
              color: 'var(--status-paused)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              alignSelf: 'flex-start',
            }}
          >
            {client.streakFreezeRemaining} grace {client.streakFreezeRemaining === 1 ? 'day' : 'days'} available
          </div>
        )}

        {/* 7-Day Dot Indicator Grid — based on actual session data */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          {daysOfWeek.map((day, idx) => {
            const isCompleted = completedDays.has(idx);
            const isToday = idx === todayIndex;
            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: isCompleted ? 'var(--status-active)' : 'var(--surface-patient-recessed)',
                    border: isToday && !isCompleted ? '2px solid var(--brand-primary)' : 'none',
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
                <span style={{
                  fontSize: '11px',
                  color: isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isToday ? 700 : 400,
                }}>{day}</span>
              </div>
            );
          })}
        </div>

        {/* Brain Capacity Trend Sparkline */}
        <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Brain Capacity Index</span>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '1px' }}>Past 7 days</div>
            </div>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-tertiary)', marginTop: '2px', padding: '0 4px' }}>
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
            <span>Today</span>
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
