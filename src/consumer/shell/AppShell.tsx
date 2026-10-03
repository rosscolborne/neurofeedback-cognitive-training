import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { User as AuthUser } from 'firebase/auth';
import type { UserProfile } from '@nfct/shared';
import { Activity, Compass, Home, User } from 'lucide-react';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { APP_DISPLAY_NAME } from '../../config/appIdentity';
import { createDemoModeEegProvider } from '../../services/demoModeEegCapture';
import { GameScreen } from '../games/GameScreen';
import { useOpenGame } from '../games/useOpenGame';
import { ProfileScreen } from '../profile/ProfileScreen';
import { useProfileScreenState } from '../profile/useProfileScreenState';
import type { GameRequest } from './gameRequest';
import { HomeScreen } from './HomeScreen';
import { ProgressScreen } from './ProgressScreen';
import { TrainScreen } from './TrainScreen';

// Demo Mode's synthetic EEG is offered as an optional, clearly simulated
// recording; a game never needs it (NFCT-21).
const demoModeEegProvider = createDemoModeEegProvider();

/** The tabs, each at its own path, so a reload or the browser's Back keeps the player where they were. */
const SHELL_TABS = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/train', label: 'Train', icon: Compass },
  { path: '/progress', label: 'Progress', icon: Activity },
  { path: '/profile', label: 'Profile', icon: User },
] as const;

/** What Home's "See all achievements" asks of the Progress visit it opens. */
interface ProgressRequest {
  readonly focus?: 'achievements';
}

/** Where focus goes when a closed game's opener is gone: the current tab (NFCT-52). */
const currentTabButton = () => document.querySelector<HTMLElement>('.app-tab-bar [aria-current="page"]');

interface AppShellProps {
  /** The signed-in player. Their email comes from Firebase Auth, not the profile. */
  user: AuthUser;
  profile: UserProfile;
  /** Opens headset pairing and the fit check. */
  onSetUpHeadset?: () => void;
}

/** The signed-in app: Home, Train, Progress and Profile, and a game open in place of them. */
export const AppShell: React.FC<AppShellProps> = ({ user, profile, onSetUpHeadset }) => {
  const playerId = user.uid;
  const location = useLocation();
  const navigate = useNavigate();
  // The open catalogue game (NFCT-12), and the view it opens on: its start
  // screen, or its progress (NFCT-22). Closing it returns focus to the control
  // that opened it (NFCT-52). It stays open if the location changes under it.
  const [openGame, setOpenGame, closeGame] = useOpenGame(currentTabButton);
  const openGameFor = (game: GameRequest) => setOpenGame({ ...game, ownerId: playerId });
  // Held here, not in the Profile tab, so a deletion or photo save in progress
  // survives switching tabs or opening a game.
  const profileState = useProfileScreenState(playerId);

  if (openGame && openGame.ownerId === playerId) {
    return <GameScreen gameId={openGame.gameId} initialView={openGame.initialView} eegProvider={demoModeEegProvider} onExit={closeGame} />;
  }

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const activeTab = SHELL_TABS.find((tab) => tab.path === path);
  if (!activeTab) return <Navigate to="/" replace />;

  // Home's "See all achievements" opens Progress at its achievements (NFCT-13).
  // The request belongs to the visit it opened: it is dropped once focused, and
  // an ordinary visit to Progress (a tab press) carries none.
  const progressFocus = activeTab.path === '/progress'
    && (location.state as ProgressRequest | null)?.focus === 'achievements' ? 'achievements' : null;

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        maxWidth: '480px',
        margin: '0 auto',
        backgroundColor: 'var(--surface-base)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        boxShadow: '0 0 40px rgba(0,0,0,0.06)',
      }}
    >
      <header
        style={{
          padding: '16px 20px',
          paddingTop: 'max(16px, env(safe-area-inset-top, 16px))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--surface-card)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <BrandLogo size={28} variant="terracotta" />
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{APP_DISPLAY_NAME}</div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '20px' }}>
        {activeTab.path === '/' && (
          <HomeScreen
            playerId={playerId}
            displayName={profile.displayName}
            onOpenGame={openGameFor}
            onOpenAchievements={() => navigate('/progress', { state: { focus: 'achievements' } satisfies ProgressRequest })}
          />
        )}
        {activeTab.path === '/train' && <TrainScreen onOpenGame={openGameFor} />}
        {activeTab.path === '/progress' && (
          <ProgressScreen
            playerId={playerId}
            onOpenGame={openGameFor}
            focusSection={progressFocus}
            onSectionFocused={() => navigate('/progress', { replace: true, state: null })}
          />
        )}
        {activeTab.path === '/profile' && <ProfileScreen user={user} profile={profile} state={profileState} onSetUpHeadset={onSetUpHeadset} />}
      </main>

      <nav
        className="app-tab-bar"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 20,
          backgroundColor: 'var(--surface-card)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          padding: '4px 4px',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom, 4px))',
        }}
      >
        {SHELL_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab.path}
              type="button"
              onClick={() => { if (!isActive) navigate(tab.path); }}
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
              <Icon size={19} />
              <span className="app-tab-label" style={{ fontWeight: isActive ? 700 : 500 }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
