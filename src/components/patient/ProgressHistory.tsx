import React, { useState, useMemo } from 'react';
import { ClientProfile, MilestoneBadge, SessionRecord } from '../../types';
import { storageEngine, INITIAL_BADGES } from '../../services/storageEngine';
import { Download, Trophy, Sparkles, Waves, Target, Wind, Compass, Send, FileText } from 'lucide-react';

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

function filterSessionsByPeriod(sessions: SessionRecord[], period: 'week' | 'month' | 'all'): SessionRecord[] {
  if (period === 'all') return sessions;
  const now = Date.now();
  const cutoff = period === 'week' ? now - 7 * 24 * 60 * 60 * 1000 : now - 30 * 24 * 60 * 60 * 1000;
  return sessions.filter(s => s.timestamp >= cutoff);
}

function computeChangePercent(sessions: SessionRecord[]): { value: number; label: string } | null {
  if (sessions.length < 2) return null;
  const sorted = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
  const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
  const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

  const avgFirst = firstHalf.reduce((s, r) => s + r.timeInZonePercent, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, r) => s + r.timeInZonePercent, 0) / secondHalf.length;

  if (avgFirst === 0) return null;
  const pct = Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
  return { value: pct, label: pct >= 0 ? `+${pct}%` : `${pct}%` };
}

function generateChartPath(sessions: SessionRecord[], width: number, height: number): { line: string; area: string; labels: string[] } {
  if (sessions.length === 0) {
    return { line: '', area: '', labels: [] };
  }

  const sorted = [...sessions].sort((a, b) => a.timestamp - b.timestamp);
  const scores = sorted.map(s => s.timeInZonePercent);
  const minScore = Math.max(0, Math.min(...scores) - 10);
  const maxScore = Math.min(100, Math.max(...scores) + 10);
  const range = Math.max(1, maxScore - minScore);

  const padding = { left: 20, right: 10, top: 20, bottom: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const points = sorted.map((s, i) => {
    const x = padding.left + (sorted.length === 1 ? chartW / 2 : (i / (sorted.length - 1)) * chartW);
    const y = padding.top + chartH - ((s.timeInZonePercent - minScore) / range) * chartH;
    return { x, y };
  });

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = line + ` L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

  // Generate date labels
  const labelCount = Math.min(4, sorted.length);
  const labels: string[] = [];
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.floor(i * (sorted.length - 1) / Math.max(1, labelCount - 1));
    const d = new Date(sorted[idx].timestamp);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }

  return { line, area, labels };
}

export const ProgressHistory: React.FC<ProgressHistoryProps> = ({ client }) => {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month');
  const [allSessions] = useState<SessionRecord[]>(() => storageEngine.getSessions());
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');

  const filteredSessions = useMemo(() => filterSessionsByPeriod(allSessions, period), [allSessions, period]);
  const changePercent = useMemo(() => computeChangePercent(filteredSessions), [filteredSessions]);
  const chart = useMemo(() => generateChartPath(filteredSessions, 360, 120), [filteredSessions]);

  const periodLabel = period === 'week' ? 'Past 7 days' : period === 'month' ? 'Past 30 days' : 'All time';

  const exportCSV = () => {
    if (allSessions.length === 0) {
      alert('No session data to export.');
      return;
    }
    const headers = ['Date', 'Protocol', 'Experience', 'Duration (s)', 'Time In Zone %', 'Coherence %', 'Peak Score', 'Mood'];
    const rows = allSessions.map(s => [
      s.date,
      s.protocol,
      s.experience,
      s.durationSeconds,
      s.timeInZonePercent,
      s.averageCoherence,
      s.peakFocusScore,
      s.moodRating || 'N/A',
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `brainswell_progress_${new Date().toISOString().split('T')[0]}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
    setExportStatus('done');
    setTimeout(() => setExportStatus('idle'), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* Title & Period Selector */}
      <div>
        <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
          Your Progress
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
          {allSessions.length > 0
            ? `Tracking ${allSessions.length} session${allSessions.length !== 1 ? 's' : ''} over time.`
            : 'Complete your first session to start tracking progress.'}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Overall Brain Training Index
            </div>
            <div className="font-mono" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {client.brainCapacityScore}{' '}
              {changePercent ? (
                <span style={{ fontSize: '13px', color: changePercent.value >= 0 ? 'var(--status-active)' : 'var(--status-alert)' }}>
                  {changePercent.label}
                </span>
              ) : filteredSessions.length === 0 ? (
                <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>No data yet</span>
              ) : null}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {periodLabel} · {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Dynamic SVG Area Chart */}
        <div style={{ width: '100%', height: '140px', overflow: 'hidden' }}>
          {filteredSessions.length > 0 ? (
            <>
              <svg viewBox="0 0 360 120" style={{ width: '100%', height: '120px' }}>
                <defs>
                  <linearGradient id="scoreAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <path d={chart.area} fill="url(#scoreAreaGrad)" />
                <path
                  d={chart.line}
                  fill="none"
                  stroke="var(--brand-primary)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="20" y1="110" x2="350" y2="110" stroke="var(--border-default)" strokeWidth="1" />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', padding: '0 8px' }}>
                {chart.labels.map((label, i) => (
                  <span key={i}>{label}</span>
                ))}
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-tertiary)',
              fontSize: '13px',
              flexDirection: 'column',
              gap: '8px',
            }}>
              <svg viewBox="0 0 360 120" style={{ width: '100%', height: '80px', opacity: 0.3 }}>
                <line x1="20" y1="60" x2="340" y2="60" stroke="var(--border-default)" strokeWidth="1" strokeDasharray="6 4" />
                <line x1="20" y1="110" x2="340" y2="110" stroke="var(--border-default)" strokeWidth="1" />
              </svg>
              <span>Complete sessions to see your trend</span>
            </div>
          )}
        </div>
      </div>

      {/* Session History List with Mini-Gauges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
          Session History
        </h2>

        {filteredSessions.length === 0 ? (
          <div className="card-patient" style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
              No sessions recorded for this period.
            </p>
          </div>
        ) : (
          filteredSessions.map(s => {
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
          })
        )}
      </div>

      {/* Milestone Badges Gallery */}
      <div className="card-patient" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Trophy size={18} color="var(--brand-primary)" />
          <h3 className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            Milestones
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

      {/* Export CSV — prominent button */}
      <button
        onClick={exportCSV}
        className="btn btn-secondary"
        style={{
          width: '100%',
          padding: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        <FileText size={16} />
        {exportStatus === 'done' ? 'Exported ✓' : 'Export Session Data (CSV)'}
      </button>
    </div>
  );
};
