import React from 'react';

interface ProgressHistoryProps {
  /** Game progress (NFCT-22), shown under the title. */
  gamesSection?: React.ReactNode;
}

export const ProgressHistory: React.FC<ProgressHistoryProps> = ({ gamesSection }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
    {/* Title */}
    <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
      Your Progress
    </h1>

    {gamesSection}
  </div>
);
