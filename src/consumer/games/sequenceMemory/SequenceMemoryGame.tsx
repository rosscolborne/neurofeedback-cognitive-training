import React, { useMemo } from 'react';
import { browserGameClock } from '../../clock/gameClock';
import type { EegCaptureProvider } from '../../eeg/eegCapture';
import { gameSessionRepository, progressRepository } from '../../repositories';
import { deviceEnvironment } from '../common/deviceEnvironment';
import type { SessionEnvironment } from '../common/sessionEnvironment';
import type { GameScreenView } from '../gameScreenView';
import { SequenceMemoryScreen } from './SequenceMemoryScreen';

// Sequence Memory bound to the app: the consumer repositories (persistent
// offline cache), the production game clock and this device's environment.
// It captures no EEG: an offered provider is accepted and ignored, so EEG can
// never affect play. It has no in-game progress view, so every view opens on
// the start screen.

export const SequenceMemoryGame: React.FC<{
  readonly eegProvider?: EegCaptureProvider | null;
  readonly initialView?: GameScreenView;
  readonly onExit: () => void;
}> = ({ onExit }) => {
  const environment = useMemo<SessionEnvironment>(() => deviceEnvironment(), []);
  return (
    <SequenceMemoryScreen
      gameSessions={gameSessionRepository}
      progress={progressRepository}
      clock={browserGameClock}
      environment={environment}
      onExit={onExit}
    />
  );
};
