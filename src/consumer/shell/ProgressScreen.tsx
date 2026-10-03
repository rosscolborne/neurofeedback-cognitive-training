import React from 'react';
import { MENTAL_MATH_PROGRESS_CARD_BUTTON_ID, MentalMathProgressCard } from '../games/mentalMath/MentalMathProgressCard';
import { SEQUENCE_MEMORY_PROGRESS_CARD_BUTTON_ID, SequenceMemoryProgressCard } from '../games/sequenceMemory/SequenceMemoryProgressCard';
import { PROGRESS_PLAY_BUTTON_ID, ProgressOverview } from '../overview/ProgressOverview';
import type { GameRequest } from './gameRequest';

interface ProgressScreenProps {
  readonly playerId: string;
  readonly onOpenGame: (game: GameRequest) => void;
  /** A section to scroll to and focus once Progress has loaded (Home's "See all achievements"). */
  readonly focusSection: 'achievements' | null;
  /** Called once `focusSection` has been focused. */
  readonly onSectionFocused: () => void;
}

/** The Progress tab (NFCT-22): game progress, achievements and each game's records. */
export const ProgressScreen: React.FC<ProgressScreenProps> = ({ playerId, onOpenGame, focusSection, onSectionFocused }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '30px' }}>
    <h1 className="font-display" style={{ fontSize: '28px', color: 'var(--text-primary)', fontWeight: 400 }}>
      Your Progress
    </h1>

    <ProgressOverview
      playerId={playerId}
      onPlay={() => onOpenGame({ gameId: 'mental-math', returnFocusTo: PROGRESS_PLAY_BUTTON_ID })}
      focusSection={focusSection}
      onSectionFocused={onSectionFocused}
      games={(
        <>
          <MentalMathProgressCard onOpen={() => onOpenGame({ gameId: 'mental-math', initialView: 'progress', returnFocusTo: MENTAL_MATH_PROGRESS_CARD_BUTTON_ID })} />
          {/* NFCT-93: opens the game's start screen; it has no records-and-history view yet. */}
          <SequenceMemoryProgressCard onOpen={() => onOpenGame({ gameId: 'sequence-memory', returnFocusTo: SEQUENCE_MEMORY_PROGRESS_CARD_BUTTON_ID })} />
        </>
      )}
    />
  </div>
);
