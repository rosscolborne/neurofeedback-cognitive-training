import React from 'react';
import { GameCatalogue } from '../../consumer/catalogue/GameCatalogue';

// The Train tab (NFCT-12): the game catalogue.

interface TrainTabProps {
  readonly onOpenGame: (gameId: string) => void;
}

export const TrainTab: React.FC<TrainTabProps> = ({ onOpenGame }) => (
  <div className="train-tab">
    <header className="train-tab-header">
      <h1 className="font-display">Train</h1>
      <p>Pick a game and play. No headset needed.</p>
    </header>

    <GameCatalogue onOpenGame={onOpenGame} />
  </div>
);
