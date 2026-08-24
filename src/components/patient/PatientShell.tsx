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
import { Home, Compass, BookOpen, Activity, User, Sliders, Mountain, Waves, Wind, Target, Music, Tv, Headphones, Sparkles } from 'lucide-react';

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
    setCompletedSession(session);
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
          {brand.logoUrl && brand.logoUrl.startsWith('data:image') ? (
            <img
              src={brand.logoUrl}
              alt="Clinic Logo"
              style={{ width: '28px', height: '28px', objectFit: 'contain' }}
            />
          ) : (
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'var(--brand-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: '14px',
                fontWeight: 700,
              }}
            >
              ●
            </div>
          )}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{brand.name}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Patient Training Portal</div>
          </div>
        </div>

        <button
          onClick={onOpenRebrand}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: '11px', gap: '4px' }}
        >
          <Sliders size={13} /> Clinic Theme
        </button>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h1 className="font-display" style={{ fontSize: '28px', fontWeight: 400 }}>
                Training Modalities
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Select an evidence-based brain-computer interface experience.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              {[
                { id: 'skyline-drift', title: 'Skyline Drift', icon: Mountain, desc: 'Glider flight across procedural landscapes driven by Theta/Beta focus ratio', badge: 'ADHD Focus' },
                { id: 'tidal-garden', title: 'Tidal Garden', icon: Waves, desc: 'Persistent marine biome growing across sessions with Alpha calm power', badge: 'Anxiety Track' },
                { id: 'breath-weave', title: 'Breath Weave', icon: Wind, desc: 'Harmonic loom tapestry woven in rhythm with 4-7-8 and box breathing', badge: 'Breathing' },
                { id: 'signal-sort', title: 'Signal Sort', icon: Target, desc: 'SMR stillness gating task for interference filtering & motor control', badge: 'SMR Poise' },
                { id: 'rhythm-lock', title: 'Rhythm Lock', icon: Music, desc: 'Generative polyrhythmic ambient synthesizer reacting to sustained presence', badge: 'Attention' },
                { id: 'media-mode', title: 'Media Mode', icon: Tv, desc: 'Streaming YouTube & nature videos with real-time neuro-luminosity modulation', badge: 'Streaming' },
                { id: 'soundscape-mode', title: 'Soundscape Mode', icon: Headphones, desc: 'Binaural & procedural nature soundscapes for eyes-closed sessions', badge: 'Audio' },
                { id: 'mandala', title: 'Mandala Breathing', icon: Sparkles, desc: 'Gentle concentric breathing circles with live microvolt amplitude feedback', badge: 'Classic' },
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
                      alignItems: 'flex-start',
                      gap: '14px',
                      padding: '16px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--brand-primary-subtle)',
                        color: 'var(--brand-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{exp.title}</div>
                        <span className="status-tag status-tag-active" style={{ fontSize: '10px' }}>{exp.badge}</span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>{exp.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'education' && <EducationHub />}

        {activeTab === 'progress' && <ProgressHistory client={client} />}

        {activeTab === 'profile' && (
          <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <img
                src={client.avatarUrl}
                alt={client.name}
                style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{client.name}</h2>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{client.email}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div><strong>Condition:</strong> {client.condition}</div>
              <div><strong>Prescribed Protocol:</strong> {client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</div>
              <div><strong>Prescribed Frequency:</strong> {client.prescribedSessionsPerWeek} sessions / week</div>
              <div><strong>Completed Total:</strong> {client.completedSessionsCount} sessions</div>
            </div>

            <button
              onClick={() => setShowOnboarding(true)}
              className="btn btn-secondary"
              style={{ marginTop: '10px' }}
            >
              Re-run Clinical Assessment & Headband Setup
            </button>

            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '16px 0' }} />

            <button
              onClick={handleLinkClinician}
              className="btn btn-secondary"
              style={{ width: '100%' }}
            >
              Link Clinician (Premium)
            </button>

            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '12px',
                borderRadius: '8px',
                width: '100%',
                cursor: 'pointer',
                marginTop: '8px'
              }}
            >
              Log Out
            </button>

            <button
              onClick={handleDeleteAccount}
              style={{
                background: '#FF4C4C15',
                color: '#FF4C4C',
                border: 'none',
                padding: '12px',
                borderRadius: '8px',
                width: '100%',
                cursor: 'pointer',
                marginTop: '8px'
              }}
            >
              Delete Account
            </button>
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
