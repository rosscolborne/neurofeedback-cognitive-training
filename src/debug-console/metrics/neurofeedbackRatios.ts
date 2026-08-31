export interface NeurofeedbackScores {
  focusScore: number;
  relaxScore: number;
  focusSigned: number;
  relaxSigned: number;
}

const normalizeScale = 1.1;

export function computeBrainflowsNeurofeedbackScores({
  thetaPower,
  alphaPower,
  betaPower,
}: {
  thetaPower: number;
  alphaPower: number;
  betaPower: number;
}): NeurofeedbackScores {
  const theta = Math.max(1e-9, thetaPower);
  const focusSigned = tanhLog(betaPower / theta, normalizeScale);
  const relaxSigned = tanhLog(alphaPower / theta, normalizeScale);

  return {
    focusScore: signedToScore(focusSigned),
    relaxScore: signedToScore(relaxSigned),
    focusSigned,
    relaxSigned,
  };
}

export function smoothScore(
  currentValue: number | null,
  targetValue: number,
  weight: number,
) {
  return currentValue === null
    ? targetValue
    : currentValue * (1 - weight) + targetValue * weight;
}

function tanhLog(value: number, scale: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;

  return Math.tanh(scale * Math.log(value));
}

function signedToScore(value: number) {
  return Math.round(clamp((value + 1) * 50, 0, 100));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

