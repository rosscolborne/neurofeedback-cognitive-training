export interface BrainStateEvent {
  timestamp: number;
  frontalTheta: number;        // 4–8 Hz (AF7, AF8) - calculation depth
  frontalHighBeta: number;     // 20–30 Hz (AF7, AF8) - panic/stress
  tpAlpha: number;             // 8–12 Hz (TP9, TP10) - poise/calm
  normalizedComposure: number; // Scaled 0.0 to 2.0 against user baseline
  isClenching: boolean;        // Artifact flag: jaw clench (EMG > 45 Hz)
  isBlinking: boolean;         // Artifact flag: frontal blink
  isGoodFit: boolean;          // Sensor contact quality
}

export interface NeuroGambitBaseline {
  thetaMean: number;
  thetaStd: number;
  highBetaMean: number;
  highBetaStd: number;
  alphaMean: number;
  alphaStd: number;
  calibratedAt: number;
  isReady: boolean;
}

export type NeuroGambitTrack = 'composed-tactics' | 'tilt-crucible';

export interface BlunderEvaluationDrop {
  before: string; // e.g. "+4.5"
  after: string;  // e.g. "-3.8"
  blunderDescription: string;
}

export interface PuzzleItem {
  id: string;
  track: NeuroGambitTrack;
  title: string;
  description: string;
  fen: string;
  playerColor: 'w' | 'b';
  // SAN or UCI move sequences. Player moves at even indices (0, 2, ...), opponent at odd (1, 3, ...)
  solutionMoves: string[];
  theme: string;
  blunderEval?: BlunderEvaluationDrop;
}

export interface PieceChargeState {
  square: string | null;
  progress: number; // 0.0 to 1.0
  isCharging: boolean;
  isLocked: boolean; // True once 1.2s charge is complete and target squares unlocked
}

export interface NGIScore {
  compositeScore: number;         // 0 - 150 (100 is standard benchmark)
  tacticalAccuracyPercent: number; // 0 - 100
  timeInHighBetaPanicSeconds: number;
  totalSessionTimeSeconds: number;
  recoveryLatencySeconds: number; // t_recover in seconds
  interpretation: string;
  puzzlesCompleted: number;
  totalPuzzlesAttempted: number;
}
