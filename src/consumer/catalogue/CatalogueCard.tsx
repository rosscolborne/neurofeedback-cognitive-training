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

export interface CatalogueCardProps {
  /** Unique on the page; prefixes the ids the button's description points at. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: React.ComponentType<{ size?: number }>;
  /** Short labels under the description, such as a game's domains. */
  readonly tags: readonly string[];
  /** What the tags are, for screen readers ("Domains"). */
  readonly tagsLabel: string;
  /** Plain facts in the footer, such as the run length. */
  readonly facts: readonly CatalogueCardFact[];
  /** The visible cue for what the card does ("Play"). */
  readonly action: string;
  readonly className?: string;
  readonly onSelect: () => void;
}

/** A hidden comma after every item but the last, so screen readers pause between visually separate items. */
const comma = (index: number, count: number) => (index < count - 1 ? <span className="visually-hidden">,</span> : null);

export const CatalogueCard: React.FC<CatalogueCardProps> = ({
  id, name, description, icon: Icon, tags, tagsLabel, facts, action, className, onSelect,
}) => {
  const describedBy = [`${id}-desc`, tags.length > 0 ? `${id}-tags` : null, facts.length > 0 ? `${id}-facts` : null]
    .filter(Boolean).join(' ');
  return (
    <li className={className ? `train-card ${className}` : 'train-card'}>
      <span className="train-card-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <button id={catalogueCardButtonId(id)} type="button" className="train-card-name" aria-describedby={describedBy} onClick={onSelect}>
        {name}
      </button>
      <p id={`${id}-desc`} className="train-card-desc">{description}</p>
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
