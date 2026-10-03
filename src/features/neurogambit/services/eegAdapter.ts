import { EEGDataPoint } from '../../../types';
import { neurofeedbackLevel } from '../../../consumer/eeg/neurofeedbackSignal';
import { BrainStateEvent } from '../types';

/**
 * The compatibility seam between the EEG pipeline and NeuroGambit. The game's
 * composure scale (0–2, neutral 1) is the generic neurofeedback level (0–1)
 * doubled, so a level of 0.5 is neutral. With no level — no headset, no
 * analysis service, or no usable window yet — composure stays neutral and the
 * game plays as it does without EEG.
 */
export function toBrainStateEvent(eegData: EEGDataPoint | null): BrainStateEvent {
  const level = neurofeedbackLevel(eegData?.brainflowScores);
  return {
    timestamp: eegData?.timestamp ?? Date.now(),
    normalizedComposure: level === null ? 1.0 : Math.max(0, Math.min(2, level * 2)),
    hasSignal: level !== null,
  };
}

export function computeNGIScore(
  accuracyPercent: number,
  timeInPanicSeconds: number,
  totalSessionSeconds: number,
  recoveryLatencySeconds: number,
  puzzlesCompleted: number,
  totalPuzzlesAttempted: number
) {
  const safeSessionTime = Math.max(1, totalSessionSeconds);
  const panicRatio = Math.min(1.0, Math.max(0.0, timeInPanicSeconds / safeSessionTime));
  const panicDampener = Math.max(0.1, 1.0 - panicRatio);

  const safeRecovery = Math.max(3.0, Math.min(30.0, recoveryLatencySeconds || 15.0));
  const recoveryFactor = 15.0 / safeRecovery; // 1.0 when recovery is 15s; >1.0 if faster; <1.0 if slower

  const compositeScore = Math.round((accuracyPercent / 100) * panicDampener * recoveryFactor * 100);

  let interpretation = 'Steady tactical composure with room to optimize post-blunder reset.';
  if (compositeScore >= 110) {
    interpretation = 'Grandmaster Composure: Elite working-memory stability and rapid autonomic reset under pressure.';
  } else if (compositeScore >= 85) {
    interpretation = 'Tournament Ready: Strong calculation focus with minimal panic under clock pressure.';
  } else if (compositeScore >= 60) {
    interpretation = 'Developing Composure: Good accuracy, but susceptible to time-scramble tension and blunder cascading.';
  } else {
    interpretation = 'High Anxiety / Tilt Vulnerability: Recommend targeted 15-second vagal breathing resets between games.';
  }

  return {
    compositeScore: Math.min(150, Math.max(10, compositeScore)),
    tacticalAccuracyPercent: Math.round(accuracyPercent),
    timeInPanicSeconds: Math.round(timeInPanicSeconds),
    totalSessionTimeSeconds: Math.round(totalSessionSeconds),
    recoveryLatencySeconds: Number(safeRecovery.toFixed(1)),
    interpretation,
    puzzlesCompleted,
    totalPuzzlesAttempted,
  };
}
