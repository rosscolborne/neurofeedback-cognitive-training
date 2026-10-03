import React, { useRef, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, type User as AuthUser } from 'firebase/auth';
import type { UserProfile } from '@nfct/shared';
import { auth, firestoreCache } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useSignOut } from '../account/useSignOut';
import { HomeScreen } from './HomeScreen';
import { ProgressHistory } from './ProgressHistory';
import { ChangePasswordForm } from '../account/ChangePasswordForm';
import { getAccountDeletionErrorMessage } from '../account/accountDeletionErrors';
import { BrandLogo } from '../brand/BrandLogo';
import { Home, Compass, Activity, User, Camera, LogOut, Trash2, VolumeX, Volume2, ChevronRight, Headphones } from 'lucide-react';
import { TrainTab } from './TrainTab';
import { audioEngine } from '../../services/audioEngine';
import { gameCardButtonId } from '../../consumer/catalogue/cardIds';
import { GameScreen } from '../../consumer/games/GameScreen';
import { MENTAL_MATH_PROGRESS_CARD_BUTTON_ID, MentalMathProgressCard } from '../../consumer/games/mentalMath/MentalMathProgressCard';
import { useOpenGame } from '../../consumer/games/useOpenGame';
import { HOME_ALL_RUNS_BUTTON_ID, HOME_PLAY_BUTTON_ID, HomeOverview } from '../../consumer/overview/HomeOverview';
import { PROGRESS_PLAY_BUTTON_ID, ProgressOverview } from '../../consumer/overview/ProgressOverview';
import { createDemoModeEegProvider } from '../../services/demoModeEegCapture';
import { profileRepository } from '../../consumer/repositories';
import { ProfilePhotoError, profilePhotoFromFile } from '../../consumer/profile/profilePhoto';
import { APP_DISPLAY_NAME } from '../../config/appIdentity';

// NFCT-21, NFCT-12: games open from the Train tab's catalogue until the
// consumer shell exists (NFCT-6). Demo Mode's synthetic EEG is offered as an
// optional, clearly simulated recording; a game never needs it.
const demoModeEegProvider = createDemoModeEegProvider();

/** Where focus goes when a closed game's opener is gone: the current tab (NFCT-52). */
const currentTabButton = () => document.querySelector<HTMLElement>('.patient-bottom-nav [aria-current="page"]');

/** Up to two initials for the profile avatar, from the player's name or else their email. */
function initialsOf(name: string | null, email: string | null): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return Array.from(email ?? '')[0]?.toUpperCase() ?? '';
}

interface PatientShellProps {
  /** The signed-in player. Their email comes from Firebase Auth, not the profile. */
  user: AuthUser;
  profile: UserProfile;
  /** Opens headset pairing and the fit check. */
  onSetUpHeadset?: () => void;
}

export const PatientShell: React.FC<PatientShellProps> = ({
  user,
  profile,
  onSetUpHeadset,
}) => {
  const playerId = user.uid;
  const [activeTab, setActiveTab] = useState<'home' | 'sessions' | 'progress' | 'profile'>('home');
  // Home's "See all achievements" opens Progress at its achievements (NFCT-13). The request lasts
  // only for the Progress visit it opened: leaving Progress drops it (see below, after activeTab).
  const [progressFocus, setProgressFocus] = useState<'achievements' | null>(null);
  const [progressFocusTab, setProgressFocusTab] = useState<string>('home');
  // The open catalogue game (NFCT-12), and the view it opens on: its start
  // screen, or its progress (NFCT-22's Progress-tab card). Closing it returns
  // focus to the control that opened it (NFCT-52).
  const [openGame, setOpenGame, closeGame] = useOpenGame(currentTabButton);
  const [isMuted, setIsMuted] = useState(audioEngine.getMuted());
  const photoInput = useRef<HTMLInputElement>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  // A processed photo whose save failed, kept so Retry sends the same photo.
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState<string | null>(null);
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  // Any change to a tab other than Progress drops a pending "See all achievements" request, so a later,
  // ordinary visit to Progress opens at the top (state adjusted while rendering, not in an effect).
  if (progressFocusTab !== activeTab) {
    setProgressFocusTab(activeTab);
    if (activeTab !== 'progress' && progressFocus !== null) setProgressFocus(null);
  }
  // Sign-out clears this device's Firestore cache and reloads the app; it asks
  // first if some activity has not uploaded yet (AuthContext.logout).
  const { logout, updateProfile } = useAuth();
  const signOutFlow = useSignOut(logout);
  const handleLogout = signOutFlow.requestSignOut;

  const saveProfilePhoto = async (dataUrl: string) => {
    setIsSavingProfile(true);
    setProfileSaveError(null);
    try {
      await updateProfile({ avatar: { kind: 'photo', dataUrl } });
      setPendingPhoto(null);
    } catch (error) {
      console.warn('Could not save the profile photo:', error);
      setPendingPhoto(dataUrl);
      setProfileSaveError('The profile photo couldn’t be saved. Check your connection, then retry.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePhotoChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Choosing the same file again must still fire a change.
    event.target.value = '';
    if (!file || isSavingProfile) return;
    let dataUrl: string;
    setIsSavingProfile(true);
    setProfileSaveError(null);
    setPendingPhoto(null);
    try {
      dataUrl = await profilePhotoFromFile(file);
    } catch (error) {
      setProfileSaveError(error instanceof ProfilePhotoError ? error.message : 'This photo couldn’t be used. Choose a different photo.');
      setIsSavingProfile(false);
      return;
    }
    await saveProfilePhoto(dataUrl);
  };

  const handleDeleteAccount = async () => {
    if (isDeletingAccount || !deletePassword) return;
    // Submitting is the final confirmation. Hand the password to reauthentication
    // and drop it from state so teardown never re-renders it.
    const password = deletePassword;
    setDeletePassword('');
    const signedIn = auth.currentUser;
    if (!signedIn?.email || signedIn.uid !== playerId) {
      setAccountDeletionError('Your signed-in account changed. Restart account deletion.');
      return;
    }
    const ensureSameAccount = () => {
      if (auth.currentUser !== signedIn) throw new Error('Your signed-in account changed. Restart account deletion.');
    };
    setIsDeletingAccount(true);
    setAccountDeletionError(null);
    try {
      await reauthenticateWithCredential(signedIn, EmailAuthProvider.credential(signedIn.email, password));
      ensureSameAccount();
      // The profile goes first, and the Auth account only once the server has
      // accepted that. If the Auth deletion then fails, trying again repeats
      // both steps. Game sessions, EEG recordings and the server-owned
      // aggregates under users/{uid} stay until server-driven deletion (NFCT-23).
      await profileRepository.deleteProfile().acknowledged;
      ensureSameAccount();
      // Deleting the Auth account runs inside the cache cleanup, so its
      // sign-out is not mistaken for an account change. Once it succeeds the
      // deleted account's cached data and queued writes are removed from this
      // device, and the app loads afresh at the welcome screen.
      await firestoreCache.endSession({
        reason: 'account-deleted',
        signOut: false,
        destination: '/welcome',
        before: async () => {
          await signedIn.delete();
        },
      });
    } catch (err) {
      setAccountDeletionError(getAccountDeletionErrorMessage(err));
      // Only failure leaves the pending state; success keeps it until the redirect lands.
      setIsDeletingAccount(false);
    }
  };

  const openAccountDeletion = () => {
    setAccountDeletionError(null);
    setShowDeletePassword(true);
  };

  const cancelAccountDeletion = () => {
    setShowDeletePassword(false);
    setDeletePassword('');
    setAccountDeletionError(null);
  };

  const deletionPasswordForm = showDeletePassword && (isDeletingAccount ? (
    <div className="account-deletion-confirmation account-deletion-status" role="status" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
      Deleting your account…
    </div>
  ) : (
    <form
      className="account-deletion-confirmation"
      onSubmit={(event) => { event.preventDefault(); void handleDeleteAccount(); }}
    >
      <p style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)' }}>
        Are you sure you want to delete your account? This action cannot be undone.
      </p>
      <label className="account-deletion-label" htmlFor="account-deletion-password">
        Enter your password to confirm account deletion
        <input
          className="account-deletion-password"
          id="account-deletion-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={deletePassword}
          onChange={(event) => setDeletePassword(event.target.value)}
          aria-invalid={!!accountDeletionError}
          aria-describedby={accountDeletionError ? 'account-deletion-error' : undefined}
        />
      </label>
      {accountDeletionError && <p className="account-deletion-error" id="account-deletion-error" role="alert">{accountDeletionError}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px' }}>
        <button className="btn account-deletion-submit" type="submit" disabled={!deletePassword}>
          Confirm account deletion
        </button>
        <button className="btn btn-ghost" type="button" onClick={cancelAccountDeletion} style={{ minHeight: '42px', marginTop: '4px' }}>
          Cancel
        </button>
      </div>
    </form>
  ));

  const handleToggleMute = () => {
    const newState = !isMuted;
    audioEngine.setMuted(newState);
    setIsMuted(newState);
  };

  if (openGame && openGame.ownerId === playerId) {
    return <GameScreen gameId={openGame.gameId} initialView={openGame.initialView} eegProvider={demoModeEegProvider} onExit={closeGame} />;
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
          <BrandLogo size={28} variant="terracotta" />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{APP_DISPLAY_NAME}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Training Portal</div>
          </div>
        </div>

      </header>

      {/* Main Tab Content */}
      <main style={{ flex: 1, padding: '20px' }}>
        {activeTab === 'home' && (
          <HomeScreen
            displayName={profile.displayName}
            gamesSection={(
              <HomeOverview
                playerId={playerId}
                onPlay={() => setOpenGame({ gameId: 'mental-math', ownerId: playerId, returnFocusTo: HOME_PLAY_BUTTON_ID })}
                onOpenAchievements={() => { setProgressFocus('achievements'); setActiveTab('progress'); }}
                onOpenGameProgress={() => setOpenGame({ gameId: 'mental-math', ownerId: playerId, initialView: 'progress', returnFocusTo: HOME_ALL_RUNS_BUTTON_ID })}
              />
            )}
          />
        )}

        {activeTab === 'sessions' && (
          <TrainTab
            onOpenGame={(gameId) => setOpenGame({ gameId, ownerId: playerId, returnFocusTo: gameCardButtonId(gameId) })}
          />
        )}

        {activeTab === 'progress' && (
          <ProgressHistory
            gamesSection={(
              <ProgressOverview
                playerId={playerId}
                onPlay={() => setOpenGame({ gameId: 'mental-math', ownerId: playerId, returnFocusTo: PROGRESS_PLAY_BUTTON_ID })}
                focusSection={progressFocus}
                onSectionFocused={() => setProgressFocus(null)}
                games={<MentalMathProgressCard onOpen={() => setOpenGame({ gameId: 'mental-math', ownerId: playerId, initialView: 'progress', returnFocusTo: MENTAL_MATH_PROGRESS_CARD_BUTTON_ID })} />}
              />
            )}
          />
        )}

        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
            {/* Profile Info Card */}
            <div className="card-patient" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  data-testid="profile-photo-input"
                  onChange={(event) => { void handlePhotoChosen(event); }}
                />
                <button
                  type="button"
                  aria-label={profile.avatar?.kind === 'photo' ? 'Change profile photo' : 'Upload profile photo'}
                  disabled={isSavingProfile}
                  onClick={() => photoInput.current?.click()}
                  style={{ position: 'relative', flexShrink: 0, padding: 0, border: 'none', background: 'none', borderRadius: '50%', cursor: isSavingProfile ? 'progress' : 'pointer' }}
                >
                  {profile.avatar?.kind === 'photo' ? (
                    <img
                      src={profile.avatar.dataUrl}
                      alt=""
                      style={{ display: 'block', width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span
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
                      {initialsOf(profile.displayName, user.email)}
                    </span>
                  )}
                  <span
                    aria-hidden="true"
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
                  </span>
                </button>
                <div style={{ minWidth: 0 }}>
                  {profile.displayName && <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{profile.displayName}</h2>}
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{user.email}</div>
                </div>
              </div>
              {isSavingProfile && <div role="status" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Saving your photo…</div>}
              {profileSaveError && (
                <div role="alert" style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--status-alert-bg)', color: 'var(--status-alert)', fontSize: '12px' }}>
                  {profileSaveError}
                  {pendingPhoto && (
                    <button
                      type="button"
                      disabled={isSavingProfile}
                      onClick={() => { void saveProfilePhoto(pendingPhoto); }}
                      className="btn btn-ghost"
                      style={{ marginLeft: '8px' }}
                    >Retry</button>
                  )}
                </div>
              )}
            </div>
            <div>
              <h2 className="section-label">Training</h2>
              <div className="list-group">
                <button type="button" className="list-row" onClick={onSetUpHeadset} disabled={!onSetUpHeadset}>
                  <Headphones size={18} className="list-row-icon" aria-hidden="true" />
                  <span className="list-row-label">
                    Set Up Headset
                    <span className="list-row-hint">Pair a Muse and check its fit</span>
                  </span>
                  <ChevronRight size={16} className="list-row-trail" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <h2 className="section-label">Account</h2>
              <div className="list-group">
                <button type="button" className="list-row" onClick={handleToggleMute}>
                  {isMuted ? <VolumeX size={18} className="list-row-icon" aria-hidden="true" /> : <Volume2 size={18} className="list-row-icon" aria-hidden="true" />}
                  {isMuted ? 'Unmute App Audio' : 'Mute App Audio'}
                </button>
                <button type="button" className="list-row" onClick={handleLogout} disabled={signOutFlow.busy}>
                  <LogOut size={18} className="list-row-icon" aria-hidden="true" />
                  {signOutFlow.busy ? 'Signing out…' : 'Log Out'}
                </button>
              </div>
            </div>

            <ChangePasswordForm />

            {/* Destructive action last, after routine account settings. */}
            <div className="list-group">
              <button
                onClick={openAccountDeletion}
                disabled={isDeletingAccount}
                className="list-row list-row-danger account-deletion-trigger"
                type="button"
              >
                <Trash2 size={18} className="list-row-icon" aria-hidden="true" />
                Delete Account
              </button>
              {deletionPasswordForm && <div style={{ padding: '0 16px 16px' }}>{deletionPasswordForm}</div>}
            </div>
          </div>
        )}
      </main>


      {/* Patient Mobile Bottom Tab Bar */}
      <nav
        className="patient-bottom-nav"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 20,
          backgroundColor: 'var(--surface-patient-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          padding: '4px 4px',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom, 4px))',
        }}
      >
        {[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'sessions', label: 'Train', icon: Compass },
          { id: 'progress', label: 'Progress', icon: Activity },
          { id: 'profile', label: 'Profile', icon: User },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                // Each tab fills its share of the bar so the whole column is tappable, not just the label.
                flex: '1 1 0',
                minHeight: '48px',
                padding: '6px 0',
                background: 'none',
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: isActive ? 'var(--brand-primary)' : 'var(--text-tertiary)',
                transition: 'color 0.15s ease',
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon size={19} />
              </span>
              <span className="patient-nav-label" style={{ fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
      {signOutFlow.dialog}
    </div>
  );
};
