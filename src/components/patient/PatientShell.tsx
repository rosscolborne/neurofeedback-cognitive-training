import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth, db } from '../../services/firebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ClientProfile, ClinicBrandConfig, ExperienceType, SessionRecord } from '../../types';
import { HomeScreen } from './HomeScreen';
import { ProgressHistory } from './ProgressHistory';
import { OnboardingFlow } from './OnboardingFlow';
import { SessionRunner } from './SessionRunner';
import { PostSessionSummary } from './PostSessionSummary';
import { EducationHub } from './EducationHub';
import { BrandLogo } from '../brand/BrandLogo';
import { Home, Compass, BookOpen, Activity, User, Sliders, Mountain, Waves, Wind, Target, Music, Tv, Headphones, Sparkles, Camera, LogOut, Trash2, FileText, VolumeX, Volume2 } from 'lucide-react';
import { storageEngine } from '../../services/storageEngine';
import { audioEngine } from '../../services/audioEngine';

interface PatientShellProps {
  brand: ClinicBrandConfig;
  client: ClientProfile;
  onUpdateClient: (updated: ClientProfile) => void;
  onOpenRebrand: () => void;
}

export const PatientShell: React.FC<PatientShellProps> = ({
  brand,
  client,
  onUpdateClient,
  onOpenRebrand,
}) => {
  const [activeTab, setActiveTab] = useState<'home' | 'sessions' | 'education' | 'progress' | 'profile'>('home');
  const [activeSessionExp, setActiveSessionExp] = useState<ExperienceType | null>(null);
  const [completedSession, setCompletedSession] = useState<SessionRecord | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMuted, setIsMuted] = useState(audioEngine.getMuted());
  const [exportStatus, setExportStatus] = useState<'idle' | 'done'>('idle');
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = '/';
  };

  const handleLinkClinician = async () => {
    const code = window.prompt("Enter your clinician's code:");
    if (code && auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          linkedClinicianCode: code
        });
        alert('Clinician linked successfully! They now have access to your progress.');
      } catch (err) {
        alert('Failed to link clinician. Invalid code or network error.');
      }
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

  const handleSessionComplete = (session: SessionRecord) => {
    setActiveSessionExp(null);
    storageEngine.saveSession(session);
    const updatedClient = storageEngine.getCurrentClient({ uid: client.id });
    onUpdateClient(updatedClient);
    setCompletedSession(session);
  };

  const handleToggleMute = () => {
    const newState = !isMuted;
    audioEngine.setMuted(newState);
    setIsMuted(newState);
  };

  const exportCSV = () => {
    const allSessions = storageEngine.getSessions(client.id);
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
    const filename = `brainswell_progress_${new Date().toISOString().split('T')[0]}.csv`;

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
        onDone={() => setCompletedSession(null)}
      />
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingFlow
        client={client}
        onFinish={updated => {
          onUpdateClient({ ...client, ...updated });
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
          {client.linkedClinicianCode && brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
            <img
              src={brand.logoUrl}
              alt="Clinic Logo"
              style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }}
            />
          ) : (
            <BrandLogo size={28} variant="terracotta" />
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{client.linkedClinicianCode ? brand.name : 'Brainswell'}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Training Portal</div>
          </div>
        </div>

        {client.linkedClinicianCode && (
          <button
            onClick={onOpenRebrand}
            className="btn btn-ghost"
            style={{ padding: '6px 10px', fontSize: '11px', gap: '4px' }}
          >
            <Sliders size={13} /> Clinic Theme
          </button>
        )}
      </header>

      {/* Main Tab Content */}
      <main style={{ flex: 1, padding: '20px' }}>
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
                { id: 'skyline-drift', title: 'Skyline Drift', icon: Mountain, desc: 'Focus-driven glider flight across procedural landscapes', badge: 'Focus', gradient: 'linear-gradient(135deg, #E8967A22, #E4B87C22)' },
                { id: 'tidal-garden', title: 'Tidal Garden', icon: Waves, desc: 'Grow a marine garden powered by Alpha calm waves', badge: 'Calm', gradient: 'linear-gradient(135deg, #7B68AE22, #4A90D922)' },
                { id: 'breath-weave', title: 'Breath Weave', icon: Wind, desc: 'Harmonic tapestry woven with guided breathing', badge: 'Breathing', gradient: 'linear-gradient(135deg, #5C8C4622, #C4A35A22)' },
                { id: 'signal-sort', title: 'Signal Sort', icon: Target, desc: 'Stillness gating for motor control and focus', badge: 'SMR', gradient: 'linear-gradient(135deg, #C4A35A22, #E8967A22)' },
                { id: 'rhythm-lock', title: 'Rhythm Lock', icon: Music, desc: 'Polyrhythmic ambient synthesizer with real-time feedback', badge: 'Attention', gradient: 'linear-gradient(135deg, #4A90D922, #7B68AE22)' },
                { id: 'media-mode', title: 'Media Mode', icon: Tv, desc: 'Watch videos with neuro-luminosity modulation', badge: 'Streaming', gradient: 'linear-gradient(135deg, #E4B87C22, #C4A35A22)' },
                { id: 'soundscape-mode', title: 'Soundscape Mode', icon: Headphones, desc: 'Audio-only binaural soundscapes for eyes-closed training', badge: 'Audio', gradient: 'linear-gradient(135deg, #5C8C4622, #7B68AE22)' },
                { id: 'mandala', title: 'Mandala Breathing', icon: Sparkles, desc: 'Concentric breathing circles with live amplitude feedback', badge: 'Classic', gradient: 'linear-gradient(135deg, #E8967A22, #7B68AE22)' },
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
                      reader.onloadend = () => {
                        const base64 = reader.result as string;
                        onUpdateClient({ ...client, avatarUrl: base64 });
                      };
                      reader.readAsDataURL(file);
                    }
                  };
                  input.click();
                }}>
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

              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div><strong>Goal:</strong> {client.condition}</div>
                <div><strong>Protocol:</strong> {client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</div>
                <div><strong>Weekly Target:</strong> {client.prescribedSessionsPerWeek} sessions / week</div>
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

              {!client.linkedClinicianCode && (
                <button
                  onClick={handleLinkClinician}
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                >
                  Link to Clinician
                </button>
              )}
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
          </div>
        )}
      </main>

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
