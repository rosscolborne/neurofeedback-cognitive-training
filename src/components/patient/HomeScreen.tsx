import React from 'react';

interface HomeScreenProps {
  /** The player's profile name; the greeting uses its first word. */
  displayName: string | null;
  /** The games (NFCT-13): play, the streak, achievements and recent runs. */
  gamesSection?: React.ReactNode;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  displayName,
  gamesSection,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
    {/* Greeting Header */}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
      <h1
        className="font-display"
        style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15, overflowWrap: 'anywhere' }}
      >
        {getGreeting()}{displayName ? `, ${displayName.split(/\s+/)[0]}.` : '.'}
      </h1>
    </div>

    {gamesSection}
  </div>
);
