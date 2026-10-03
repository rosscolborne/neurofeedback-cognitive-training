import type { OpenGame } from '../games/useOpenGame';

/** A tab screen's request to open a game in place of the tabs; the shell adds the signed-in player. */
export type GameRequest = Omit<OpenGame, 'ownerId'>;
