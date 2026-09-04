import { EEGDataPoint } from '../../../types';
import { BrainStateEvent, NeuroGambitBaseline } from '../types';

export function createDefaultBaseline(): NeuroGambitBaseline {
  return {
    thetaMean: 6.5,
    thetaStd: 1.5,
    highBetaMean: 5.0,
    highBetaStd: 1.2,
    alphaMean: 7.0,
    alphaStd: 1.5,
    calibratedAt: Date.now(),
    isReady: false,
  };
}

export function toBrainStateEvent(
  eegData: EEGDataPoint | null,
  baseline: NeuroGambitBaseline | null
): BrainStateEvent {
  if (!eegData) {
    return {
      timestamp: Date.now(),
      frontalTheta: 6.5,
      frontalHighBeta: 5.0,
      tpAlpha: 7.0,
      normalizedComposure: 1.0,
      isClenching: false,
      isBlinking: false,
      isGoodFit: false,
    };
  }

  const frontalTheta = eegData.bands.theta;
  const frontalHighBeta = eegData.bands.beta;
  const tpAlpha = eegData.bands.alpha;
  const isClenching = Boolean(eegData.artifacts?.clench);
  const isBlinking = Boolean(eegData.artifacts?.blink);
  const isGoodFit = eegData.signalQuality === 'excellent' || eegData.signalQuality === 'good';

  let normalizedComposure = 1.0;

  if (baseline && baseline.isReady && baseline.highBetaStd > 0) {
    // Z-score calculation against user-specific resting baseline
    const zTheta = (frontalTheta - baseline.thetaMean) / Math.max(0.5, baseline.thetaStd);
    const zBeta = (frontalHighBeta - baseline.highBetaMean) / Math.max(0.5, baseline.highBetaStd);
    const zAlpha = (tpAlpha - baseline.alphaMean) / Math.max(0.5, baseline.alphaStd);

    // Composure rewards alpha stability + theta engagement, heavily suppresses high-beta panic
    const rawComposure = (1.0 + 0.35 * zAlpha + 0.25 * zTheta) - (0.6 * zBeta);
    normalizedComposure = Math.max(0.0, Math.min(2.0, rawComposure));
  } else {
    // Fallback using raw band powers and zoneScore when baseline is calibrating
    const ratio = (tpAlpha + 0.5 * frontalTheta) / Math.max(1.0, frontalHighBeta);
    const zoneBonus = eegData.inZone ? 0.3 : -0.2;
    normalizedComposure = Math.max(0.2, Math.min(1.8, (ratio / 2.0) + zoneBonus));
  }

  // During active jaw clench (EMG artifact > 45 Hz), suppress composure reading to avoid false signals
  if (isClenching) {
    normalizedComposure = Math.min(normalizedComposure, 0.4);
  }

  return {
    timestamp: eegData.timestamp || Date.now(),
    frontalTheta,
    frontalHighBeta,
    tpAlpha,
    normalizedComposure,
    isClenching,
    isBlinking,
    isGoodFit,
  };
}

export function computeNGIScore(
  accuracyPercent: number,
  timeInHighBetaPanicSeconds: number,
  totalSessionSeconds: number,
  recoveryLatencySeconds: number,
  puzzlesCompleted: number,
  totalPuzzlesAttempted: number
) {
  const safeSessionTime = Math.max(1, totalSessionSeconds);
  const panicRatio = Math.min(1.0, Math.max(0.0, timeInHighBetaPanicSeconds / safeSessionTime));
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
    timeInHighBetaPanicSeconds: Math.round(timeInHighBetaPanicSeconds),
    totalSessionTimeSeconds: Math.round(totalSessionSeconds),
    recoveryLatencySeconds: Number(safeRecovery.toFixed(1)),
    interpretation,
    puzzlesCompleted,
    totalPuzzlesAttempted,
  };
}
