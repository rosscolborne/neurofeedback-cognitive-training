import React, { useState, useRef, useLayoutEffect } from 'react';
import { ClientProfile, ExperienceType } from '../../types';
import { protocolDisplayName, resolvePatientProtocol } from '../../services/protocols';
import {
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';
import { Play, ChevronRight, Brain } from 'lucide-react';
import { EXPERIENCE_CATALOGUE, getAssignedExperienceIds, canStartAssignedExperience } from './experienceCatalogue';
import { useScrollEdges } from '../ui/useScrollEdges';

interface HomeScreenProps {
  client: ClientProfile;
  onStartSession: (exp: ExperienceType) => void;
  onOpenProtocolDetails?: () => void;
  /** Opens the patient's training setup. */
  onOpenTrainingSetup?: () => void;
  /**
   * The games (NFCT-13): play, the streak, achievements and recent runs. Shown
   * first; the optional neurofeedback training below it becomes secondary.
   */
  gamesSection?: React.ReactNode;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  client,
  onStartSession,
  onOpenProtocolDetails,
  onOpenTrainingSetup,
  gamesSection,
}) => {
  const assignmentKey = client.allowedExperiences.join('|');
  const [selection, setSelection] = useState<{ assignmentKey: string; experience: ExperienceType | undefined }>({
    assignmentKey,
    experience: getAssignedExperienceIds(client.allowedExperiences)[0],
  });
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

  const protocolControls = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', maxWidth: '100%' }}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
        <span>Your protocol</span>
        {onOpenTrainingSetup && <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenTrainingSetup}
            aria-label="Change training setup"
            style={{ background: 'none', border: 0, padding: '6px 2px', margin: '-6px 0', font: 'inherit', fontWeight: 600, color: 'var(--brand-primary)', cursor: 'pointer' }}
          >
            Change
          </button>
        </>}
      </div>
    </div>
  );

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
        {!gamesSection && protocolControls}
      </div>

      {gamesSection}

      {/* Optional neurofeedback (EEG) training: secondary to the games, never needed to play them. */}
      <section
        aria-labelledby={gamesSection ? 'home-neurofeedback-title' : undefined}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px', ...(gamesSection ? { marginTop: '12px', paddingTop: '24px', borderTop: '1px solid var(--border-default)' } : {}) }}
      >
        {gamesSection && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <h2 id="home-neurofeedback-title" className="font-display" style={{ fontSize: '20px', fontWeight: 400, color: 'var(--text-primary)' }}>
                Neurofeedback training
              </h2>
              <p style={{ marginTop: '2px', fontSize: '13px', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                Optional. Uses a Muse headset, and is separate from your game progress.
              </p>
            </div>
            {protocolControls}
          </div>
        )}

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

          {/* With the games above, their Play is Home's one primary action; this one is secondary. */}
          <button
            onClick={() => {
              if (effectiveSelectedExp && canStartAssignedExperience(latestAllowed.current, effectiveSelectedExp)) onStartSession(effectiveSelectedExp);
            }}
            disabled={!effectiveSelectedExp}
            className={gamesSection ? 'btn btn-secondary' : 'btn btn-primary'}
            style={{ width: '100%', padding: gamesSection ? '13px' : '16px', fontSize: gamesSection ? '15px' : '16px' }}
          >
            <Play size={gamesSection ? 16 : 18} fill="currentColor" aria-hidden="true" /> Begin Session
          </button>
        </div>
      </section>
    </div>
  );
};
