// The one neurofeedback signal a game may use: a single level derived from
// BrainFlow's mindfulness and restfulness. A game sees this level and nothing
// else, so it never knows about EEG bands, protocols or calibration, and it
// must play the same when the level is unavailable (no headset, no analysis
// service, or no usable window yet).

/** Mindfulness and restfulness as the EEG pipeline publishes them: 0–100, or null when unavailable. */
export interface MindStateScores {
  readonly mindfulnessScore: number | null;
  readonly restfulnessScore: number | null;
}

const usableScore = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The neurofeedback level, 0–1: the mean of whichever of mindfulness and
 * restfulness are available, or null when neither is.
 */
export function neurofeedbackLevel(scores: MindStateScores | null | undefined): number | null {
  if (!scores) return null;
  const values = [scores.mindfulnessScore, scores.restfulnessScore].filter(usableScore);
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.max(0, Math.min(1, mean / 100));
}
