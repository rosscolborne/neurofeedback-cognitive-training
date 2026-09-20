import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '../../services/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { ClientProfile, ClinicBrandConfig, ExperienceType, SessionRecord } from '../../types';
import { HomeScreen } from './HomeScreen';
import { ProgressHistory } from './ProgressHistory';
import { OnboardingFlow } from './OnboardingFlow';
import { SessionRunner } from './SessionRunner';
import { PostSessionSummary } from './PostSessionSummary';
import { ProtocolDetailsModal } from './ProtocolDetailsModal';
import { EducationHub } from './EducationHub';
import { ChangePasswordForm } from '../account/ChangePasswordForm';
import { PatientMessagingView } from './PatientMessagingView';
import { PatientAppointmentsView } from './PatientAppointmentsView';
import { BrandLogo } from '../brand/BrandLogo';
import { Home, Compass, BookOpen, Activity, User, Mountain, Waves, Wind, Target, Music, Tv, Headphones, Box, CircleDot, Flower2, Camera, LogOut, Trash2, FileText, VolumeX, Volume2, Crown, MessageSquare, CalendarDays } from 'lucide-react';
import { storageEngine } from '../../services/storageEngine';
import { audioEngine } from '../../services/audioEngine';
import {
  getClinicalProtocolTemplate,
  getProtocolAssignmentAlias,
} from '../../services/clinicalProtocolTemplates';

interface PatientShellProps {
  brand: ClinicBrandConfig;
  client: ClientProfile;
  onUpdateClient: (updated: ClientProfile) => Promise<void>;
  /** Update local UI for data already persisted by an atomic repository operation. */
  onClientPersistedElsewhere: (updated: ClientProfile) => void;
  onOpenRebrand: () => void;
  initialInvitationCode?: string;
  onInvitationAccepted?: () => void;
}

export const PatientShell: React.FC<PatientShellProps> = ({
  brand,
  client,
  onUpdateClient,
  onClientPersistedElsewhere,
  initialInvitationCode,
  onInvitationAccepted,
}) => {
  const [activeTab, setActiveTab] = useState<'home' | 'sessions' | 'education' | 'progress' | 'messages' | 'appointments' | 'profile'>('home');
  const [activeSessionExp, setActiveSessionExp] = useState<ExperienceType | null>(null);
  const [completedSession, setCompletedSession] = useState<SessionRecord | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMuted, setIsMuted] = useState(audioEngine.getMuted());
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const [showClinicianLink, setShowClinicianLink] = useState(!!initialInvitationCode);
  const [invitationCode, setInvitationCode] = useState(initialInvitationCode || '');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [showProtocolDetails, setShowProtocolDetails] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const evidenceProtocol = client.assignedProtocol ? getClinicalProtocolTemplate(client.assignedProtocol) : undefined;
  const protocolAlias = client.customProtocolConfig && client.assignedProtocol
    ? getProtocolAssignmentAlias(client.customProtocolConfig, client.assignedProtocol)
    : undefined;
  const isClinicianLinked = !!(client.clinicianId || client.linkedClinicianCode);

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = '/';
  };

  const handleLinkClinician = async () => {
    if (!invitationCode.trim()) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      const linkedClient = await storageEngine.acceptPatientInvitation(invitationCode, client);
      onClientPersistedElsewhere(linkedClient);
      onInvitationAccepted?.();
      setInvitationCode('');
      setShowClinicianLink(false);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Could not accept this invitation.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      if (auth.currentUser) {
        try {
          await deleteDoc(doc(db, 'users', auth.currentUser.uid));
          await auth.currentUser.delete();
          window.location.href = '/welcome';
        } catch (err) {
          alert('Failed to delete account. Please log out and log back in to verify your identity, then try again.');
        }
      }
    }
  };

  const handleStartSession = (exp: ExperienceType) => {
    setActiveSessionExp(exp);
  };

  const handleSessionComplete = async (session: SessionRecord) => {
    await storageEngine.saveSession(session);
    const persistedClient = await storageEngine.getClient(client.id);
    if (!persistedClient) throw new Error('The saved session could not be reloaded. Try again.');
    onClientPersistedElsewhere(persistedClient);
    setActiveSessionExp(null);
    setCompletedSession(session);
  };

  const handleToggleMute = () => {
    const newState = !isMuted;
    audioEngine.setMuted(newState);
    setIsMuted(newState);
  };

  const clinicianConnection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
      {isClinicianLinked ? (
        <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--status-active-bg)', color: 'var(--status-active)', fontSize: '13px', fontWeight: 600 }}>
          Connected to your clinician
        </div>
      ) : !showClinicianLink ? (
        <button onClick={() => setShowClinicianLink(true)} className="btn btn-secondary" style={{ width: '100%' }}>
          Connect to Clinician
        </button>
      ) : (
        <>
          <label htmlFor="clinician-invitation-code" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Invitation code
          </label>
          <input
            id="clinician-invitation-code"
            value={invitationCode}
            onChange={(event) => setInvitationCode(event.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoFocus={!!initialInvitationCode}
            className="font-mono"
            style={{ width: '100%', padding: '11px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: '14px', letterSpacing: '0.06em' }}
          />
          <div style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
            Use the code from your clinician. You must be signed in with the email address they invited.
          </div>
          {linkError && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '12px' }}>{linkError}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => void handleLinkClinician()} disabled={isLinking || !invitationCode.trim()} className="btn btn-primary" style={{ flex: 1, padding: '11px 14px', fontSize: '13px', opacity: isLinking ? 0.7 : 1 }}>
              {isLinking ? 'Connecting…' : 'Accept Invitation'}
            </button>
            <button onClick={() => { setShowClinicianLink(false); setLinkError(null); }} disabled={isLinking} className="btn btn-ghost" style={{ padding: '11px 14px' }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );

  const exportCSV = async () => {
    let allSessions: SessionRecord[];
    try {
      allSessions = await storageEngine.getSessions(client.id);
    } catch {
      alert('Session data is unavailable right now. Try again after the connection recovers.');
      return;
    }
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

  if (activeSessionExp) {
    return (
      <SessionRunner
        client={client}
        selectedExperience={activeSessionExp}
        onComplete={handleSessionComplete}
        onCancel={() => setActiveSessionExp(null)}
      />
    );
  }

  if (completedSession) {
    return (
      <PostSessionSummary
        session={completedSession}
        onViewProgress={() => {
          setCompletedSession(null);
          setActiveTab('progress');
        }}
      />
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingFlow
        client={client}
        onFinish={async updated => {
          await onUpdateClient({ ...client, ...updated });
          setShowOnboarding(false);
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        maxWidth: '480px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-patient-base)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 40px rgba(0,0,0,0.06)',
      }}
    >
      {/* Patient App Top Bar */}
      <header
        style={{
          padding: '16px 20px',
          paddingTop: 'max(16px, env(safe-area-inset-top, 16px))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-patient-card)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isClinicianLinked && brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
            <img
              src={brand.logoUrl}
              alt="Clinic Logo"
              style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }}
            />
          ) : (
            <BrandLogo size={28} variant="terracotta" />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{isClinicianLinked ? brand.name : 'Waveable'}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Training Portal</div>
          </div>
        </div>

      </header>

      {/* Main Tab Content */}
      <main style={{ flex: 1, padding: '20px' }}>
        {activeTab === 'home' && !isClinicianLinked && (
          <section className="card-patient" aria-label="Clinician invitation" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>Have an invitation from your clinician?</div>
              <div style={{ marginTop: '3px', fontSize: '12px', color: 'var(--text-secondary)' }}>Connect your account so your clinician can manage your training plan.</div>
            </div>
            {clinicianConnection}
          </section>
        )}
        {activeTab === 'home' && (
          <HomeScreen
            client={client}
            onStartSession={handleStartSession}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'sessions' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '30px' }}>
            <div>
              <h1 className="font-display" style={{ fontSize: '28px', fontWeight: 400 }}>
                Training Modalities
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Choose your experience and begin training.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '6px' }}>
              {[
                { id: 'neuro-gambit', title: 'NeuroGambit', icon: Crown, desc: 'Chess tactical calculation, impulse gating & tilt reset', badge: 'NEW • Chess', gradient: 'linear-gradient(135deg, rgba(232, 150, 122, 0.25), rgba(92, 140, 70, 0.25))', researchUrl: 'https://doi.org/10.1016/j.clinph.2016.10.015' },
                { id: 'immersive-3d', title: 'Generative XR', icon: Box, desc: 'Subtle atmospheric WebXR experience', badge: 'VR', gradient: 'linear-gradient(135deg, #7B68AE22, #E8967A22)', researchUrl: 'https://doi.org/10.3389/fnhum.2019.00210' },
                { id: 'generative-music', title: 'Generative Music', icon: Music, desc: 'Brain-generated melody, synth & rhythm', badge: 'Music', gradient: 'linear-gradient(135deg, #4A90D922, #5C8C4622)', researchUrl: 'https://doi.org/10.1016/s0031-9384(97)00436-8' },
                { id: 'narrative-story', title: 'Graphic Novel', icon: BookOpen, desc: 'Biometric driven narrative therapy', badge: 'Narrative', gradient: 'linear-gradient(135deg, #E8967A22, #C4A35A22)', researchUrl: 'https://doi.org/10.1145/1978942.1978958' },
                { id: 'skyline-drift', title: 'Skyline Drift', icon: Mountain, desc: 'Focus-driven glider flight across procedural landscapes', badge: 'Focus', gradient: 'linear-gradient(135deg, #E8967A22, #E4B87C22)', researchUrl: 'https://doi.org/10.1109/TNSRE.2016.2626989' },
                { id: 'tidal-garden', title: 'Tidal Garden', icon: Waves, desc: 'Grow a marine garden powered by Alpha calm waves', badge: 'Calm', gradient: 'linear-gradient(135deg, #7B68AE22, #4A90D922)', researchUrl: 'https://doi.org/10.1007/s10484-013-9216-0' },
                { id: 'breath-weave', title: 'Breath Weave', icon: Wind, desc: 'Harmonic tapestry woven with guided breathing', badge: 'Breathing', gradient: 'linear-gradient(135deg, #5C8C4622, #C4A35A22)', researchUrl: 'https://doi.org/10.1007/s10484-015-9276-4' },
                { id: 'signal-sort', title: 'Signal Sort', icon: Target, desc: 'Stillness gating for motor control and focus', badge: 'SMR', gradient: 'linear-gradient(135deg, #C4A35A22, #E8967A22)', researchUrl: 'https://doi.org/10.1007/s10484-015-9304-4' },
                { id: 'rhythm-lock', title: 'Rhythm Lock', icon: Music, desc: 'Polyrhythmic ambient synthesizer with real-time feedback', badge: 'Attention', gradient: 'linear-gradient(135deg, #4A90D922, #7B68AE22)', researchUrl: 'https://doi.org/10.3389/fnhum.2020.00310' },
                { id: 'media-mode', title: 'Media Mode', icon: Tv, desc: 'Watch videos with neuro-luminosity modulation', badge: 'Streaming', gradient: 'linear-gradient(135deg, #E4B87C22, #C4A35A22)', researchUrl: 'https://doi.org/10.1007/s10484-016-9324-4' },
                { id: 'soundscape-mode', title: 'Soundscape Mode', icon: Headphones, desc: 'Audio-only binaural soundscapes for eyes-closed training', badge: 'Audio', gradient: 'linear-gradient(135deg, #5C8C4622, #7B68AE22)', researchUrl: 'https://doi.org/10.1016/j.clinph.2016.10.015' },
                { id: 'mandala', title: 'Mandala Breathing', icon: CircleDot, desc: 'Concentric breathing circles with live amplitude feedback', badge: 'Classic', gradient: 'linear-gradient(135deg, #E8967A22, #7B68AE22)', researchUrl: 'https://doi.org/10.1007/s10484-012-9204-4' },
                { id: 'eeg-mandala', title: 'Generative Mandella', icon: Flower2, desc: 'A growing ornamental record of your neurofeedback session', badge: 'Visual', gradient: 'linear-gradient(135deg, #8B9D8333, #C66B3D33)', researchUrl: 'https://doi.org/10.1007/s10484-012-9204-4' },
              ].map(exp => {
                const Icon = exp.icon;
                return (
                  <div
                    key={exp.id}
                    onClick={() => handleStartSession(exp.id as any)}
                    className="card-patient"
                    style={{
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '24px 12px 16px',
                      textAlign: 'center',
                      transition: 'all 0.2s ease',
                      background: exp.gradient,
                      gap: '8px',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--brand-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '4px',
                      }}
                    >
                      <Icon size={24} />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                      {exp.title}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                      {exp.desc}
                    </div>
                    {(exp as any).researchUrl && (
                      <a 
                        href={(exp as any).researchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          marginTop: '6px',
                          fontSize: '10px',
                          color: 'var(--brand-primary)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: 'var(--brand-primary-subtle)',
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontWeight: 500,
                          transition: 'background 0.2s',
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(74, 144, 217, 0.2)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'var(--brand-primary-subtle)'}
                      >
                        <BookOpen size={10} /> View Research
                      </a>
                    )}
                    <span className="status-tag status-tag-active" style={{ fontSize: '9px', padding: '2px 8px', marginTop: '4px' }}>
                      {exp.badge}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'education' && <EducationHub />}

        {activeTab === 'progress' && <ProgressHistory client={client} />}

        {activeTab === 'messages' && (isClinicianLinked
          ? <PatientMessagingView patientId={client.id} />
          : <UnlinkedCareFeature feature="messages" />)}

        {activeTab === 'appointments' && (isClinicianLinked
          ? <PatientAppointmentsView />
          : <UnlinkedCareFeature feature="appointments" />)}

        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
            {/* Profile Info Card */}
            <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Avatar with upload overlay */}
                <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      if (file.size > 2 * 1024 * 1024) {
                        alert('Image must be under 2MB');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onloadend = async () => {
                        const base64 = reader.result as string;
                        const updated = { ...client, avatarUrl: base64 };
                        setIsSavingProfile(true);
                        setProfileSaveError(null);
                        try {
                          await onUpdateClient(updated);
                          setPendingAvatarUrl(null);
                        } catch (error) {
                          setPendingAvatarUrl(base64);
                          setProfileSaveError(error instanceof Error ? error.message : 'The profile photo could not be saved.');
                        } finally {
                          setIsSavingProfile(false);
                        }
                      };
                      reader.readAsDataURL(file);
                    }
                  };
                  input.click();
                }} role="button" aria-label="Upload profile photo" aria-disabled={isSavingProfile}>
                  {client.avatarUrl && (client.avatarUrl.startsWith('data:') || client.avatarUrl.startsWith('blob:')) ? (
                    <img
                      src={client.avatarUrl}
                      alt={client.name}
                      style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--brand-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        fontWeight: 700,
                      }}
                    >
                      {client.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--brand-primary)',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid var(--surface-patient-card)',
                    }}
                  >
                    <Camera size={11} />
                  </div>
                </div>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{client.name}</h2>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{client.email}</div>
                </div>
              </div>

              {profileSaveError && (
                <div role="alert" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', fontSize: '12px' }}>
                  {profileSaveError}
                  <button
                    type="button"
                    disabled={isSavingProfile || !pendingAvatarUrl}
                    onClick={async () => {
                      if (!pendingAvatarUrl) return;
                      setIsSavingProfile(true);
                      setProfileSaveError(null);
                      try {
                        await onUpdateClient({ ...client, avatarUrl: pendingAvatarUrl });
                        setPendingAvatarUrl(null);
                      } catch (error) {
                        setProfileSaveError(error instanceof Error ? error.message : 'The profile photo could not be saved.');
                      } finally {
                        setIsSavingProfile(false);
                      }
                    }}
                    className="btn btn-ghost"
                    style={{ marginLeft: '8px' }}
                  >Retry</button>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div><strong>Goal:</strong> {client.condition || 'Unavailable'}</div>
                {protocolAlias && <div><strong>Name:</strong> {protocolAlias}</div>}
                <div><strong>Protocol:</strong> {evidenceProtocol?.name ?? client.assignedProtocol?.replace(/-/g, ' ').toUpperCase() ?? 'Assignment required'}</div>
                <div><strong>Weekly Target:</strong> {client.prescribedSessionsPerWeek != null ? `${client.prescribedSessionsPerWeek} sessions / week` : 'Unavailable'}</div>
                <div><strong>Completed:</strong> {client.completedSessionsCount} sessions total</div>
              </div>
            </div>

            {/* Actions Card */}
            <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => setShowOnboarding(true)}
                className="btn btn-secondary"
                style={{ width: '100%' }}
              >
                Re-run Assessment & Headband Setup
              </button>

              <button
                onClick={() => setShowProtocolDetails(true)}
                className="btn btn-secondary"
                style={{ width: '100%' }}
              >
                View Protocol Details
              </button>

              {clinicianConnection}
            </div>

            {/* Account Section — separated and pushed down */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', paddingLeft: '4px' }}>
                Account
              </div>
              <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={handleToggleMute}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  {isMuted ? 'Unmute App Audio' : 'Mute App Audio'}
                </button>

                <button
                  onClick={exportCSV}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <FileText size={15} />
                  {exportStatus === 'done' ? 'Exported ✓' : 'Export Data (CSV)'}
                </button>

                <button
                  onClick={handleLogout}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <LogOut size={15} /> Log Out
                </button>

                <button
                  onClick={handleDeleteAccount}
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    color: 'var(--status-alert)',
                    borderColor: 'var(--status-alert)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <Trash2 size={15} /> Delete Account
                </button>
              </div>
            </div>

            <ChangePasswordForm variant="patient" />
          </div>
        )}
      </main>

      {showProtocolDetails && (
        <ProtocolDetailsModal client={client} onClose={() => setShowProtocolDetails(false)} />
      )}

      {/* Patient Mobile Bottom Tab Bar */}
      <nav
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 20,
          backgroundColor: 'var(--surface-patient-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '10px 0',
          paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
        }}
      >
        {[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'sessions', label: 'Train', icon: Compass },
          { id: 'education', label: 'Science', icon: BookOpen },
          { id: 'progress', label: 'Progress', icon: Activity },
          { id: 'messages', label: 'Messages', icon: MessageSquare },
          { id: 'appointments', label: 'Visits', icon: CalendarDays },
          { id: 'profile', label: 'Profile', icon: User },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                background: 'none',
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: isActive ? 'var(--brand-primary)' : 'var(--text-tertiary)',
                transition: 'color 0.15s ease',
              }}
            >
              <Icon size={19} />
              <span style={{ fontSize: '10px', fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

const UnlinkedCareFeature: React.FC<{ feature: 'messages' | 'appointments' }> = ({ feature }) => (
  <section className="card-patient" role="status" style={{ padding: '28px 22px', textAlign: 'center' }}>
    <h1 style={{ margin: 0, fontSize: '22px', textTransform: 'capitalize' }}>{feature}</h1>
    <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
      Connect your account with a clinician before using {feature}. You can enter an invitation code from Home or Profile.
    </p>
  </section>
);
