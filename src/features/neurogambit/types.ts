/**
 * What NeuroGambit knows about the player's state: one composure value derived
 * from the generic neurofeedback level (BrainFlow mindfulness and restfulness).
 * It never sees EEG bands, protocols or calibration.
 */
export interface BrainStateEvent {
  timestamp: number;
  /** 0.0–2.0. 1.0 is neutral, and is the value whenever no neurofeedback is available. */
  normalizedComposure: number;
  /** False when no neurofeedback level is available, so composure is held neutral. */
  hasSignal: boolean;
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
  timeInPanicSeconds: number;
  totalSessionTimeSeconds: number;
  recoveryLatencySeconds: number; // t_recover in seconds
  interpretation: string;
  puzzlesCompleted: number;
  totalPuzzlesAttempted: number;
}
