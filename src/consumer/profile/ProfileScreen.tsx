import React, { useRef, useState } from 'react';
import type { User as AuthUser } from 'firebase/auth';
import type { UserProfile } from '@nfct/shared';
import { Camera, ChevronRight, Headphones, LogOut, Volume2, VolumeX } from 'lucide-react';
import { ChangePasswordForm } from '../../components/account/ChangePasswordForm';
import { DeleteAccount } from '../../components/account/DeleteAccount';
import { audioEngine } from '../../services/audioEngine';
import type { ProfileScreenState } from './useProfileScreenState';

/** Up to two initials for the profile avatar, from the player's name or else their email. */
function initialsOf(name: string | null, email: string | null): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return Array.from(email ?? '')[0]?.toUpperCase() ?? '';
}

interface ProfileScreenProps {
  /** The signed-in player. Their email comes from Firebase Auth, not the profile. */
  user: AuthUser;
  profile: UserProfile;
  /** From `useProfileScreenState`, held by the app shell. */
  state: ProfileScreenState;
  /** Opens headset pairing and the fit check. */
  onSetUpHeadset?: () => void;
}

/** The Profile tab: who is signed in, headset setup, and account settings. */
export const ProfileScreen: React.FC<ProfileScreenProps> = ({ user, profile, state, onSetUpHeadset }) => {
  const { isSavingProfile, profileSaveError, pendingPhoto, saveProfilePhoto, handlePhotoChosen, signOutFlow, deletion } = state;
  const [isMuted, setIsMuted] = useState(audioEngine.getMuted());
  const photoInput = useRef<HTMLInputElement>(null);

  const handleToggleMute = () => {
    const newState = !isMuted;
    audioEngine.setMuted(newState);
    setIsMuted(newState);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
      <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
        Profile
      </h1>

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
            {profile.displayName && <h2 style={{ fontSize: '18px', fontWeight: 600, overflowWrap: 'anywhere' }}>{profile.displayName}</h2>}
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
          <button type="button" className="list-row" onClick={signOutFlow.requestSignOut} disabled={signOutFlow.busy}>
            <LogOut size={18} className="list-row-icon" aria-hidden="true" />
            {signOutFlow.busy ? 'Signing out…' : 'Log Out'}
          </button>
        </div>
      </div>

      <ChangePasswordForm />

      {/* Destructive action last, after routine account settings. */}
      <DeleteAccount deletion={deletion} />
      {signOutFlow.dialog}
    </div>
  );
};
