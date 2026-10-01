import React from 'react';
import { AudioWaveform } from 'lucide-react';
import type { ExperienceType } from '../../types';
import { CatalogueCard } from '../../consumer/catalogue/CatalogueCard';
import { GameCatalogue } from '../../consumer/catalogue/GameCatalogue';
import { EXPERIENCE_CATALOGUE, getAssignedExperienceIds } from './experienceCatalogue';

// The Train tab (NFCT-12): the game catalogue first, then the assigned EEG
// experiences as an optional, headset-based section. Today that is only
// NeuroGambit, whose future is the owner's call (NFCT-47); it keeps its
// existing launch path through the clinical session runner.

interface TrainTabProps {
  readonly allowedExperiences: ExperienceType[];
  readonly onOpenGame: (gameId: string) => void;
  readonly onStartExperience: (experience: ExperienceType) => void;
}

export const TrainTab: React.FC<TrainTabProps> = ({ allowedExperiences, onOpenGame, onStartExperience }) => {
  const experiences = getAssignedExperienceIds(allowedExperiences).map((id) => EXPERIENCE_CATALOGUE[id]);
  return (
    <div className="train-tab">
      <header className="train-tab-header">
        <h1 className="font-display">Train</h1>
        <p>Pick a game and play. No headset needed.</p>
      </header>

      <GameCatalogue onOpenGame={onOpenGame} />

      {experiences.length > 0 && (
        <section className="train-section" aria-labelledby="train-headset-title">
          <div className="train-section-head">
            <div className="train-section-title-row">
              <h2 id="train-headset-title" className="train-section-title">Headset training</h2>
              <span className="status-tag status-tag-neutral train-card-tag">Optional</span>
            </div>
            <p className="train-section-note">
              Neurofeedback sessions with a Muse EEG headset. Demo Mode lets you try one without it.
            </p>
          </div>
          <ul className="train-grid" role="list">
            {experiences.map((experience) => (
              <CatalogueCard
                key={experience.id}
                id={`experience-${experience.id}`}
                name={experience.name}
                description={experience.description}
                icon={experience.icon}
                tags={[experience.tag]}
                tagsLabel="Type"
                facts={[{ icon: AudioWaveform, text: 'Muse headset or Demo Mode' }]}
                action="Start"
                className="card-patient"
                onSelect={() => onStartExperience(experience.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
