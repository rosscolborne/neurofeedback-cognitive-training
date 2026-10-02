import {
  DOMAIN_CATALOG,
  DOMAIN_LABELS,
  GAME_CATALOGUE,
  maxLevelOf,
  type DomainId,
  type GameIconKey,
  type GameListing,
} from '@nfct/shared';

// What a catalogue card shows for each game (NFCT-12), derived from the
// code-owned listings and game definitions in @nfct/shared and the v1 domain
// catalogue. Nothing here is stored or read from Firestore.

export interface CatalogueDomain {
  readonly id: DomainId;
  readonly label: string;
  /** Product taxonomy, not a measurement: how prominently the game is filed here. */
  readonly weight: number;
}

export interface CatalogueGame {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly icon: GameIconKey;
  /** Every domain the game is filed under, highest weight first (ties in catalogue order). */
  readonly domains: readonly CatalogueDomain[];
  /** The fixed run length of the game's timed modes, or null when no mode is timed. */
  readonly runLengthMs: { readonly min: number; readonly max: number } | null;
  /** The highest level of any mode. */
  readonly levels: number;
}

const DOMAIN_ORDER: ReadonlyMap<string, number> = new Map(DOMAIN_CATALOG.domains.map((id, index) => [id, index]));

function domainsOf(listing: GameListing): CatalogueDomain[] {
  return Object.entries(listing.definition.domainWeights)
    .filter((entry): entry is [DomainId, number] => DOMAIN_ORDER.has(entry[0]) && (entry[1] ?? 0) > 0)
    .sort(([a, weightA], [b, weightB]) => weightB - weightA || DOMAIN_ORDER.get(a)! - DOMAIN_ORDER.get(b)!)
    .map(([id, weight]) => ({ id, label: DOMAIN_LABELS[id], weight }));
}

function runLengthOf(listing: GameListing): CatalogueGame['runLengthMs'] {
  const lengths = listing.definition.modes
    .map((mode) => mode.runDurationMs)
    .filter((length): length is number => typeof length === 'number');
  return lengths.length === 0 ? null : { min: Math.min(...lengths), max: Math.max(...lengths) };
}

export function toCatalogueGame(listing: GameListing): CatalogueGame {
  return {
    id: listing.definition.id,
    name: listing.name,
    summary: listing.summary,
    icon: listing.icon,
    domains: domainsOf(listing),
    runLengthMs: runLengthOf(listing),
    levels: Math.max(...listing.definition.modes.map(maxLevelOf)),
  };
}

/** The catalogue's games, in display order. */
export function catalogueGames(listings: readonly GameListing[] = GAME_CATALOGUE): CatalogueGame[] {
  return listings.map(toCatalogueGame);
}

function durationLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 120 && seconds % 60 === 0) return `${seconds / 60} minutes`;
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

/** "90 seconds", "2 minutes", or a range when a game's timed modes differ. */
export function runLengthLabel(runLength: NonNullable<CatalogueGame['runLengthMs']>): string {
  if (runLength.min === runLength.max) return durationLabel(runLength.min);
  return `${durationLabel(runLength.min)} to ${durationLabel(runLength.max)}`;
}
