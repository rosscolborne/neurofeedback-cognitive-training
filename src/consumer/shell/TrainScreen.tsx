import React from 'react';
import { gameCardButtonId } from '../catalogue/cardIds';
import { GameCatalogue } from '../catalogue/GameCatalogue';
import type { GameRequest } from './gameRequest';

interface TrainScreenProps {
  readonly onOpenGame: (game: GameRequest) => void;
}

/** The Train tab (NFCT-12): the game catalogue. */
export const TrainScreen: React.FC<TrainScreenProps> = ({ onOpenGame }) => (
  <div className="train-tab">
    <header className="train-tab-header">
      <h1 className="font-display">Train</h1>
      <p>Pick a game and play. No headset needed.</p>
    </header>

    <GameCatalogue onOpenGame={(gameId) => onOpenGame({ gameId, returnFocusTo: gameCardButtonId(gameId) })} />
  </div>
);
