import React from 'react';
import { HOME_ALL_RUNS_BUTTON_ID, HOME_PLAY_BUTTON_ID, HomeOverview } from '../overview/HomeOverview';
import type { GameRequest } from './gameRequest';

interface HomeScreenProps {
  readonly playerId: string;
  /** The player's profile name; the greeting uses its first word. */
  readonly displayName: string | null;
  readonly onOpenGame: (game: GameRequest) => void;
  /** Opens Progress at its achievements. */
  readonly onOpenAchievements: () => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The Home tab (NFCT-13): a greeting, then play, the streak, achievements and recent runs. */
export const HomeScreen: React.FC<HomeScreenProps> = ({ playerId, displayName, onOpenGame, onOpenAchievements }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
      <h1
        className="font-display"
        style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15, overflowWrap: 'anywhere' }}
      >
        {getGreeting()}{displayName ? `, ${displayName.split(/\s+/)[0]}.` : '.'}
      </h1>
    </div>

    <HomeOverview
      playerId={playerId}
      onPlay={() => onOpenGame({ gameId: 'mental-math', returnFocusTo: HOME_PLAY_BUTTON_ID })}
      onOpenAchievements={onOpenAchievements}
      onOpenGameProgress={() => onOpenGame({ gameId: 'mental-math', initialView: 'progress', returnFocusTo: HOME_ALL_RUNS_BUTTON_ID })}
    />
  </div>
);
