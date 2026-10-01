import type React from 'react';
import type { EegCaptureProvider } from '../eeg/eegCapture';
import { MentalMathGame } from './mentalMath/MentalMathGame';

// The playable screen of each catalogue game, by game ID (NFCT-12). Every game
// in GAME_CATALOGUE has one; a test checks that.

export interface GameScreenProps {
  /** Optional simulated or measured EEG; a game never needs it. */
  readonly eegProvider?: EegCaptureProvider | null;
  readonly onExit: () => void;
}

export const GAME_SCREENS: Readonly<Record<string, React.ComponentType<GameScreenProps>>> = {
  'mental-math': MentalMathGame,
};
