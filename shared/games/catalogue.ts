import type { GameDefinition } from './definition';
import { mentalMath } from './mental-math';

// The games players can pick from, in display order (NFCT-12). Code-owned like
// the definitions themselves: never read from or written to Firestore.
//
// A listing adds only what a catalogue card needs and a definition does not
// say. Everything about play (modes, levels, run length, domain weights) comes
// from the definition, and the listing always points at the version new
// sessions are played with. Listings are not versioned: copy can change
// without touching a frozen game-version module.

/** The icon a game's card shows. The app maps each key to its own icon set. */
export const GAME_ICON_KEYS = ['calculator'] as const;
export type GameIconKey = (typeof GAME_ICON_KEYS)[number];

/** The parts of a game definition a catalogue reads. */
export type CatalogueGameDefinition = Pick<GameDefinition<unknown, object>, 'id' | 'domainWeights' | 'modes'>;

export interface GameListing {
  /** The current version of the game: what a session started from the catalogue plays. */
  readonly definition: CatalogueGameDefinition;
  /** The game's display name. */
  readonly name: string;
  /** One short sentence about how the game plays. */
  readonly summary: string;
  readonly icon: GameIconKey;
}

export const GAME_CATALOGUE: readonly GameListing[] = [
  {
    definition: mentalMath.definition,
    name: 'Mental Math',
    summary: 'Quick arithmetic that adapts to you as you play.',
    icon: 'calculator',
  },
];
