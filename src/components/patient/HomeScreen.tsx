import React from 'react';
import { ClientProfile } from '../../types';

interface HomeScreenProps {
  client: ClientProfile;
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
  client,
  gamesSection,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
    {/* Greeting Header */}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
      <h1
        className="font-display"
        style={{ fontSize: '32px', color: 'var(--text-primary)', fontWeight: 400, lineHeight: 1.15 }}
      >
        {getGreeting()}{client.name ? `, ${client.name.split(' ')[0]}.` : '.'}
      </h1>
    </div>

    {gamesSection}
  </div>
);
