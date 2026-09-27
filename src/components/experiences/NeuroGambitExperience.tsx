import React from 'react';
import { NeuroGambitContainer } from '../../features/neurogambit/NeuroGambitContainer';
import { EEGDataPoint, IndividualBaselineModel } from '../../types';

interface NeuroGambitExperienceProps {
  eegData: EEGDataPoint | null;
  onComplete?: (summary: any) => void;
  isPaused?: boolean;
  isDemoSession?: boolean;
  patientId: string;
  savedBaselineModel?: IndividualBaselineModel;
  onBaselinePersisted: (model: IndividualBaselineModel) => void;
}

export const NeuroGambitExperience: React.FC<NeuroGambitExperienceProps> = (props) => {
  return <NeuroGambitContainer {...props} />;
};
