import React, { useMemo } from 'react';
import { Calculator, ChartNoAxesColumnIncreasing, Timer, type LucideIcon } from 'lucide-react';
import type { GameIconKey } from '@nfct/shared';
import { gameCardId } from './cardIds';
import { CatalogueCard, type CatalogueCardFact } from './CatalogueCard';
import { catalogueGames, runLengthLabel, type CatalogueGame } from './catalogueGames';

// The Games section of the Train tab (NFCT-12): one card per game in the
// code-owned catalogue, in catalogue order, each showing the domains it trains
// as percentages of its authoritative domain weights (NFCT-65).

const GAME_ICONS: Readonly<Record<GameIconKey, LucideIcon>> = {
  calculator: Calculator,
};

function factsOf(game: CatalogueGame): CatalogueCardFact[] {
  const facts: CatalogueCardFact[] = [];
  if (game.runLengthMs) facts.push({ icon: Timer, text: runLengthLabel(game.runLengthMs) });
  facts.push({ icon: ChartNoAxesColumnIncreasing, text: game.levels === 1 ? '1 level' : `${game.levels} levels` });
  return facts;
}

export const GameCatalogue: React.FC<{
  readonly onOpenGame: (gameId: string) => void;
}> = ({ onOpenGame }) => {
  const games = useMemo(() => catalogueGames(), []);
  return (
    <section className="train-section" aria-labelledby="train-games-title">
      <h2 id="train-games-title" className="train-section-title">Games</h2>
      <ul className="train-grid" role="list">
        {games.map((game) => (
          <CatalogueCard
            key={game.id}
            id={gameCardId(game.id)}
            name={game.name}
            description={game.summary}
            icon={GAME_ICONS[game.icon]}
            emphasis={game.domains}
            facts={factsOf(game)}
            action="Play"
            className="train-game-card"
            onSelect={() => onOpenGame(game.id)}
          />
        ))}
      </ul>
    </section>
  );
};
