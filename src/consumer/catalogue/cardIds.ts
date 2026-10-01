// DOM ids of the Train tab's cards (NFCT-52): a card's button gets focus back
// when what it opened closes.

/** The button of the card with this id (CatalogueCard's `id`). */
export const catalogueCardButtonId = (cardId: string) => `${cardId}-open`;

/** A game's card id on the Train tab. */
export const gameCardId = (gameId: string) => `game-${gameId}`;

/** The button of a game's card, which gets focus back when the game closes. */
export const gameCardButtonId = (gameId: string) => catalogueCardButtonId(gameCardId(gameId));
