import React from 'react';
import { GAME_SCREENS, type GameScreenProps } from './gameScreens';

/** The screen of a catalogue game. */
export const GameScreen: React.FC<GameScreenProps & { readonly gameId: string }> = ({ gameId, ...props }) => {
  const Screen = Object.hasOwn(GAME_SCREENS, gameId) ? GAME_SCREENS[gameId] : undefined;
  if (!Screen) throw new Error(`No screen for game '${gameId}'`);
  return <Screen {...props} />;
};
