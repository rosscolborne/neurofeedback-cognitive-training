import React from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { catalogueCardButtonId } from './cardIds';

// One game on the Train tab. The name is a real button stretched over the
// card, so the whole card is one large target while keyboard and screen-reader
// users reach a single named control. The rest of the card is its description.

export interface CatalogueCardFact {
  readonly icon: LucideIcon;
  readonly text: string;
}

/** One part of what a game trains, as a whole percentage. */
export interface CatalogueCardShare {
  readonly label: string;
  readonly percent: number;
}

export interface CatalogueCardProps {
  /** Unique on the page; prefixes the ids the button's description points at. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: React.ComponentType<{ size?: number }>;
  /** Short labels under the description, such as an experience's type. */
  readonly tags?: readonly string[];
  /** What the tags are, for screen readers ("Type"). */
  readonly tagsLabel?: string;
  /**
   * What a game trains, heaviest first, as whole percentages that sum to 100.
   * Describes the game's design, not the player.
   */
  readonly emphasis?: readonly CatalogueCardShare[];
  /** Plain facts in the footer, such as the run length. */
  readonly facts: readonly CatalogueCardFact[];
  /** The visible cue for what the card does ("Play"). */
  readonly action: string;
  readonly className?: string;
  readonly onSelect: () => void;
}

/** A hidden comma after every item but the last, so screen readers pause between visually separate items. */
const comma = (index: number, count: number) => (index < count - 1 ? <span className="visually-hidden">,</span> : null);

/** A share too small to round to 1% still reads as present. */
const percentText = (percent: number) => (percent === 0 ? '<1%' : `${percent}%`);

/** Shares beyond the fourth reuse the lightest tone; the text, not the colour, carries the mix. */
const toneOf = (index: number) => `train-card-mix-tone-${Math.min(index, 3)}`;

// "Trains" beside a thin bar split by the shares, then the shares in words.
// The bar is decoration for sighted users; screen readers get the words.
const EmphasisMix: React.FC<{ readonly id: string; readonly shares: readonly CatalogueCardShare[] }> = ({ id, shares }) => (
  <div id={id} className="train-card-mix">
    <div className="train-card-mix-head">
      <span className="train-card-mix-title">Trains<span className="visually-hidden">: </span></span>
      <span className="train-card-mix-bar" aria-hidden="true">
        {shares.map((share, index) => share.percent > 0 && (
          <span key={share.label} className={`train-card-mix-segment ${toneOf(index)}`} style={{ flexGrow: share.percent }} />
        ))}
      </span>
    </div>
    <p className="train-card-mix-legend">
      {shares.map((share, index) => (
        <span key={share.label} className="train-card-mix-item">
          <span className={`train-card-mix-dot ${toneOf(index)}`} aria-hidden="true" />
          {share.label} {percentText(share.percent)}{comma(index, shares.length)}
        </span>
      ))}
    </p>
  </div>
);

export const CatalogueCard: React.FC<CatalogueCardProps> = ({
  id, name, description, icon: Icon, tags = [], tagsLabel, emphasis = [], facts, action, className, onSelect,
}) => {
  const describedBy = [
    `${id}-desc`,
    emphasis.length > 0 ? `${id}-emphasis` : null,
    tags.length > 0 ? `${id}-tags` : null,
    facts.length > 0 ? `${id}-facts` : null,
  ].filter(Boolean).join(' ');
  return (
    <li className={className ? `train-card ${className}` : 'train-card'}>
      <span className="train-card-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <button id={catalogueCardButtonId(id)} type="button" className="train-card-name" aria-describedby={describedBy} onClick={onSelect}>
        {name}
      </button>
      <p id={`${id}-desc`} className="train-card-desc">{description}</p>
      {emphasis.length > 0 && <EmphasisMix id={`${id}-emphasis`} shares={emphasis} />}
      {tags.length > 0 && (
        <p id={`${id}-tags`} className="train-card-tags">
          <span className="visually-hidden">{tagsLabel}: </span>
          {tags.map((tag, index) => (
            <span key={tag} className="status-tag status-tag-neutral train-card-tag">{tag}{comma(index, tags.length)}</span>
          ))}
        </p>
      )}
      <div className="train-card-foot">
        {facts.length > 0 && (
          <p id={`${id}-facts`} className="train-card-facts">
            {facts.map(({ icon: FactIcon, text }, index) => (
              <span key={text} className="train-card-fact">
                <FactIcon size={14} aria-hidden="true" />
                {text}{comma(index, facts.length)}
              </span>
            ))}
          </p>
        )}
        <span className="train-card-cta" aria-hidden="true">
          {action}
          <ChevronRight size={16} />
        </span>
      </div>
    </li>
  );
};
