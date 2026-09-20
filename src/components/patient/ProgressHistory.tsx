import React, { useState, useMemo, useEffect } from 'react';
import { ClientProfile, SessionRecord } from '../../types';
import { storageEngine, INITIAL_BADGES } from '../../services/storageEngine';
import { Trophy, Award, Waves, Target, Wind, Compass, Send, FileText } from 'lucide-react';
import {
  buildPatientProgressDisplayModel,
  getDurationSeconds,
  getSessionExportState,
  getSessionTimestamp,
  getTimeInZonePercent,
  ProgressPeriod,
} from './patientMetrics';

interface ProgressHistoryProps {
  client: ClientProfile;
}

const EMPTY_SESSIONS: SessionRecord[] = [];

const BADGE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  Award,
  Trophy,
  Waves,
  Target,
  Wind,
  Compass,
  Send,
};

const formatBandPower = (value: unknown): string => (
  typeof value === 'number' && Number.isFinite(value) ? `${value}µV` : 'Unavailable'
);

export const ProgressHistory: React.FC<ProgressHistoryProps> = ({ client }) => {
  const [period, setPeriod] = useState<ProgressPeriod>('month');
  const [sessionState, setSessionState] = useState<{
    clientId: string;
    status: 'loading' | 'ready' | 'error';
    sessions: SessionRecord[];
  }>({ clientId: client.id, status: 'loading', sessions: [] });
  const [nowMs] = useState(() => Date.now());
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const sessionStatus = sessionState.clientId === client.id ? sessionState.status : 'loading';
  const allSessions = sessionState.clientId === client.id ? sessionState.sessions : EMPTY_SESSIONS;

  useEffect(() => {
    let isMounted = true;
    storageEngine.getSessions(client.id)
      .then((sessions) => {
        if (!isMounted) return;
        setSessionState({ clientId: client.id, status: 'ready', sessions });
      })
      .catch(() => {
        if (isMounted) setSessionState({ clientId: client.id, status: 'error', sessions: [] });
      });
    return () => {
      isMounted = false;
    };
  }, [client.id]);

  const progressDisplay = useMemo(() => buildPatientProgressDisplayModel(sessionStatus, allSessions, {
    period,
    nowMs,
    chartWidth: 360,
    chartHeight: 120,
  }), [sessionStatus, allSessions, period, nowMs]);
  const historySessions = useMemo(
    () => [...progressDisplay.periodSessions].reverse(),
    [progressDisplay.periodSessions],
  );
  const exportAvailability = getSessionExportState(progressDisplay.presentation);

  const periodLabel = period === 'week' ? 'Past 7 days' : period === 'month' ? 'Past 30 days' : 'All time';

  const exportCSV = () => {
    if (exportAvailability !== 'ready') return;
    const headers = ['Date', 'Protocol', 'Experience', 'Duration (s)', 'Time In Zone %', 'Coherence %', 'Peak Score', 'Mood'];
    const rows = progressDisplay.validSessions.map(s => [
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
    const filename = `waveable_progress_${new Date().toISOString().split('T')[0]}.csv`;

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: 'text/csv' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'Session Progress',
        }).then(() => {
          setExportStatus('done');
          setTimeout(() => setExportStatus('idle'), 3000);
        }).catch(() => {
          setExportStatus('idle');
        });
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 200);
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
          {sessionStatus === 'loading'
            ? 'Loading your saved sessions…'
            : sessionStatus === 'error'
              ? 'Your saved sessions could not be loaded.'
              : progressDisplay.validSessions.length > 0
            ? `Tracking ${progressDisplay.validSessions.length} session${progressDisplay.validSessions.length !== 1 ? 's' : ''} over time.`
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
              Average time in target zone
            </div>
            <div className="font-mono" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {progressDisplay.presentation === 'loading'
                ? 'Loading…'
                : progressDisplay.summary?.averageTimeInZonePercent == null
                  ? 'Unavailable'
                  : `${progressDisplay.summary.averageTimeInZonePercent}%`}{' '}
              {progressDisplay.summary?.measuredSessions.length === 0 ? (
                <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>No measured data</span>
              ) : null}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {periodLabel} · {progressDisplay.summary
                ? `${progressDisplay.summary.sessionCount} session${progressDisplay.summary.sessionCount !== 1 ? 's' : ''}`
                : 'Session count unavailable'}
            </div>
          </div>
        </div>

        {/* Dynamic SVG Area Chart */}
        <div style={{ width: '100%', height: '140px', overflow: 'hidden' }}>
          {progressDisplay.chart?.line ? (
            <>
              <svg viewBox="0 0 360 120" style={{ width: '100%', height: '120px' }}>
                <defs>
                  <linearGradient id="scoreAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <path d={progressDisplay.chart.area} fill="url(#scoreAreaGrad)" />
                <path
                  d={progressDisplay.chart.line}
                  fill="none"
                  stroke="var(--brand-primary)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {progressDisplay.chart.points.map(point => (
                  <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="4" fill="var(--brand-primary)" />
                ))}
                <line x1="20" y1="110" x2="350" y2="110" stroke="var(--border-default)" strokeWidth="1" />
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', padding: '0 8px' }}>
                {progressDisplay.chart.labels.map((label, i) => (
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
              color: 'var(--brand-primary)',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div style={{ 
                background: 'var(--brand-primary-subtle)', 
                padding: '12px', 
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Award size={24} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                  {progressDisplay.presentation === 'loading'
                    ? 'Loading session data…'
                    : progressDisplay.presentation === 'error'
                      ? 'Session data unavailable'
                      : 'No measured sessions'}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {progressDisplay.presentation === 'loading'
                    ? 'Your saved sessions will appear here when loaded.'
                    : progressDisplay.presentation === 'error'
                      ? 'Try again after checking your connection.'
                      : 'Complete a session with a time-in-zone measurement to see a trend.'}
                </div>
              </div>
            </div>
          )}
        </div>
        {progressDisplay.summary?.measuredSessions.length === 1 && (
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '8px' }}>
            One measured session is shown; a trend needs at least two.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        {[
          ['Sessions', progressDisplay.summary ? String(progressDisplay.summary.sessionCount) : '—'],
          ['Training time', progressDisplay.summary ? `${Math.round(progressDisplay.summary.totalDurationSeconds / 60)} min` : '—'],
          ['Measured sessions', progressDisplay.summary ? String(progressDisplay.summary.measuredSessions.length) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="card-patient" style={{ padding: '12px', textAlign: 'center' }}>
            <div className="font-mono" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '3px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Session History List with Mini-Gauges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
          Session History
        </h2>

        {historySessions.length === 0 ? (
          <div className="card-patient" style={{ padding: '32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <Target size={32} color="var(--border-default)" />
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {progressDisplay.presentation === 'loading'
                ? 'Loading session history…'
                : progressDisplay.presentation === 'error'
                  ? 'Session history unavailable'
                  : 'No sessions in this period'}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {progressDisplay.presentation === 'loading'
                ? 'Your saved sessions will appear here when loaded.'
                : progressDisplay.presentation === 'error'
                  ? 'Try again after checking your connection.'
                  : 'Choose another range or complete a training session to see it here.'}
            </p>
          </div>
        ) : (
          historySessions.map(s => {
            const isExpanded = expandedSessionId === s.id;
            const timestamp = getSessionTimestamp(s);
            const timeInZone = getTimeInZonePercent(s);
            const durationSeconds = getDurationSeconds(s);
            const displayDate = timestamp == null
              ? (s.date || 'Date unavailable')
              : new Date(timestamp).toLocaleDateString();
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
                      {displayDate}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Duration: {durationSeconds == null ? 'Unavailable' : `${Math.round(durationSeconds / 60)} mins`}
                      {' • '}{s.experience ? s.experience.replace(/-/g, ' ') : 'Experience unavailable'}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <span className="status-tag status-tag-active" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        {s.protocol ? s.protocol.replace(/-/g, ' ') : 'Protocol unavailable'}
                      </span>
                      {s.isDemo && (
                        <span className="status-tag" style={{ fontSize: '11px', padding: '2px 8px' }}>
                            Training Demo · Synthetic acquisition
                        </span>
                      )}
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
                        strokeDasharray={`${timeInZone ?? 0}, 100`}
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
                        {timeInZone == null ? '—' : `${timeInZone}%`}
                      </span>
                      <span style={{ fontSize: '8px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>In zone</span>
                    </div>
                  </div>
                </div>

                {/* Expandable Session Detail */}
                {isExpanded && (
                  <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {s.averageBands ? (
                      <div>
                        <strong>Average Band Powers:</strong> Theta {formatBandPower(s.averageBands.theta)}
                        {' | '}Alpha {formatBandPower(s.averageBands.alpha)}
                        {' | '}Beta {formatBandPower(s.averageBands.beta)}
                      </div>
                    ) : (
                      <div><strong>Average Band Powers:</strong> Unavailable</div>
                    )}
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

        {progressDisplay.earnedBadgeIds == null ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            {progressDisplay.presentation === 'loading'
              ? 'Loading milestone evidence…'
              : 'Milestone evidence unavailable.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {INITIAL_BADGES.map(badge => {
            const isUnlocked = progressDisplay.earnedBadgeIds?.has(badge.id) === true;
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
        )}
      </div>

      {/* Export CSV — small button */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
        <button
          onClick={exportCSV}
          disabled={exportAvailability !== 'ready'}
          className="btn btn-secondary"
          style={{
            padding: '8px 16px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            opacity: exportAvailability === 'ready' ? 1 : 0.6,
            cursor: exportAvailability === 'ready' ? 'pointer' : 'not-allowed',
          }}
        >
          <FileText size={14} />
          {exportStatus === 'done'
            ? 'Exported ✓'
            : exportAvailability === 'loading'
              ? 'Loading export data…'
              : exportAvailability === 'unavailable'
                ? 'Export unavailable'
                : exportAvailability === 'empty'
                  ? 'No data to export'
                  : 'Export Data (CSV)'}
        </button>
      </div>
    </div>
  );
};
