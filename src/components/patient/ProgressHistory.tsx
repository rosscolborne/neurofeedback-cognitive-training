import React, { useState } from 'react';
import { ClientProfile, MilestoneBadge, SessionRecord } from '../../types';
import { storageEngine, INITIAL_BADGES } from '../../services/storageEngine';
import { Download, Trophy, Sparkles, Waves, Target, Wind, Compass, Send } from 'lucide-react';

interface ProgressHistoryProps {
  client: ClientProfile;
}

const BADGE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  Sparkles,
  Waves,
  Target,
  Wind,
  Compass,
  Send,
};

export const ProgressHistory: React.FC<ProgressHistoryProps> = ({ client }) => {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month');
  const [sessions, setSessions] = useState<SessionRecord[]>(() => storageEngine.getSessions());
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const exportCSV = () => {
    const headers = ['Date', 'Protocol', 'Experience', 'Duration (s)', 'Time In Zone %', 'Coherence %', 'Peak Score', 'Mood'];
    const rows = sessions.map(s => [
      s.date,
      s.protocol,
      s.experience,
      s.durationSeconds,
      s.timeInZonePercent,
      s.averageCoherence,
      s.peakFocusScore,
      s.moodRating || 'N/A',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `neurofeedback_progress_${client.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* Title & Period Selector */}
      <div>
        <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
          Your Progress
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          Longitudinal neuroplastic adaptations over time.
        </p>
      </div>

      {/* Period Selector Pills */}
      <div
        style={{
          background: 'var(--surface-patient-recessed)',
          borderRadius: 'var(--radius-xl)',
          padding: '4px',
          display: 'flex',
          gap: '4px',
        }}
      >
        {(['week', 'month', 'all'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              flex: 1,
              background: period === p ? 'var(--brand-primary)' : 'transparent',
              color: period === p ? 'var(--brand-on-primary)' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-xl)',
              padding: '8px 12px',
              fontSize: '13px',
              fontWeight: 600,
              textTransform: 'capitalize',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {p === 'all' ? 'All Time' : p}
          </button>
        ))}
      </div>

      {/* Main Longitudinal Score Chart */}
      <div className="card-patient" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Overall Brain Training Index
            </div>
            <div className="font-mono" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {client.brainCapacityScore} <span style={{ fontSize: '13px', color: 'var(--status-active)' }}>+8% this month</span>
            </div>
          </div>
          <button onClick={exportCSV} className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }}>
            <Download size={14} /> Export CSV
          </button>
        </div>

        {/* Dynamic SVG Area Chart */}
        <div style={{ width: '100%', height: '140px', overflow: 'hidden' }}>
          <svg viewBox="0 0 360 120" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="scoreAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#E8967A" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#E8967A" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <path
              d="M 10 95 Q 50 82, 90 70 T 170 55 T 250 42 T 320 30 T 350 20 L 350 120 L 10 120 Z"
              fill="url(#scoreAreaGrad)"
            />
            <path
              d="M 10 95 Q 50 82, 90 70 T 170 55 T 250 42 T 320 30 T 350 20"
              fill="none"
              stroke="#E8967A"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <line x1="10" y1="30" x2="350" y2="30" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
            <line x1="10" y1="70" x2="350" y2="70" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
            <line x1="10" y1="110" x2="350" y2="110" stroke="var(--border-default)" strokeWidth="1" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            <span>Week 1</span>
            <span>Week 2</span>
            <span>Week 3</span>
            <span>Week 4</span>
          </div>
        </div>
      </div>

      {/* Session History List with Mini-Gauges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
          Session History
        </h2>

        {sessions.map(s => {
          const isExpanded = expandedSessionId === s.id;
          return (
            <div
              key={s.id}
              className="card-patient"
              style={{
                cursor: 'pointer',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
              onClick={() => setExpandedSessionId(isExpanded ? null : s.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {s.date}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Duration: {Math.round(s.durationSeconds / 60)} mins • {s.experience.replace(/-/g, ' ')}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <span className="status-tag status-tag-active" style={{ fontSize: '11px', padding: '2px 8px' }}>
                      {s.protocol === 'theta-beta-ratio' ? 'Focus' : 'Calm'}
                    </span>
                    {s.moodRating && (
                      <span className="font-mono" style={{ fontSize: '11px', background: 'var(--surface-patient-recessed)', padding: '2px 6px', borderRadius: '4px' }}>
                        State {s.moodRating}/5
                      </span>
                    )}
                  </div>
                </div>

                {/* Circular Score Mini-Gauge */}
                <div style={{ position: 'relative', width: '54px', height: '54px' }}>
                  <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="var(--surface-patient-recessed)"
                      strokeWidth="3.5"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="var(--brand-primary)"
                      strokeWidth="3.5"
                      strokeDasharray={`${s.timeInZonePercent}, 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {s.timeInZonePercent}
                    </span>
                    <span style={{ fontSize: '8px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Score</span>
                  </div>
                </div>
              </div>

              {/* Expandable Session Detail */}
              {isExpanded && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <div><strong>Average Band Powers:</strong> Theta {s.averageBands.theta}µV | Alpha {s.averageBands.alpha}µV | Beta {s.averageBands.beta}µV</div>
                  {s.patientNotes && <div style={{ marginTop: '4px' }}><strong>Notes:</strong> {s.patientNotes}</div>}
                  {s.clinicianNotes && <div style={{ marginTop: '4px', color: 'var(--brand-primary)' }}><strong>Clinician Feedback:</strong> {s.clinicianNotes}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Milestone Badges Gallery */}
      <div className="card-patient" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Trophy size={18} color="var(--brand-primary)" />
          <h3 className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            Therapeutic Milestones
          </h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {INITIAL_BADGES.map(badge => {
            const isUnlocked = client.badges.includes(badge.id) || !!badge.unlockedAt;
            const Icon = BADGE_ICONS[badge.iconName] || Trophy;
            return (
              <div
                key={badge.id}
                style={{
                  background: isUnlocked ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-recessed)',
                  border: isUnlocked ? '1.5px solid var(--brand-primary)' : '1px dashed var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 8px',
                  textAlign: 'center',
                  opacity: isUnlocked ? 1 : 0.45,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <div style={{ color: 'var(--brand-primary)', padding: '4px' }}>
                  <Icon size={20} />
                </div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>{badge.title}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.2 }}>
                  {badge.description}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
