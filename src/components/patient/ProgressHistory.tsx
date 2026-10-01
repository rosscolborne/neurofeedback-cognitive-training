import React, { useState, useMemo, useEffect } from 'react';
import { ClientProfile, SessionRecord } from '../../types';
import { storageEngine, INITIAL_BADGES } from '../../services/storageEngine';
import { Trophy, Award, Waves, Target, Wind, Compass, Send, FileText, Lock, CheckCircle2, Pencil } from 'lucide-react';
import {
  buildPatientProgressDisplayModel,
  getDurationSeconds,
  getSessionExportState,
  getSessionTimestamp,
  getTimeInZonePercent,
  ProgressPeriod,
} from './patientMetrics';
import { exportPatientSessionCsv } from './patientSessionCsv';
import { experienceDisplayName, protocolDisplayName } from '../displayLabels';
import { FactGrid, type Fact } from '../ui/FactGrid';
import { useBoundedHistory } from '../ui/boundedHistory';
import { HistoryShowMore } from '../ui/HistoryShowMore';
import { MOODS } from './sessionMoods';

interface ProgressHistoryProps {
  client: ClientProfile;
  /** Game progress (NFCT-22), shown under the title, before the neurofeedback period views. */
  gamesSection?: React.ReactNode;
}

const EMPTY_SESSIONS: SessionRecord[] = [];
const VISIBLE_BADGE_IDS = new Set(['first-light', 'steady-state', 'deep-focus']);

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

/** Subjective rating with the name the patient chose it by, e.g. "Focused · 4/5". */
const moodLabel = (rating: number) => {
  const mood = MOODS.find((entry) => entry.value === rating);
  return mood ? `${mood.label} · ${mood.score}` : `${rating}/5`;
};
const journalLabelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' };
const journalFieldStyle: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-patient-card)', color: 'var(--text-primary)', font: 'inherit', fontSize: '13px' };
const journalButtonStyle: React.CSSProperties = { padding: '7px 16px', fontSize: '13px' };

/** Minutes up to an hour, then hours and minutes. Each number stays with its unit (no-break space),
 *  so a narrow stat cell wraps as "5 h / 55 min" rather than splitting "55 / min". */
function formatTrainingTime(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}\u00A0min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}\u00A0h ${rest}\u00A0min` : `${hours}\u00A0h`;
}

/** Short weekday date; the year appears only when it differs from this year. */
function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Compact time-in-zone ring; the number carries the meaning and the ring shows proportion. */
const ZoneRing: React.FC<{ percent: number | null }> = ({ percent }) => (
  <div
    role="img"
    aria-label={percent == null ? 'Time in zone unavailable' : `${percent}% in zone`}
    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0 }}
  >
    <div style={{ position: 'relative', width: '46px', height: '46px' }}>
      <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }} aria-hidden="true">
        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--surface-patient-recessed)" strokeWidth="3.2" />
        <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--brand-primary)" strokeWidth="3.2" strokeDasharray={`${percent ?? 0}, 100`} strokeLinecap="round" />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
        {percent == null ? '—' : `${percent}%`}
      </span>
    </div>
    <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>in zone</span>
  </div>
);

export const ProgressHistory: React.FC<ProgressHistoryProps> = ({ client, gamesSection }) => {
  const [period, setPeriod] = useState<ProgressPeriod>('month');
  const [sessionState, setSessionState] = useState<{
    clientId: string;
    status: 'loading' | 'ready' | 'error';
    sessions: SessionRecord[];
  }>({ clientId: client.id, status: 'loading', sessions: [] });
  const [nowMs] = useState(() => Date.now());
  const [expandedSession, setExpandedSession] = useState<{ clientId: string; sessionId: string } | null>(null);
  const [journal, setJournal] = useState<{ clientId: string; sessionId: string; generation: number; patientNotes: string; moodRating: SessionRecord['moodRating']; pending: boolean; error: boolean } | null>(null);
  const journalPending = React.useRef(new Set<string>());
  const journalGeneration = React.useRef(0);
  const [journalSwitchMessage, setJournalSwitchMessage] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const sessionStatus = sessionState.clientId === client.id ? sessionState.status : 'loading';
  const allSessions = sessionState.clientId === client.id ? sessionState.sessions : EMPTY_SESSIONS;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setJournal(null); setJournalSwitchMessage(false); } });
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
      active = false;
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
  // One page at a time, newest first. The page resets with the range, and a range change is
  // blocked while a journal is open, so the reset can never hide an unsaved journal.
  const history = useBoundedHistory(historySessions, `${client.id}:${period}`);
  const exportAvailability = getSessionExportState(progressDisplay.presentation);

  const periodLabel = period === 'week' ? 'Past 7 days' : period === 'month' ? 'Past 30 days' : 'All time';
  const periodDemoCount = progressDisplay.periodSessions.filter((session) => session.isDemo === true).length;

  const exportCSV = () => {
    if (exportAvailability !== 'ready') return;
    exportPatientSessionCsv(progressDisplay.validSessions, setExportStatus);
  };

  const saveJournal = async () => {
    if (!journal || journal.clientId !== client.id || journal.pending || journalPending.current.has(`${client.id}:${journal.sessionId}`)) return;
    const edited = journal;
    const key = `${edited.clientId}:${edited.sessionId}`;
    journalPending.current.add(key);
    setJournal((current) => current?.generation === edited.generation ? { ...current, pending: true, error: false } : current);
    try {
      await storageEngine.patchSessionNotes(edited.sessionId, { patientNotes: edited.patientNotes, moodRating: edited.moodRating ?? null });
      setSessionState((current) => current.clientId === edited.clientId ? {
        ...current,
        sessions: current.sessions.map((entry) => entry.id === edited.sessionId ? { ...entry, patientNotes: edited.patientNotes, moodRating: edited.moodRating } : entry),
      } : current);
      setJournal((current) => current?.clientId === edited.clientId && current.sessionId === edited.sessionId
        ? current.generation === edited.generation ? null : { ...current, pending: false }
        : current);
    } catch {
      setJournal((current) => current?.clientId === edited.clientId && current.sessionId === edited.sessionId ? { ...current, pending: false, error: true } : current);
    } finally {
      journalPending.current.delete(key);
    }
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

      {gamesSection}

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
            onClick={() => { if (journal?.clientId === client.id) { setJournalSwitchMessage(true); return; } setPeriod(p); }}
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
              {/* Demo results are simulated; say so wherever they feed an average. */}
              {periodDemoCount > 0 && ` · includes ${periodDemoCount} simulated Demo`}
            </div>
          </div>
        </div>

        {/* Dynamic SVG Area Chart */}
        <div style={{ width: '100%', height: '146px', overflow: 'hidden' }}>
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
                {progressDisplay.chart.points.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r="4" fill="var(--brand-primary)" />
                ))}
                <line x1="20" y1="110" x2="350" y2="110" stroke="var(--border-default)" strokeWidth="1" />
              </svg>
              <div style={{ display: 'flex', justifyContent: progressDisplay.chart.labels.length > 1 ? 'space-between' : 'center', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', padding: '0 8px' }}>
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

      <div className="card-patient stat-strip" style={{ padding: '14px 8px' }}>
        {[
          ['Sessions', progressDisplay.summary ? String(progressDisplay.summary.sessionCount) : '—'],
          ['Training time', progressDisplay.summary ? formatTrainingTime(progressDisplay.summary.totalDurationSeconds) : '—'],
          ['Measured sessions', progressDisplay.summary ? String(progressDisplay.summary.measuredSessions.length) : '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="stat-strip-value">{value}</div>
            <div className="stat-strip-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Session History List with Mini-Gauges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="font-display" style={{ fontSize: '20px', color: 'var(--text-primary)' }}>
          Session History
        </h2>
        {journalSwitchMessage && journal?.clientId === client.id && <p role="status">Save or cancel the current journal before opening another session or range.</p>}

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
        ) : (<>
          {history.visible.map(s => {
            const isExpanded = expandedSession?.clientId === client.id && expandedSession.sessionId === s.id;
            const timestamp = getSessionTimestamp(s);
            const timeInZone = getTimeInZonePercent(s);
            const durationSeconds = getDurationSeconds(s);
            const displayDate = timestamp == null ? (s.date || 'Date unavailable') : formatSessionDate(timestamp);
            const isEditingJournal = journal?.clientId === client.id && journal.sessionId === s.id;
            const detailFacts: Fact[] = [
              { label: 'Protocol', value: s.protocol ? protocolDisplayName(s.protocol) : 'Unavailable', wide: true },
              ...(s.isDemo
                ? [{ label: 'Band power', value: 'Not measured in Demo' }]
                : s.averageBands
                  ? [
                      { label: 'Theta', value: formatBandPower(s.averageBands.theta) },
                      { label: 'Alpha', value: formatBandPower(s.averageBands.alpha) },
                      { label: 'Beta', value: formatBandPower(s.averageBands.beta) },
                    ]
                  : [{ label: 'Band power', value: 'Unavailable' }]),
            ];
            return (
              <div
                key={s.id}
                className="card-patient"
                style={{
                  cursor: 'pointer',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
                onClick={() => {
                  if (journal?.clientId === client.id) {
                    if (journal.sessionId !== s.id) setJournalSwitchMessage(true);
                    return;
                  }
                  setExpandedSession(isExpanded ? null : { clientId: client.id, sessionId: s.id });
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {s.experience ? experienceDisplayName(s.experience) : 'Experience unavailable'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {displayDate}{' · '}{durationSeconds == null ? 'Duration unavailable' : `${Math.round(durationSeconds / 60)} min`}
                    </div>
                    {(s.isDemo || s.moodRating) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                        {s.isDemo && <span className="status-tag status-tag-paused" style={{ fontSize: '11px', padding: '2px 8px' }}>Training Demo</span>}
                        {s.moodRating && <span className="status-tag status-tag-neutral" style={{ fontSize: '11px', padding: '2px 8px' }}>{moodLabel(s.moodRating)}</span>}
                      </div>
                    )}
                  </div>
                  <ZoneRing percent={timeInZone} />
                </div>

                {isExpanded && (
                  <div style={{ paddingTop: '14px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {s.clinicianNotes && (
                      <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--brand-primary-subtle)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--brand-primary)' }}>From your clinician</div>
                        <p style={{ margin: '4px 0 0', fontSize: '14px', lineHeight: 1.5, color: 'var(--text-primary)' }}>{s.clinicianNotes}</p>
                      </div>
                    )}

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Your journal</div>
                        {!isEditingJournal && (
                          <button type="button" className="btn btn-ghost" style={{ padding: '4px 6px', gap: '5px', fontSize: '13px', fontWeight: 600, color: 'var(--brand-primary)', minHeight: 0 }} onClick={(event) => { event.stopPropagation(); if (journal?.clientId === client.id) { setJournalSwitchMessage(true); return; } const key = `${client.id}:${s.id}`; setJournal({ clientId: client.id, sessionId: s.id, generation: ++journalGeneration.current, patientNotes: s.patientNotes || '', moodRating: s.moodRating, pending: journalPending.current.has(key), error: false }); setJournalSwitchMessage(false); }}><Pencil size={13} aria-hidden="true" />Edit journal</button>
                        )}
                      </div>
                      {isEditingJournal ? <div onClick={(event) => event.stopPropagation()} style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label htmlFor={`journal-${s.id}`} style={journalLabelStyle}>Personal journal</label>
                        <textarea id={`journal-${s.id}`} value={journal.patientNotes} disabled={journal.pending} onChange={(event) => setJournal((current) => current ? { ...current, patientNotes: event.target.value } : current)} style={{ ...journalFieldStyle, display: 'block', width: '100%', minHeight: '72px', resize: 'vertical' }} />
                        <label htmlFor={`mood-${s.id}`} style={journalLabelStyle}>Mood</label>
                        <select id={`mood-${s.id}`} style={{ ...journalFieldStyle, alignSelf: 'flex-start', minWidth: '140px' }} value={journal.moodRating ?? ''} disabled={journal.pending} onChange={(event) => setJournal((current) => current ? { ...current, moodRating: event.target.value ? Number(event.target.value) as SessionRecord['moodRating'] : undefined } : current)}>
                          <option value="">No rating</option>{MOODS.map((mood) => <option key={mood.value} value={mood.value}>{moodLabel(mood.value)}</option>)}
                        </select>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}><button type="button" className="btn btn-primary" style={journalButtonStyle} disabled={journal.pending} onClick={saveJournal}>Save journal</button><button type="button" className="btn btn-ghost" style={journalButtonStyle} disabled={journal.pending} onClick={() => { setJournal(null); setJournalSwitchMessage(false); }}>Cancel</button></div>
                        {journal.error && <p role="alert" style={{ color: 'var(--status-alert)', fontSize: '13px' }}>Journal could not be saved. Your changes are still here; try again.</p>}
                      </div> : (
                        <p style={{ margin: '6px 0 0', paddingLeft: '12px', borderLeft: '3px solid var(--border-default)', fontSize: '14px', lineHeight: 1.55, color: s.patientNotes ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                          {s.patientNotes || 'No journal entry yet.'}
                        </p>
                      )}
                    </div>

                    <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Session details</div>
                      <FactGrid minColumnWidth={92} facts={detailFacts} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {history.paged && <HistoryShowMore shown={history.shown} total={history.total} nextCount={history.nextCount} onShowMore={history.showMore} />}
        </>)}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: '10px' }}>
          {INITIAL_BADGES.filter(badge => VISIBLE_BADGE_IDS.has(badge.id)).map(badge => {
            const isUnlocked = progressDisplay.earnedBadgeIds?.has(badge.id) === true;
            const Icon = BADGE_ICONS[badge.iconName] || Trophy;
            return (
              <div
                key={badge.id}
                aria-label={`${badge.title}: ${isUnlocked ? 'earned' : 'locked'}. ${badge.description}`}
                role="group"
                style={{
                  position: 'relative',
                  background: isUnlocked ? 'var(--brand-primary-subtle)' : 'var(--surface-patient-recessed)',
                  border: isUnlocked ? '1px solid var(--brand-primary)' : '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 10px 12px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span aria-hidden="true" style={{ position: 'absolute', top: '8px', right: '8px', color: isUnlocked ? 'var(--brand-primary)' : 'var(--text-tertiary)' }}>
                  {isUnlocked ? <CheckCircle2 size={14} /> : <Lock size={12} />}
                </span>
                <div aria-hidden="true" style={{ color: isUnlocked ? 'var(--brand-primary)' : 'var(--text-tertiary)', padding: '2px' }}>
                  <Icon size={22} />
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: isUnlocked ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.25 }}>{badge.title}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
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
