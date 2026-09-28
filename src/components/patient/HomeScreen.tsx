import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { ClientProfile, ExperienceType, SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { protocolDisplayName, resolvePatientProtocol } from '../../services/protocols';
import {
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';
import { Play, ChevronRight, BookOpen, Brain } from 'lucide-react';
import { EXPERIENCE_CATALOGUE, getAssignedExperienceIds, canStartAssignedExperience } from './experienceCatalogue';
import { useScrollEdges } from '../ui/useScrollEdges';
import {
  buildPatientProgressDisplayModel,
} from './patientMetrics';

interface HomeScreenProps {
  client: ClientProfile;
  onStartSession: (exp: ExperienceType) => void;
  onNavigateTab: (tab: 'home' | 'sessions' | 'education' | 'progress' | 'profile') => void;
  onOpenProtocolDetails?: () => void;
}

const EMPTY_SESSIONS: SessionRecord[] = [];

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
  onOpenProtocolDetails,
}) => {
  const assignmentKey = client.allowedExperiences.join('|');
  const [selection, setSelection] = useState<{ assignmentKey: string; experience: ExperienceType | undefined }>({
    assignmentKey,
    experience: getAssignedExperienceIds(client.allowedExperiences)[0],
  });
  const [sessionState, setSessionState] = useState<{
    clientId: string;
    status: 'loading' | 'ready' | 'error';
    sessions: SessionRecord[];
  }>({ clientId: client.id, status: 'loading', sessions: [] });
  const [nowMs] = useState(() => Date.now());
  const sessionStatus = sessionState.clientId === client.id ? sessionState.status : 'loading';
  const sessions = sessionState.clientId === client.id ? sessionState.sessions : EMPTY_SESSIONS;

  useEffect(() => {
    let isMounted = true;
    storageEngine.getSessions(client.id)
      .then((ownedSessions) => {
        if (!isMounted) return;
        setSessionState({ clientId: client.id, status: 'ready', sessions: ownedSessions });
      })
      .catch(() => {
        if (isMounted) setSessionState({ clientId: client.id, status: 'error', sessions: [] });
      });
    return () => {
      isMounted = false;
    };
  }, [client.id]);

  const progressDisplay = useMemo(() => buildPatientProgressDisplayModel(sessionStatus, sessions, {
    period: 'week',
    nowMs,
    chartWidth: 300,
    chartHeight: 40,
  }), [sessionStatus, sessions, nowMs]);

  const allowedIds = getAssignedExperienceIds(client.allowedExperiences);
  const effectiveSelectedExp = selection.assignmentKey === assignmentKey && selection.experience && allowedIds.includes(selection.experience)
    ? selection.experience : allowedIds[0];
  const activeExperience = effectiveSelectedExp ? EXPERIENCE_CATALOGUE[effectiveSelectedExp] : undefined;
  const ActiveIcon = activeExperience?.icon;
  const latestAllowed = useRef(client.allowedExperiences);
  const pillScrollerRef = useScrollEdges<HTMLDivElement>();
  useLayoutEffect(() => { latestAllowed.current = client.allowedExperiences; }, [client.allowedExperiences]);
  const resolvedProtocol = resolvePatientProtocol(client);
  const evidenceProtocol = getClinicalProtocolTemplate(resolvedProtocol);
  const protocolAlias = client.customProtocolConfig
    ? getProtocolAssignmentAlias(client.customProtocolConfig, resolvedProtocol)
    : undefined;
  const protocolName = evidenceProtocol?.name ?? protocolDisplayName(resolvedProtocol);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      {/* Greeting Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
        <h1
          className="font-display"
          style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15 }}
        >
          {getGreeting()}{client.name ? `, ${client.name.split(' ')[0]}.` : '.'}
        </h1>
        <button
          type="button"
          className="protocol-chip"
          onClick={onOpenProtocolDetails}
          disabled={!onOpenProtocolDetails}
          aria-label={`Protocol: ${protocolAlias ? `${protocolAlias}, ` : ''}${protocolName}. View protocol details`}
        >
          <Brain size={15} color="var(--brand-primary)" aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            {protocolAlias && <>{protocolAlias}<span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}> · </span></>}
            {protocolName}
          </span>
          {onOpenProtocolDetails && <ChevronRight size={14} color="var(--text-tertiary)" aria-hidden="true" style={{ flexShrink: 0 }} />}
        </button>
      </div>

      {/* Today's Prescribed Session Card */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Training Session
            </div>
            <div className="font-display" style={{ fontSize: '22px', color: 'var(--text-primary)', marginTop: '2px' }}>
              {activeExperience?.name ?? 'No assigned experience'}
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
            {ActiveIcon && <ActiveIcon size={22} />}
          </div>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {activeExperience?.description ?? 'Your training plan has no available experiences.'}
        </p>

        {/* Experience pills scroll edge to edge; the next pill peeks and fades at the card edge. */}
        <div className="pill-scroller" role="group" aria-label="Assigned experiences" ref={pillScrollerRef}>
          {allowedIds.map(exp => {
            const Icon = EXPERIENCE_CATALOGUE[exp].icon;
            const isSelected = effectiveSelectedExp === exp;
            return (
              <button
                key={exp}
                type="button"
                aria-pressed={isSelected}
                className={`pill-scroller-item${isSelected ? ' is-selected' : ''}`}
                onClick={(e) => {
                  if (!canStartAssignedExperience(latestAllowed.current, exp)) return;
                  setSelection({ assignmentKey, experience: exp });
                  (e.currentTarget as HTMLButtonElement).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }}
              >
                <Icon size={14} aria-hidden="true" /> {EXPERIENCE_CATALOGUE[exp].name}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => {
            if (effectiveSelectedExp && canStartAssignedExperience(latestAllowed.current, effectiveSelectedExp)) onStartSession(effectiveSelectedExp);
          }}
          disabled={!effectiveSelectedExp}
          className="btn btn-primary"
          style={{ width: '100%', padding: '16px', fontSize: '16px' }}
        >
          <Play size={18} fill="currentColor" /> Begin Session
        </button>
      </div>

      {/* Your Progress & Weekly Streak */}
      <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Training Consistency
          </div>
          <div className="font-display" style={{ fontSize: '18px', color: 'var(--text-primary)', marginTop: '2px' }}>
            {progressDisplay.presentation === 'loading'
              ? 'Loading activity…'
              : progressDisplay.presentation === 'error'
                ? 'Activity unavailable'
                : (progressDisplay.activeStreak ?? 0) > 0
                  ? `${progressDisplay.activeStreak}-Day Active Streak`
                  : 'Build Your Streak'}
          </div>
        </div>

        {/* 7-Day Dot Indicator Grid — based on actual session data */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
          {progressDisplay.weeklyActivity ? progressDisplay.weeklyActivity.map(day => {
            return (
              <div key={day.dayOrdinal} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: day.completed ? 'var(--status-active)' : 'var(--surface-patient-recessed)',
                    border: day.isToday && !day.completed ? '2px solid var(--brand-primary)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  {day.completed ? '✓' : ''}
                </div>
                <span style={{
                  fontSize: '11px',
                  color: day.isToday ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: day.isToday ? 700 : 400,
                }}>{day.label}</span>
              </div>
            );
          }) : (
            <div style={{ width: '100%', fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '12px 0' }}>
              {progressDisplay.presentation === 'loading'
                ? 'Loading weekly activity…'
                : 'Weekly activity unavailable.'}
            </div>
          )}
        </div>

        {/* Session-derived time-in-zone trend */}
        <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Average time in target zone</span>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '1px' }}>
                Past 7 days{progressDisplay.periodSessions.some((session) => session.isDemo === true) && ' · includes simulated Demo'}
              </div>
            </div>
            <span className="font-mono" style={{ fontSize: '15px', fontWeight: 700, color: 'var(--brand-primary)' }}>
              {progressDisplay.summary?.averageTimeInZonePercent != null
                ? `${progressDisplay.summary.averageTimeInZonePercent}%`
                : 'Unavailable'}
            </span>
          </div>

          <div style={{ width: '100%', height: '45px', overflow: 'hidden' }}>
            {progressDisplay.chart?.line ? (
              <svg viewBox="0 0 300 40" style={{ width: '100%', height: '100%' }} aria-label="Time in target zone by session">
                <path d={progressDisplay.chart.area} fill="var(--brand-primary-subtle)" opacity="0.6" />
                <path d={progressDisplay.chart.line} fill="none" stroke="var(--brand-primary)" strokeWidth="2.5" />
                {progressDisplay.chart.points.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r="3" fill="var(--brand-primary)" />
                ))}
              </svg>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: '12px' }}>
                {progressDisplay.presentation === 'loading'
                  ? 'Loading session data…'
                  : progressDisplay.presentation === 'error'
                    ? 'Could not load session data.'
                    : 'No measured sessions in this period.'}
              </div>
            )}
          </div>
          {progressDisplay.summary?.measuredSessions.length === 1 && (
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '2px' }}>
              One measured session; a trend needs at least two.
            </div>
          )}
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
