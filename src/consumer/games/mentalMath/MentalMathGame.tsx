import React, { useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { browserGameClock } from '../../clock/gameClock';
import type { EegCaptureProvider } from '../../eeg/eegCapture';
import { eegRecordingRepository, gameSessionRepository, progressRepository } from '../../repositories';
import { MentalMathScreen, type MentalMathView } from './MentalMathScreen';
import { APP_VERSION, deviceTimezone, type SessionEnvironment } from './sessionDraft';

// Mental Math bound to the app: the consumer repositories (persistent offline
// cache), the production game clock and this device's environment.

function platform(): SessionEnvironment['platform'] {
  const name = Capacitor.getPlatform();
  return name === 'ios' || name === 'android' ? name : 'web';
}

export const MentalMathGame: React.FC<{
  readonly eegProvider?: EegCaptureProvider | null;
  /** Open on the start-level picker (default) or on the game's progress and history. */
  readonly initialView?: MentalMathView;
  readonly onExit: () => void;
}> = ({ eegProvider = null, initialView = 'picker', onExit }) => {
  const environment = useMemo<SessionEnvironment>(() => ({ timezone: deviceTimezone(), appVersion: APP_VERSION, platform: platform() }), []);
  return (
    <MentalMathScreen
      gameSessions={gameSessionRepository}
      eegRecordings={eegRecordingRepository}
      progress={progressRepository}
      clock={browserGameClock}
      environment={environment}
      eegProvider={eegProvider}
      initialView={initialView}
      onExit={onExit}
    />
  );
};
