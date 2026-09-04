import React from 'react';
import { NeuroGambitContainer } from '../../features/neurogambit/NeuroGambitContainer';
import { EEGDataPoint } from '../../types';

interface NeuroGambitExperienceProps {
  eegData: EEGDataPoint | null;
  onComplete?: (summary: any) => void;
  isPaused?: boolean;
}

export const NeuroGambitExperience: React.FC<NeuroGambitExperienceProps> = (props) => {
  return <NeuroGambitContainer {...props} />;
};
